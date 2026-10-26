import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import {
  attachEvidence,
  audit,
  checkZone,
  deleteEvidenceFor,
  evidenceViews,
  forbidden,
  memberSelect,
  notFound,
  ownerView,
  resolveOwner,
  visibleWhere,
  type WorkContext,
} from "./workgraph.shared.js";
import type { AddEvidenceInput, StreamInput, UpdateStreamInput } from "./workgraph.schema.js";

/**
 * Workstreams: what connected work is organised around — a launch, a
 * migration, a customer. A stream has an accountable owner and a next
 * checkpoint, and gathers the commitments, decisions and sources inside it.
 */

const include = {
  owner: { select: memberSelect },
  _count: { select: { commitments: true, decisions: true, dependencies: true } },
} satisfies Prisma.WorkStreamInclude;

type Row = Prisma.WorkStreamGetPayload<{ include: typeof include }>;

export async function streamViews(rows: Row[], context: WorkContext) {
  const evidence = await evidenceViews("STREAM", rows.map((r) => r.id), context);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    owner: ownerView(r.owner, r.ownerLabel, context),
    nextCheckpointAt: r.nextCheckpointAt,
    timeZone: r.timeZone,
    status: r.status,
    visibility: r.visibility,
    counts: { commitments: r._count.commitments, decisions: r._count.decisions, dependencies: r._count.dependencies },
    canEdit: r.createdByMembershipId === context.membershipId || r.ownerMembershipId === context.membershipId,
    isCreator: r.createdByMembershipId === context.membershipId,
    evidence: evidence.get(r.id) ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export class StreamService {
  async list(context: WorkContext, includeArchived = false) {
    const rows = await prisma.workStream.findMany({
      where: { ...visibleWhere(context), ...(includeArchived ? {} : { status: "ACTIVE" as const }) },
      include,
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    });
    return streamViews(rows, context);
  }

  async get(id: string, context: WorkContext) {
    const row = await prisma.workStream.findFirst({ where: { id, ...visibleWhere(context) }, include });
    if (!row) throw notFound("Workstream");
    return (await streamViews([row], context))[0]!;
  }

  async create(input: StreamInput, context: WorkContext) {
    const owner = await resolveOwner(input, context);
    const created = await prisma.workStream.create({
      data: {
        tenantId: context.tenantId,
        title: input.title,
        description: input.description ?? null,
        ownerMembershipId: owner.ownerMembershipId,
        ownerLabel: owner.ownerLabel,
        nextCheckpointAt: input.nextCheckpointAt ?? null,
        timeZone: checkZone(input.timeZone),
        visibility: input.visibility ?? "PRIVATE",
        createdByMembershipId: context.membershipId,
      },
    });
    await audit(context, "WORK_STREAM_CREATED", "WorkStream", created.id);
    return this.get(created.id, context);
  }

  async update(id: string, input: UpdateStreamInput, context: WorkContext) {
    const row = await this.editable(id, context);
    const { ownerEmail, ownerLabel, timeZone, visibility, ...fields } = input;
    if (visibility !== undefined && row.createdByMembershipId !== context.membershipId) {
      throw forbidden("Only its creator can change who it is shared with.", "STREAM_VISIBILITY");
    }
    const owner = ownerEmail !== undefined || ownerLabel !== undefined ? await resolveOwner({ ownerEmail, ownerLabel }, context, false) : null;
    await prisma.workStream.update({
      where: { id: row.id, tenantId: context.tenantId },
      data: {
        ...fields,
        ...(timeZone !== undefined ? { timeZone: checkZone(timeZone) } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        ...(owner ? { ownerMembershipId: owner.ownerMembershipId, ownerLabel: owner.ownerLabel } : {}),
      },
    });
    await audit(context, "WORK_STREAM_UPDATED", "WorkStream", id, { changed: Object.keys(input) });
    return this.get(id, context);
  }

  /** Deleting a stream keeps what was in it: those items simply leave the stream. */
  async remove(id: string, context: WorkContext) {
    const row = await prisma.workStream.findFirst({ where: { id, ...visibleWhere(context) } });
    if (!row) throw notFound("Workstream");
    if (row.createdByMembershipId !== context.membershipId) throw forbidden("Only its creator can delete it.", "STREAM_DELETE");
    await prisma.$transaction(async (tx) => {
      await deleteEvidenceFor(tx, "STREAM", id, context);
      await tx.workStream.delete({ where: { id, tenantId: context.tenantId } });
    });
    await audit(context, "WORK_STREAM_DELETED", "WorkStream", id);
  }

  private async editable(id: string, context: WorkContext) {
    const row = await prisma.workStream.findFirst({ where: { id, ...visibleWhere(context) } });
    if (!row) throw notFound("Workstream");
    if (row.createdByMembershipId !== context.membershipId && row.ownerMembershipId !== context.membershipId) {
      throw forbidden("Only its creator or owner can change it.", "STREAM_ACCESS");
    }
    return row;
  }
}

/** Who may attach or remove sources: whoever may change the thing they belong to. */
async function subjectEditable(subjectType: AddEvidenceInput["subjectType"], subjectId: string, context: WorkContext) {
  const where = { id: subjectId, ...visibleWhere(context, subjectType === "DECISION" ? [{ approverMembershipId: context.membershipId }] : []) };
  const row =
    subjectType === "STREAM"
      ? await prisma.workStream.findFirst({ where, select: { createdByMembershipId: true, ownerMembershipId: true } })
      : subjectType === "COMMITMENT"
        ? await prisma.workCommitment.findFirst({ where, select: { createdByMembershipId: true, ownerMembershipId: true } })
        : await prisma.workDecision.findFirst({ where, select: { createdByMembershipId: true, ownerMembershipId: true } });
  if (!row) throw notFound(subjectType === "STREAM" ? "Workstream" : subjectType === "COMMITMENT" ? "Commitment" : "Decision");
  const editor = row.createdByMembershipId === context.membershipId || row.ownerMembershipId === context.membershipId;
  return { editor };
}

export class EvidenceService {
  async add(input: AddEvidenceInput, context: WorkContext) {
    const { editor } = await subjectEditable(input.subjectType, input.subjectId, context);
    if (!editor) throw forbidden("Only its creator or owner can attach a source.", "EVIDENCE_ACCESS");
    let created;
    try {
      created = await prisma.$transaction((tx) => attachEvidence(tx, input.subjectType, input.subjectId, [input.evidence], context));
    } catch (error) {
      // Two requests attaching the same source together: the second one loses, cleanly.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") created = [];
      else throw error;
    }
    if (created.length === 0) throw new AppError("That source is already attached.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_ATTACHED" });
    await audit(context, "WORK_EVIDENCE_ADDED", input.subjectType, input.subjectId, { kind: input.evidence.kind });
    return (await evidenceViews(input.subjectType, [input.subjectId], context)).get(input.subjectId) ?? [];
  }

  async remove(evidenceId: string, context: WorkContext) {
    const row = await prisma.workEvidence.findFirst({ where: { id: evidenceId, tenantId: context.tenantId } });
    if (!row) throw notFound("Source");
    const { editor } = await subjectEditable(row.subjectType, row.subjectId, context);
    if (!editor && row.addedByMembershipId !== context.membershipId) throw forbidden("Only whoever attached it, or its owner, can remove it.", "EVIDENCE_ACCESS");
    await prisma.workEvidence.delete({ where: { id: row.id, tenantId: context.tenantId } });
    await audit(context, "WORK_EVIDENCE_REMOVED", row.subjectType, row.subjectId, { kind: row.kind });
  }
}

export const streamService = new StreamService();
export const evidenceService = new EvidenceService();
