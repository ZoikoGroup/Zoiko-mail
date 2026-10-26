import { createHash } from "node:crypto";
import type { Prisma, WorkDecisionStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
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
  isWorkspaceAdmin,
  memberByEmail,
  memberSelect,
  nameOf,
  notFound,
  notifyWork,
  ownerView,
  requireStream,
  resolveOwner,
  visibleWhere,
  type WorkContext,
} from "./workgraph.shared.js";
import type { DecideInput, DecisionInput, ListDecisionsInput, UpdateDecisionInput } from "./workgraph.schema.js";

/**
 * Decisions: outcomes people recorded, and pending ones waiting for approval.
 *
 * Only the person named as approver can approve, defer or supersede one. If
 * nobody was named, only a workspace Owner or Admin can. Nothing automatic —
 * including Alet — can grant an approval, and every outcome is attributed to
 * the person who gave it.
 */

const include = {
  owner: { select: memberSelect },
  approver: { select: memberSelect },
  decidedBy: { select: memberSelect },
  stream: { select: { id: true, title: true } },
  createdBy: { select: memberSelect },
} satisfies Prisma.WorkDecisionInclude;

type Row = Prisma.WorkDecisionGetPayload<{ include: typeof include }>;

/** A list shows at most this many; the response says when there were more. */
const LIST_LIMIT = 300;

/** Where a decision may go from where it is. A superseded one is final. */
const NEXT: Record<WorkDecisionStatus, WorkDecisionStatus[]> = {
  PENDING: ["APPROVED", "DEFERRED", "SUPERSEDED"],
  DEFERRED: ["APPROVED", "SUPERSEDED"],
  APPROVED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

const visibleDecisions = (context: WorkContext) => visibleWhere(context, [{ approverMembershipId: context.membershipId }]);

/** Whether the caller is authorised to give an outcome on this decision. */
function mayDecide(row: { approverMembershipId: string | null }, context: WorkContext): boolean {
  return row.approverMembershipId ? row.approverMembershipId === context.membershipId : isWorkspaceAdmin(context);
}

async function toViews(rows: Row[], context: WorkContext) {
  const ids = rows.map((r) => r.id);
  const replacedBy = rows.map((r) => r.supersededById).filter((id): id is string => Boolean(id));
  const [evidence, impact, replacements] = await Promise.all([
    evidenceViews("DECISION", ids, context),
    dependencyService.impact("DECISION", ids, context),
    replacedBy.length ? prisma.workDecision.findMany({ where: { id: { in: replacedBy }, ...visibleDecisions(context) }, select: { id: true, title: true } }) : [],
  ]);
  const replacement = new Map(replacements.map((r) => [r.id, r.title]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    rationale: r.rationale,
    stream: r.stream,
    owner: ownerView(r.owner, r.ownerLabel, context),
    approver: r.approver ? { name: nameOf(r.approver.user), email: r.approver.user.email, isMe: r.approver.id === context.membershipId } : null,
    reviewAt: r.reviewAt,
    timeZone: r.timeZone,
    status: r.status,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy ? nameOf(r.decidedBy.user) : null,
    decisionNote: r.decisionNote,
    supersededBy: r.supersededById ? { id: r.supersededById, title: replacement.get(r.supersededById) ?? "Another decision" } : null,
    visibility: r.visibility,
    fromSuggestion: Boolean(r.sourceAiActionId),
    createdBy: r.createdBy
      ? { name: nameOf(r.createdBy.user), email: r.createdBy.user.email, isMe: r.createdByMembershipId === context.membershipId }
      : FORMER_MEMBER,
    /** Whether this caller may give an outcome right now, and who can if not. */
    canDecide: NEXT[r.status].length > 0 && mayDecide(r, context),
    authority: r.approver ? `Only ${nameOf(r.approver.user)} can approve this.` : "Nobody was named, so only a workspace Owner or Admin can approve this.",
    canEdit: r.createdByMembershipId === context.membershipId || r.ownerMembershipId === context.membershipId,
    isCreator: r.createdByMembershipId === context.membershipId,
    impact: impact.get(r.id) ?? { blocked: 0, deliverables: [] },
    evidence: evidence.get(r.id) ?? [],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

function baseWhere(input: Pick<ListDecisionsInput, "scope" | "days">, context: WorkContext): Prisma.WorkDecisionWhereInput {
  const since = input.days > 0 ? new Date(Date.now() - input.days * 86_400_000) : null;
  return {
    ...visibleDecisions(context),
    ...(input.scope === "owned" ? { ownerMembershipId: context.membershipId } : input.scope === "created" ? { createdByMembershipId: context.membershipId } : {}),
    // Settled ones only while they are recent; pending ones always.
    ...(since ? { AND: [{ OR: [{ status: "PENDING" as const }, { decidedAt: { gte: since } }, { createdAt: { gte: since } }] }] } : {}),
  } as Prisma.WorkDecisionWhereInput;
}

export class DecisionService {
  async list(input: ListDecisionsInput, context: WorkContext) {
    const base = baseWhere(input, context);
    const tabWhere: Prisma.WorkDecisionWhereInput = input.tab === "awaiting" ? { status: "PENDING" } : input.tab === "approved" ? { status: "APPROVED" } : {};
    let search: Prisma.WorkDecisionWhereInput = {};
    if (input.q) {
      const evidence = await prisma.workEvidence.findMany({
        where: { tenantId: context.tenantId, subjectType: "DECISION", label: { contains: input.q, mode: "insensitive" } },
        select: { subjectId: true },
        take: 200,
      });
      search = {
        OR: [
          { title: { contains: input.q, mode: "insensitive" } },
          { rationale: { contains: input.q, mode: "insensitive" } },
          { ownerLabel: { contains: input.q, mode: "insensitive" } },
          { id: { in: evidence.map((e) => e.subjectId) } },
        ],
      };
    }
    const [rows, recorded, awaiting, blocked, suggestions] = await Promise.all([
      prisma.workDecision.findMany({ where: { AND: [base, tabWhere, search] }, include, orderBy: [{ createdAt: "desc" }], take: LIST_LIMIT }),
      prisma.workDecision.count({ where: base }),
      prisma.workDecision.count({ where: { AND: [base, { status: "PENDING" }] } }),
      prisma.workDependency.count({ where: { ...visibleWhere(context), resolvedAt: null } }),
      countSuggestions(context, "DECISION"),
    ]);
    // Waiting for a decision first (soonest review first), then the rest, newest first.
    rows.sort((a, b) => {
      const ap = a.status === "PENDING" ? 0 : 1;
      const bp = b.status === "PENDING" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const at = (a.reviewAt ?? a.decidedAt ?? a.createdAt).getTime();
      const bt = (b.reviewAt ?? b.decidedAt ?? b.createdAt).getTime();
      return ap === 0 ? at - bt : bt - at;
    });
    return { items: await toViews(rows, context), truncated: rows.length >= LIST_LIMIT, summary: { recorded, awaiting, blocked, suggestions } };
  }

  async get(id: string, context: WorkContext) {
    const row = await prisma.workDecision.findFirst({ where: { id, ...visibleDecisions(context) }, include });
    if (!row) throw notFound("Decision");
    return (await toViews([row], context))[0]!;
  }

  async create(input: DecisionInput, context: WorkContext, extra: { sourceAiActionId?: string } = {}) {
    const owner = await resolveOwner(input, context);
    const approver = input.approverEmail ? await memberByEmail(input.approverEmail, context) : null;
    if (input.streamId) await requireStream(input.streamId, context);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.workDecision.create({
        data: {
          tenantId: context.tenantId,
          streamId: input.streamId ?? null,
          title: input.title,
          rationale: input.rationale ?? null,
          ownerMembershipId: owner.ownerMembershipId,
          ownerLabel: owner.ownerLabel,
          approverMembershipId: approver?.id ?? null,
          reviewAt: input.reviewAt ?? null,
          timeZone: checkZone(input.timeZone),
          visibility: input.visibility ?? "PRIVATE",
          sourceAiActionId: extra.sourceAiActionId ?? null,
          createdByMembershipId: context.membershipId,
        },
      });
      await attachEvidence(tx, "DECISION", row.id, input.evidence ?? [], context);
      return row;
    });
    await audit(context, "WORK_DECISION_CREATED", "WorkDecision", created.id, { fromSuggestion: Boolean(extra.sourceAiActionId) });
    if (approver && approver.id !== context.membershipId) {
      await notifyWork(context, [{ userId: approver.userId }], {
        type: "ACTION_REQUIRED",
        title: `Approval requested: ${created.title}`,
        body: created.reviewAt ? `Review by ${created.reviewAt.toISOString().slice(0, 10)}.` : "No review date yet.",
        linkPath: `/mail/work-graph/decisions?id=${created.id}`,
      });
    }
    return this.get(created.id, context);
  }

  async update(id: string, input: UpdateDecisionInput, context: WorkContext) {
    const row = await prisma.workDecision.findFirst({ where: { id, ...visibleDecisions(context) } });
    if (!row) throw notFound("Decision");
    if (row.createdByMembershipId !== context.membershipId && row.ownerMembershipId !== context.membershipId) {
      throw forbidden("Only its creator or owner can change it. The approver gives the outcome.", "DECISION_ACCESS");
    }
    const { ownerEmail, ownerLabel, approverEmail, streamId, visibility, timeZone, ...fields } = input;
    if (visibility !== undefined && row.createdByMembershipId !== context.membershipId) {
      throw forbidden("Only its creator can change who it is shared with.", "DECISION_VISIBILITY");
    }
    if (approverEmail !== undefined && row.status !== "PENDING") {
      throw new AppError("The approver cannot change once a decision has been given.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_DECIDED" });
    }
    const owner = ownerEmail !== undefined || ownerLabel !== undefined ? await resolveOwner({ ownerEmail, ownerLabel }, context, false) : null;
    if (owner && !owner.ownerMembershipId && !owner.ownerLabel) {
      throw new AppError("Someone has to own it.", 400, ErrorCodes.VALIDATION_ERROR, [{ path: "ownerEmail", message: "Name an owner" }]);
    }
    const approver = approverEmail ? await memberByEmail(approverEmail, context) : null;
    // Only moving into a workstream is checked; an item may stay in one that has since been archived.
    if (streamId && streamId !== row.streamId) await requireStream(streamId, context);

    await prisma.workDecision.update({
      where: { id: row.id, tenantId: context.tenantId },
      data: {
        ...fields,
        ...(timeZone !== undefined ? { timeZone: checkZone(timeZone) } : {}),
        ...(streamId !== undefined ? { streamId } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        ...(owner ? { ownerMembershipId: owner.ownerMembershipId, ownerLabel: owner.ownerLabel } : {}),
        ...(approverEmail !== undefined ? { approverMembershipId: approver?.id ?? null } : {}),
      },
    });
    await audit(context, "WORK_DECISION_UPDATED", "WorkDecision", id, { changed: Object.keys(input) });
    if (approver && approver.id !== row.approverMembershipId && approver.id !== context.membershipId) {
      await notifyWork(context, [{ userId: approver.userId }], {
        type: "ACTION_REQUIRED",
        title: `Approval requested: ${row.title}`,
        body: "You were named as the approver.",
        linkPath: `/mail/work-graph/decisions?id=${id}`,
      });
    }
    return this.get(id, context);
  }

  /** Approve, defer or supersede. Only the named approver (or, with none named, a workspace Owner or Admin). */
  async decide(id: string, input: DecideInput, context: WorkContext) {
    const row = await prisma.workDecision.findFirst({ where: { id, ...visibleDecisions(context) }, include });
    if (!row) throw notFound("Decision");
    if (!mayDecide(row, context)) {
      throw forbidden(
        row.approver ? `Only ${nameOf(row.approver.user)} can give an outcome on this decision.` : "Only a workspace Owner or Admin can give an outcome on a decision with no named approver.",
        "NOT_AUTHORISED_APPROVER"
      );
    }
    if (!NEXT[row.status].includes(input.outcome)) {
      throw new AppError(`A ${row.status.toLowerCase()} decision cannot become ${input.outcome.toLowerCase()}.`, 409, ErrorCodes.CONFLICT, { reason: "INVALID_TRANSITION" });
    }
    if (input.outcome === "SUPERSEDED") {
      if (input.supersededById === id) throw new AppError("A decision cannot replace itself.", 400, ErrorCodes.VALIDATION_ERROR, [{ path: "supersededById", message: "Choose another decision" }]);
      const replacement = await prisma.workDecision.findFirst({ where: { id: input.supersededById!, ...visibleDecisions(context) }, select: { status: true } });
      if (!replacement) throw notFound("Replacement decision");
      if (replacement.status === "SUPERSEDED") {
        throw new AppError("That decision was itself replaced.", 409, ErrorCodes.CONFLICT, { reason: "REPLACEMENT_SUPERSEDED" });
      }
    }
    const now = new Date();
    // Only if it is still as we read it: two outcomes arriving together must not both apply.
    const applied = await prisma.workDecision.updateMany({
      where: { id, tenantId: context.tenantId, status: row.status },
      data: {
        status: input.outcome,
        decidedAt: now,
        decidedByMembershipId: context.membershipId,
        decisionNote: input.note ?? null,
        supersededById: input.outcome === "SUPERSEDED" ? input.supersededById! : null,
      },
    });
    if (applied.count === 0) {
      throw new AppError("This decision was just changed by someone else. Reload it and try again.", 409, ErrorCodes.CONFLICT, { reason: "CHANGED_MEANWHILE" });
    }
    // The trail proves who decided what, and when, without copying the note into a second store.
    await recordOutcome(context, id, row.status, input);

    const word = { APPROVED: "approved", DEFERRED: "deferred", SUPERSEDED: "superseded" }[input.outcome];
    if (input.outcome === "APPROVED") await dependencyService.blockerChanged("DECISION", id, "RESOLVED", "approved", row.title, context);
    else await dependencyService.blockerChanged("DECISION", id, "BLOCKED", word, row.title, context);

    const who = nameOf((await prisma.tenantMembership.findUniqueOrThrow({ where: { id: context.membershipId }, select: { user: { select: { email: true, displayName: true } } } })).user);
    await notifyWork(context, [{ userId: row.createdBy?.userId }, { userId: row.owner?.userId }], {
      title: `Decision ${word}: ${row.title}`,
      body: input.note ? `${who}: ${input.note}` : `${who} ${word} it.`,
      linkPath: `/mail/work-graph/decisions?id=${id}`,
    });
    return this.get(id, context);
  }

  async remove(id: string, context: WorkContext) {
    const row = await prisma.workDecision.findFirst({ where: { id, ...visibleDecisions(context) } });
    if (!row) throw notFound("Decision");
    if (row.createdByMembershipId !== context.membershipId) throw forbidden("Only its creator can delete it.", "DECISION_DELETE");
    const holding = await prisma.workDependency.count({ where: { tenantId: context.tenantId, blockerDecisionId: id, resolvedAt: null } });
    if (holding > 0) {
      throw new AppError("Deliverables are waiting on it. Remove or reassign them first.", 409, ErrorCodes.CONFLICT, { reason: "HAS_DEPENDENCIES" });
    }
    await prisma.$transaction(async (tx) => {
      await deleteEvidenceFor(tx, "DECISION", id, context);
      // A decision it replaced no longer points at something that is gone.
      await tx.workDecision.updateMany({ where: { tenantId: context.tenantId, supersededById: id }, data: { supersededById: null } });
      await tx.workDecision.delete({ where: { id, tenantId: context.tenantId } });
    });
    await audit(context, "WORK_DECISION_DELETED", "WorkDecision", id);
  }
}

async function recordOutcome(context: WorkContext, id: string, before: WorkDecisionStatus, input: DecideInput) {
  await auditService.record({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    eventType: "WORK_DECISION_DECIDED",
    targetType: "WorkDecision",
    targetId: id,
    requestId: context.requestId,
    metadata: { outcome: input.outcome, from: before, noted: Boolean(input.note) },
    beforeHash: createHash("sha256").update(before).digest("hex"),
    afterHash: createHash("sha256").update(input.outcome).digest("hex"),
  });
}

export const decisionService = new DecisionService();
