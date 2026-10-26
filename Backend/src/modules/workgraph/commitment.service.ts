import type { Prisma, WorkCommitmentStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { dependencyService } from "./dependency.service.js";
import { countSuggestions } from "./suggestion.query.js";
import {
  attachEvidence,
  audit,
  checkZone,
  deleteEvidenceFor,
  evidenceViews,
  FORMER_MEMBER,
  forbidden,
  memberSelect,
  notFound,
  notifyWork,
  nameOf,
  ownerView,
  requireStream,
  resolveOwner,
  visibleWhere,
  type WorkContext,
} from "./workgraph.shared.js";
import type { CommitmentInput, ListCommitmentsInput, UpdateCommitmentInput } from "./workgraph.schema.js";

/**
 * Commitments: promises and expected replies, each with an accountable owner,
 * a due date and the sources that evidence it. They are not a task list: the
 * register records what was promised, by whom, and why we believe it.
 */

const OPEN: WorkCommitmentStatus[] = ["AWAITING", "IN_PROGRESS"];
/** A list shows at most this many; the response says when there were more. */
const LIST_LIMIT = 300;

const include = {
  owner: { select: memberSelect },
  stream: { select: { id: true, title: true } },
  createdBy: { select: memberSelect },
} satisfies Prisma.WorkCommitmentInclude;

type Row = Prisma.WorkCommitmentGetPayload<{ include: typeof include }>;
export type CommitmentDisplay = "AWAITING" | "PAST_DUE" | "IN_PROGRESS" | "RECORDED" | "CANCELLED";

export function displayStatus(row: { status: WorkCommitmentStatus; dueAt: Date | null }, now = new Date()): CommitmentDisplay {
  if (row.status === "RECORDED" || row.status === "CANCELLED") return row.status;
  if (row.dueAt && row.dueAt < now) return "PAST_DUE";
  return row.status;
}

async function toViews(rows: Row[], context: WorkContext) {
  const ids = rows.map((r) => r.id);
  const [evidence, impact] = await Promise.all([evidenceViews("COMMITMENT", ids, context), dependencyService.impact("COMMITMENT", ids, context)]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    stream: r.stream,
    owner: ownerView(r.owner, r.ownerLabel, context),
    expectedFrom: r.expectedFrom,
    dueAt: r.dueAt,
    timeZone: r.timeZone,
    status: r.status,
    display: displayStatus(r),
    visibility: r.visibility,
    recordedAt: r.recordedAt,
    fromSuggestion: Boolean(r.sourceAiActionId),
    createdBy: r.createdBy
      ? { name: nameOf(r.createdBy.user), email: r.createdBy.user.email, isMe: r.createdByMembershipId === context.membershipId }
      : FORMER_MEMBER,
    isMine: r.ownerMembershipId === context.membershipId,
    canEdit: r.createdByMembershipId === context.membershipId || r.ownerMembershipId === context.membershipId,
    isCreator: r.createdByMembershipId === context.membershipId,
    blocking: impact.get(r.id) ?? { blocked: 0, deliverables: [] },
    evidence: evidence.get(r.id) ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** The base set a list is drawn from: what the caller may see, in the chosen scope and window. */
function baseWhere(input: Pick<ListCommitmentsInput, "scope" | "days">, context: WorkContext): Prisma.WorkCommitmentWhereInput {
  const since = input.days > 0 ? new Date(Date.now() - input.days * 86_400_000) : null;
  return {
    ...visibleWhere(context),
    status: { not: "CANCELLED" },
    ...(input.scope === "owned" ? { ownerMembershipId: context.membershipId } : input.scope === "created" ? { createdByMembershipId: context.membershipId } : {}),
    // Finished ones only while they are recent; open ones always.
    ...(since ? { AND: [{ OR: [{ status: { in: OPEN } }, { recordedAt: { gte: since } }] }] } : {}),
  } as Prisma.WorkCommitmentWhereInput;
}

export class CommitmentService {
  async list(input: ListCommitmentsInput, context: WorkContext) {
    const base = baseWhere(input, context);
    const now = new Date();
    const tabWhere: Prisma.WorkCommitmentWhereInput =
      input.tab === "mine" ? { ownerMembershipId: context.membershipId } : input.tab === "awaiting" ? { status: "AWAITING" } : {};
    let search: Prisma.WorkCommitmentWhereInput = {};
    if (input.q) {
      const evidence = await prisma.workEvidence.findMany({
        where: { tenantId: context.tenantId, subjectType: "COMMITMENT", label: { contains: input.q, mode: "insensitive" } },
        select: { subjectId: true },
        take: 200,
      });
      search = {
        OR: [
          { title: { contains: input.q, mode: "insensitive" } },
          { description: { contains: input.q, mode: "insensitive" } },
          { ownerLabel: { contains: input.q, mode: "insensitive" } },
          { expectedFrom: { contains: input.q, mode: "insensitive" } },
          { id: { in: evidence.map((e) => e.subjectId) } },
        ],
      };
    }
    const [rows, all, awaiting, pastDue, suggestions] = await Promise.all([
      prisma.workCommitment.findMany({
        where: { AND: [base, tabWhere, search] },
        include,
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: LIST_LIMIT,
      }),
      prisma.workCommitment.count({ where: base }),
      prisma.workCommitment.count({ where: { AND: [base, { status: "AWAITING" }] } }),
      prisma.workCommitment.count({ where: { AND: [base, { status: { in: OPEN }, dueAt: { lt: now } }] } }),
      countSuggestions(context, "COMMITMENT"),
    ]);
    const items = await toViews(rows, context);
    return { items, truncated: rows.length >= LIST_LIMIT, summary: { confirmed: all, awaiting, pastDue, suggestions } };
  }

  async get(id: string, context: WorkContext) {
    const row = await prisma.workCommitment.findFirst({ where: { id, ...visibleWhere(context) }, include });
    if (!row) throw notFound("Commitment");
    return (await toViews([row], context))[0]!;
  }

  async create(input: CommitmentInput, context: WorkContext, extra: { sourceAiActionId?: string } = {}) {
    const owner = await resolveOwner(input, context);
    if (input.streamId) await requireStream(input.streamId, context);
    const timeZone = checkZone(input.timeZone);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.workCommitment.create({
        data: {
          tenantId: context.tenantId,
          streamId: input.streamId ?? null,
          title: input.title,
          description: input.description ?? null,
          ownerMembershipId: owner.ownerMembershipId,
          ownerLabel: owner.ownerLabel,
          expectedFrom: input.expectedFrom ?? null,
          dueAt: input.dueAt ?? null,
          timeZone,
          status: input.status ?? (input.expectedFrom ? "AWAITING" : "IN_PROGRESS"),
          visibility: input.visibility ?? "PRIVATE",
          sourceAiActionId: extra.sourceAiActionId ?? null,
          recordedAt: input.status === "RECORDED" ? new Date() : null,
          createdByMembershipId: context.membershipId,
        },
        include,
      });
      await attachEvidence(tx, "COMMITMENT", row.id, input.evidence ?? [], context);
      return row;
    });
    await audit(context, "WORK_COMMITMENT_CREATED", "WorkCommitment", created.id, { fromSuggestion: Boolean(extra.sourceAiActionId) });
    if (owner.member && owner.member.id !== context.membershipId) {
      await notifyWork(context, [{ userId: owner.member.userId }], {
        type: "ACTION_REQUIRED",
        title: `Commitment assigned to you: ${created.title}`,
        body: created.dueAt ? `Due ${created.dueAt.toISOString().slice(0, 10)}.` : "No due date yet.",
        linkPath: `/mail/work-graph/commitments?id=${created.id}`,
      });
    }
    return this.get(created.id, context);
  }

  async update(id: string, input: UpdateCommitmentInput, context: WorkContext) {
    const row = await this.editable(id, context);
    const { ownerEmail, ownerLabel, streamId, status, visibility, timeZone, ...fields } = input;
    if (visibility !== undefined && row.createdByMembershipId !== context.membershipId) {
      throw forbidden("Only its creator can change who it is shared with.", "COMMITMENT_VISIBILITY");
    }
    const owner = ownerEmail !== undefined || ownerLabel !== undefined ? await resolveOwner({ ownerEmail, ownerLabel }, context, false) : null;
    if (owner && !owner.ownerMembershipId && !owner.ownerLabel) {
      throw new AppError("Someone has to be accountable for it.", 400, ErrorCodes.VALIDATION_ERROR, [{ path: "ownerEmail", message: "Name an owner" }]);
    }
    // Only moving into a workstream is checked; an item may stay in one that has since been archived.
    if (streamId && streamId !== row.streamId) await requireStream(streamId, context);

    const becameRecorded = status === "RECORDED" && row.status !== "RECORDED";
    const becameCancelled = status === "CANCELLED" && row.status !== "CANCELLED";
    await prisma.workCommitment.update({
      where: { id: row.id, tenantId: context.tenantId },
      data: {
        ...fields,
        ...(timeZone !== undefined ? { timeZone: checkZone(timeZone) } : {}),
        ...(streamId !== undefined ? { streamId } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        ...(owner ? { ownerMembershipId: owner.ownerMembershipId, ownerLabel: owner.ownerLabel } : {}),
        ...(status !== undefined
          ? { status, recordedAt: status === "RECORDED" ? (row.recordedAt ?? new Date()) : null }
          : {}),
      },
    });
    await audit(context, "WORK_COMMITMENT_UPDATED", "WorkCommitment", id, { changed: Object.keys(input), ...(status ? { status } : {}) });

    if (becameRecorded) await dependencyService.blockerChanged("COMMITMENT", id, "RESOLVED", "recorded", row.title, context);
    if (becameCancelled) await dependencyService.blockerChanged("COMMITMENT", id, "BLOCKED", "cancelled", row.title, context);

    const updated = await this.get(id, context);
    if (owner?.member && owner.member.id !== row.ownerMembershipId && owner.member.id !== context.membershipId) {
      await notifyWork(context, [{ userId: owner.member.userId }], {
        type: "ACTION_REQUIRED",
        title: `Commitment assigned to you: ${row.title}`,
        body: updated.dueAt ? `Due ${updated.dueAt.toISOString().slice(0, 10)}.` : "No due date yet.",
        linkPath: `/mail/work-graph/commitments?id=${id}`,
      });
    }
    if (becameRecorded && row.createdByMembershipId && row.createdByMembershipId !== context.membershipId) {
      const creator = await prisma.tenantMembership.findUnique({ where: { id: row.createdByMembershipId }, select: { userId: true } });
      await notifyWork(context, [{ userId: creator?.userId }], {
        title: `Recorded: ${row.title}`,
        body: `${nameOf((await prisma.tenantMembership.findUniqueOrThrow({ where: { id: context.membershipId }, select: { user: { select: { email: true, displayName: true } } } })).user)} recorded it as fulfilled.`,
        linkPath: `/mail/work-graph/commitments?id=${id}`,
      });
    }
    return updated;
  }

  async remove(id: string, context: WorkContext) {
    const row = await prisma.workCommitment.findFirst({ where: { id, ...visibleWhere(context) } });
    if (!row) throw notFound("Commitment");
    if (row.createdByMembershipId !== context.membershipId) throw forbidden("Only its creator can delete it.", "COMMITMENT_DELETE");
    const holding = await prisma.workDependency.count({ where: { tenantId: context.tenantId, blockerCommitmentId: id, resolvedAt: null } });
    if (holding > 0) {
      throw new AppError("Deliverables are waiting on it. Remove or reassign them first, or cancel it instead.", 409, ErrorCodes.CONFLICT, { reason: "HAS_DEPENDENCIES" });
    }
    await prisma.$transaction(async (tx) => {
      await deleteEvidenceFor(tx, "COMMITMENT", id, context);
      await tx.workCommitment.delete({ where: { id, tenantId: context.tenantId } });
    });
    await audit(context, "WORK_COMMITMENT_DELETED", "WorkCommitment", id);
  }

  private async editable(id: string, context: WorkContext) {
    const row = await prisma.workCommitment.findFirst({ where: { id, ...visibleWhere(context) } });
    if (!row) throw notFound("Commitment");
    if (row.createdByMembershipId !== context.membershipId && row.ownerMembershipId !== context.membershipId) {
      throw forbidden("Only its creator or owner can change it.", "COMMITMENT_ACCESS");
    }
    return row;
  }
}

export const commitmentService = new CommitmentService();
