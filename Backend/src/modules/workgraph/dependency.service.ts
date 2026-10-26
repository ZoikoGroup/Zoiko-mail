import type { Prisma, WorkBlockerType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import {
  audit,
  memberSelect,
  notFound,
  notifyWork,
  ownerView,
  requireStream,
  resolveOwner,
  visibleWhere,
  type WorkContext,
} from "./workgraph.shared.js";
import type { DependencyInput, ListDependenciesInput, UpdateDependencyInput } from "./workgraph.schema.js";

/**
 * Dependencies: a deliverable that cannot proceed until a decision is approved
 * or a commitment is recorded. It unblocks itself (and tells its owner) the
 * moment that happens; if the blocker is deferred, superseded or cancelled,
 * the owner is told it is blocked, once.
 */

const include = {
  owner: { select: memberSelect },
  stream: { select: { id: true, title: true } },
  blockerDecision: { select: { id: true, title: true, status: true, reviewAt: true } },
  blockerCommitment: { select: { id: true, title: true, status: true, dueAt: true } },
} satisfies Prisma.WorkDependencyInclude;

type Row = Prisma.WorkDependencyGetPayload<{ include: typeof include }>;
export type DependencyState = "WAITING" | "BLOCKED" | "UNBLOCKED";

export function stateOf(dep: Row, now = new Date()): DependencyState {
  if (dep.resolvedAt) return "UNBLOCKED";
  const decision = dep.blockerDecision;
  if (decision) {
    if (decision.status === "PENDING") return "WAITING";
    if (decision.status === "APPROVED") return "UNBLOCKED";
    return "BLOCKED"; // deferred or superseded
  }
  const commitment = dep.blockerCommitment;
  if (commitment) {
    if (commitment.status === "RECORDED") return "UNBLOCKED";
    if (commitment.status === "CANCELLED") return "BLOCKED";
    return commitment.dueAt && commitment.dueAt < now ? "BLOCKED" : "WAITING";
  }
  return "BLOCKED";
}

function stateLabel(dep: Row, state: DependencyState): string {
  if (state === "UNBLOCKED") return "Unblocked";
  if (state === "WAITING") return dep.blockerType === "DECISION" ? "Waiting on approval" : "Waiting on commitment";
  return dep.notifiedAt ? "Blocked · owner notified" : "Blocked";
}

function view(dep: Row, context: WorkContext) {
  const state = stateOf(dep);
  const blocker = dep.blockerDecision ?? dep.blockerCommitment;
  return {
    id: dep.id,
    deliverable: dep.deliverable,
    description: dep.description,
    owner: ownerView(dep.owner, dep.ownerLabel, context),
    blocker: {
      type: dep.blockerType,
      id: blocker?.id ?? null,
      title: blocker?.title ?? "Removed item",
      status: (dep.blockerDecision?.status ?? dep.blockerCommitment?.status ?? null) as string | null,
    },
    state,
    stateLabel: stateLabel(dep, state),
    notified: Boolean(dep.notifiedAt),
    resolvedAt: dep.resolvedAt,
    stream: dep.stream,
    visibility: dep.visibility,
    isMine: dep.ownerMembershipId === context.membershipId,
    canEdit: dep.createdByMembershipId === context.membershipId || dep.ownerMembershipId === context.membershipId,
    createdAt: dep.createdAt,
    updatedAt: dep.updatedAt,
  };
}

export class DependencyService {
  async list(input: ListDependenciesInput, context: WorkContext) {
    const rows = await prisma.workDependency.findMany({
      where: {
        ...visibleWhere(context),
        ...(input.state === "open" ? { resolvedAt: null } : {}),
        ...(input.q
          ? {
              AND: [
                {
                  OR: [
                    { deliverable: { contains: input.q, mode: "insensitive" as const } },
                    { blockerDecision: { title: { contains: input.q, mode: "insensitive" as const } } },
                    { blockerCommitment: { title: { contains: input.q, mode: "insensitive" as const } } },
                  ],
                },
              ],
            }
          : {}),
      },
      include,
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: 300,
    });
    return rows.map((r) => view(r, context));
  }

  async create(input: DependencyInput, context: WorkContext) {
    const blocker =
      input.blockerType === "DECISION"
        ? await prisma.workDecision.findFirst({
            where: { id: input.blockerId, ...visibleWhere(context, [{ approverMembershipId: context.membershipId }]) },
            select: { id: true, title: true, status: true, streamId: true },
          })
        : await prisma.workCommitment.findFirst({
            where: { id: input.blockerId, ...visibleWhere(context) },
            select: { id: true, title: true, status: true, streamId: true },
          });
    if (!blocker) throw notFound(input.blockerType === "DECISION" ? "Decision" : "Commitment");
    if (blocker.status === "APPROVED" || blocker.status === "RECORDED" || blocker.status === "CANCELLED" || blocker.status === "SUPERSEDED") {
      throw new AppError("That is already settled, so nothing can be blocked on it.", 409, ErrorCodes.CONFLICT, { reason: "BLOCKER_SETTLED" });
    }
    const owner = await resolveOwner(input, context);
    const streamId = input.streamId === undefined ? blocker.streamId : input.streamId;
    if (streamId) await requireStream(streamId, context);

    const notify = Boolean(owner.member && owner.member.id !== context.membershipId);
    const created = await prisma.workDependency.create({
      data: {
        tenantId: context.tenantId,
        streamId,
        deliverable: input.deliverable,
        description: input.description ?? null,
        ownerMembershipId: owner.ownerMembershipId,
        ownerLabel: owner.ownerLabel,
        blockerType: input.blockerType,
        blockerDecisionId: input.blockerType === "DECISION" ? blocker.id : null,
        blockerCommitmentId: input.blockerType === "COMMITMENT" ? blocker.id : null,
        visibility: input.visibility ?? "PRIVATE",
        createdByMembershipId: context.membershipId,
        notifiedAt: notify ? new Date() : null,
      },
      include,
    });
    await audit(context, "WORK_DEPENDENCY_CREATED", "WorkDependency", created.id, { blockerType: input.blockerType, blockerId: blocker.id });
    if (notify) {
      await notifyWork(context, [{ userId: owner.member!.userId }], {
        type: "INFO",
        title: `Blocked: ${input.deliverable}`,
        body: `Waiting on ${blocker.title}. You will be told when it is settled.`,
        linkPath: `/mail/work-graph/dependencies?id=${created.id}`,
      });
    }
    return view(created, context);
  }

  async update(id: string, input: UpdateDependencyInput, context: WorkContext) {
    const dep = await this.editable(id, context);
    const { resolved, ownerEmail, ownerLabel, streamId, ...fields } = input;
    const owner = ownerEmail !== undefined || ownerLabel !== undefined ? await resolveOwner({ ownerEmail, ownerLabel }, context, false) : null;
    if (owner && !owner.ownerMembershipId && !owner.ownerLabel) {
      throw new AppError("Someone has to own it.", 400, ErrorCodes.VALIDATION_ERROR, [{ path: "ownerEmail", message: "Name an owner" }]);
    }
    // Only moving into a workstream is checked; an item may stay in one that has since been archived.
    if (streamId && streamId !== dep.streamId) await requireStream(streamId, context);
    const updated = await prisma.workDependency.update({
      where: { id: dep.id, tenantId: context.tenantId },
      data: {
        ...fields,
        ...(streamId !== undefined ? { streamId } : {}),
        ...(owner ? { ownerMembershipId: owner.ownerMembershipId, ownerLabel: owner.ownerLabel } : {}),
        ...(resolved === true ? { resolvedAt: new Date() } : resolved === false ? { resolvedAt: null } : {}),
      },
      include,
    });
    await audit(context, "WORK_DEPENDENCY_UPDATED", "WorkDependency", id, { changed: Object.keys(input) });
    return view(updated, context);
  }

  async remove(id: string, context: WorkContext) {
    const dep = await this.editable(id, context);
    await prisma.workDependency.delete({ where: { id: dep.id, tenantId: context.tenantId } });
    await audit(context, "WORK_DEPENDENCY_DELETED", "WorkDependency", id);
  }

  private async editable(id: string, context: WorkContext) {
    const dep = await prisma.workDependency.findFirst({ where: { id, ...visibleWhere(context) } });
    if (!dep) throw notFound("Dependency");
    if (dep.createdByMembershipId !== context.membershipId && dep.ownerMembershipId !== context.membershipId) {
      throw new AppError("Only its creator or owner can change it.", 403, ErrorCodes.FORBIDDEN, { reason: "DEPENDENCY_ACCESS" });
    }
    return dep;
  }

  /**
   * A blocker was settled (RESOLVED) or turned out not to be coming
   * (BLOCKED: deferred, superseded or cancelled). Tell the deliverables' owners.
   */
  async blockerChanged(
    blockerType: WorkBlockerType,
    blockerId: string,
    outcome: "RESOLVED" | "BLOCKED",
    reason: string,
    blockerTitle: string,
    context: WorkContext
  ): Promise<number> {
    const deps = await prisma.workDependency.findMany({
      where: {
        tenantId: context.tenantId,
        resolvedAt: null,
        ...(blockerType === "DECISION" ? { blockerDecisionId: blockerId } : { blockerCommitmentId: blockerId }),
      },
      include: { owner: { select: memberSelect }, createdBy: { select: memberSelect } },
    });
    if (deps.length === 0) return 0;
    if (outcome === "RESOLVED") {
      await prisma.workDependency.updateMany({ where: { id: { in: deps.map((d) => d.id) }, tenantId: context.tenantId }, data: { resolvedAt: new Date() } });
      for (const dep of deps) {
        await notifyWork(context, [{ userId: dep.owner?.userId }, { userId: dep.createdBy?.userId }], {
          type: "INFO",
          title: `Unblocked: ${dep.deliverable}`,
          body: `${blockerTitle} is ${reason}, so it can go ahead.`,
          linkPath: `/mail/work-graph/dependencies?id=${dep.id}`,
        });
      }
    } else {
      const fresh = deps.filter((d) => !d.notifiedAt);
      if (fresh.length > 0) {
        await prisma.workDependency.updateMany({ where: { id: { in: fresh.map((d) => d.id) }, tenantId: context.tenantId }, data: { notifiedAt: new Date() } });
      }
      for (const dep of fresh) {
        await notifyWork(context, [{ userId: dep.owner?.userId }], {
          type: "ACTION_REQUIRED",
          title: `Blocked: ${dep.deliverable}`,
          body: `${blockerTitle} was ${reason}. It cannot go ahead until that is sorted.`,
          linkPath: `/mail/work-graph/dependencies?id=${dep.id}`,
        });
      }
    }
    return deps.length;
  }

  /** How many open deliverables each decision or commitment is holding up, as the caller may see them. */
  async impact(blockerType: WorkBlockerType, ids: string[], context: WorkContext) {
    const out = new Map<string, { blocked: number; deliverables: string[] }>();
    if (ids.length === 0) return out;
    const rows = await prisma.workDependency.findMany({
      where: {
        ...visibleWhere(context),
        resolvedAt: null,
        ...(blockerType === "DECISION" ? { blockerDecisionId: { in: ids } } : { blockerCommitmentId: { in: ids } }),
      },
      select: { deliverable: true, blockerDecisionId: true, blockerCommitmentId: true },
    });
    for (const r of rows) {
      const key = (blockerType === "DECISION" ? r.blockerDecisionId : r.blockerCommitmentId)!;
      const entry = out.get(key) ?? { blocked: 0, deliverables: [] };
      entry.blocked += 1;
      entry.deliverables.push(r.deliverable);
      out.set(key, entry);
    }
    return out;
  }
}

export const dependencyService = new DependencyService();
