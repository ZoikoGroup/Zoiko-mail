import { randomUUID } from "node:crypto";
import type { LifecycleTargetType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

/**
 * The hard-delete service-level agreement — AC-012, Data Model §6.14.
 *
 * "Customer data subject to deletion must be hard-deleted or irreversibly
 * anonymized within 30 days unless legal/security retention exception
 * applies."
 *
 * The deletion workflow already worked: requested, approved, confirmed by
 * name, executed with a receipt. What it had no way to express was *when*.
 * There was no verification moment to count from, no deadline, no legal hold,
 * and so no answer to "is this deletion late" — which is the only question an
 * SLA actually asks.
 *
 * Three rules hold everything else together:
 *
 *   1. The deadline is derived here, from the verification time, and is never
 *      accepted from a client. §6.14 says the scheduler enforces 30 days; a
 *      client-supplied deadline would make that a suggestion.
 *   2. Scheduling inside the window is allowed, past it is refused — both here
 *      and by a CHECK constraint, because a scheduling bug that pushed
 *      execution past the deadline would breach the SLA silently.
 *   3. A legal hold suspends the clock rather than extending it. Clearing the
 *      deadline is what makes a blocked request legible as "no longer counting
 *      down" instead of "eternally overdue", and lifting the hold starts a
 *      fresh 30 days from the new verification.
 */

/** §6.14: no later than verified_at + 30 days. */
export const HARD_DELETE_SLA_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Targets that have an executor. Anything else is refused rather than queued. */
const EXECUTABLE_TARGETS: LifecycleTargetType[] = ["TENANT", "USER"];

export function hardDeleteDeadlineFrom(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + HARD_DELETE_SLA_DAYS * DAY_MS);
}

interface ActorContext {
  tenantId: string;
  userId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Statuses a hold can still be placed on: anything not already underway. */
const BLOCKABLE: Prisma.EnumLifecycleStatusFilter = {
  in: ["REQUESTED", "VERIFIED", "APPROVED", "SCHEDULED"],
};

/** Statuses that still owe the workspace a deletion. */
const OPEN_STATUSES: Prisma.EnumLifecycleStatusFilter = {
  in: ["REQUESTED", "VERIFIED", "APPROVED", "SCHEDULED", "PROCESSING"],
};

export class LifecycleService {
  /** Assert that a target type can actually be executed (§6.14). */
  assertExecutableTarget(targetType: LifecycleTargetType): void {
    if (!EXECUTABLE_TARGETS.includes(targetType)) {
      throw new AppError(
        `Deletion of ${targetType} targets is not implemented yet`,
        422,
        ErrorCodes.VALIDATION_ERROR,
        { targetType, executable: EXECUTABLE_TARGETS }
      );
    }
  }

  private async open(tenantId: string, requestId: string, status: Prisma.EnumLifecycleStatusFilter) {
    const request = await prisma.dataLifecycleRequest.findFirst({
      where: { id: requestId, tenantId, type: "DELETION", status },
      include: { job: { select: { id: true, status: true } } },
    });
    if (!request) {
      throw new AppError("Deletion request not found in that state", 404, ErrorCodes.NOT_FOUND);
    }
    return request;
  }

  /**
   * Place a legal or security hold.
   *
   * The deadline is cleared, not extended: a blocked request is not counting
   * down, and leaving a stale deadline on it would make SLA monitoring report
   * a breach for data the workspace is legally required to keep.
   */
  async block(
    tenantId: string,
    requestId: string,
    reason: string,
    context: ActorContext
  ) {
    const request = await this.open(tenantId, requestId, BLOCKABLE);

    const updated = await prisma.$transaction(async (tx) => {
      // A pending job must not fire while the hold stands. Cancelled rather
      // than postponed, because lifting the hold re-verifies and enqueues a
      // fresh one with a fresh deadline.
      if (request.job) {
        await tx.backgroundJob.updateMany({
          where: { id: request.job.id, tenantId, status: { in: ["PENDING", "RETRY"] } },
          data: { status: "CANCELLED", completedAt: new Date() },
        });
      }
      const row = await tx.dataLifecycleRequest.update({
        where: { id: request.id, tenantId },
        data: {
          status: "BLOCKED",
          blockReason: reason,
          hardDeleteDeadline: null,
          scheduledFor: null,
        },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: context.userId,
          eventType: "DATA_DELETION_BLOCKED",
          targetType: "DataLifecycleRequest",
          targetId: request.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          // The basis is the whole point of the record: a hold with no stated
          // reason is indistinguishable from a missed deadline.
          metadata: { reason, previousStatus: request.status },
        },
        tx
      );
      return row;
    });

    return updated;
  }

  /**
   * Lift a hold, which starts a fresh 30 days.
   *
   * Deliberately not a resumption of the old countdown: the data was lawfully
   * retained while blocked, and §6.14 measures the window from verification,
   * so the honest thing is to verify again now.
   */
  async unblock(tenantId: string, requestId: string, context: ActorContext) {
    const request = await this.open(tenantId, requestId, { in: ["BLOCKED"] });
    const verifiedAt = new Date();

    return prisma.$transaction(async (tx) => {
      const row = await tx.dataLifecycleRequest.update({
        where: { id: request.id, tenantId },
        data: {
          status: "REQUESTED",
          blockReason: null,
          verifiedAt: null,
          hardDeleteDeadline: null,
          approvedAt: null,
          jobId: null,
        },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: context.userId,
          eventType: "DATA_DELETION_UNBLOCKED",
          targetType: "DataLifecycleRequest",
          targetId: request.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            previousBlockReason: request.blockReason,
            // Approval starts the clock again, so the request goes back to
            // REQUESTED rather than silently inheriting an expired deadline.
            requiresReapproval: true,
            verifiedAtCleared: verifiedAt.toISOString(),
          },
        },
        tx
      );
      return row;
    });
  }

  /**
   * Move execution to a later time inside the window.
   *
   * The worker only claims jobs whose `runAt` has arrived, so writing the time
   * onto the job is what actually defers the deletion — the column alone would
   * be a note to nobody.
   */
  async schedule(
    tenantId: string,
    requestId: string,
    scheduledFor: Date,
    context: ActorContext
  ) {
    const request = await this.open(tenantId, requestId, { in: ["APPROVED", "SCHEDULED"] });

    if (scheduledFor.getTime() <= Date.now()) {
      throw new AppError(
        "Scheduled execution must be in the future",
        422,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    if (!request.hardDeleteDeadline) {
      throw new AppError(
        "This request has no hard-delete deadline to schedule within",
        409,
        ErrorCodes.CONFLICT
      );
    }
    // Captured before the transaction: the narrowing above does not survive
    // into the closure below.
    const deadline = request.hardDeleteDeadline;
    if (scheduledFor > deadline) {
      // §6.14: "scheduled_for must be <= hard_delete_deadline". Refused here
      // with a usable message; the CHECK constraint is the backstop.
      throw new AppError(
        "Scheduled execution would fall after the 30-day hard-delete deadline",
        422,
        ErrorCodes.VALIDATION_ERROR,
        {
          scheduledFor: scheduledFor.toISOString(),
          hardDeleteDeadline: deadline.toISOString(),
        }
      );
    }

    return prisma.$transaction(async (tx) => {
      if (request.job) {
        await tx.backgroundJob.updateMany({
          where: { id: request.job.id, tenantId, status: { in: ["PENDING", "RETRY"] } },
          data: { runAt: scheduledFor },
        });
      }
      const row = await tx.dataLifecycleRequest.update({
        where: { id: request.id, tenantId },
        data: { status: "SCHEDULED", scheduledFor },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: context.userId,
          eventType: "DATA_DELETION_SCHEDULED",
          targetType: "DataLifecycleRequest",
          targetId: request.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            scheduledFor: scheduledFor.toISOString(),
            hardDeleteDeadline: deadline.toISOString(),
          },
        },
        tx
      );
      return row;
    });
  }

  /**
   * What the workspace owes and when — the read §6.14's deadline index exists
   * for.
   */
  async slaReport(tenantId: string, now = new Date()) {
    const soon = new Date(now.getTime() + 7 * DAY_MS);
    const [overdue, dueSoon, blocked, completed] = await prisma.$transaction([
      prisma.dataLifecycleRequest.findMany({
        where: {
          tenantId,
          type: "DELETION",
          status: OPEN_STATUSES,
          hardDeleteDeadline: { lt: now },
        },
        orderBy: { hardDeleteDeadline: "asc" },
      }),
      prisma.dataLifecycleRequest.findMany({
        where: {
          tenantId,
          type: "DELETION",
          status: OPEN_STATUSES,
          hardDeleteDeadline: { gte: now, lte: soon },
        },
        orderBy: { hardDeleteDeadline: "asc" },
      }),
      prisma.dataLifecycleRequest.findMany({
        where: { tenantId, type: "DELETION", status: "BLOCKED" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.dataLifecycleRequest.count({
        where: { tenantId, type: "DELETION", status: "COMPLETED" },
      }),
    ]);

    return {
      slaDays: HARD_DELETE_SLA_DAYS,
      // Named rather than merged into one list: an overdue deletion is an
      // incident, a blocked one is a decision, and reporting them together
      // would hide the difference.
      overdue,
      dueSoon,
      blocked,
      completedCount: completed,
      generatedAt: now,
    };
  }

  /**
   * Flag deletions that have passed their deadline.
   *
   * Cross-tenant on purpose: an SLA breach is an operational event for the
   * platform, not a workspace's own business, and §6.14's deadline index is
   * not tenant-first for exactly this sweep.
   *
   * One event per request, so a sweep every few minutes does not turn a single
   * late deletion into a flood.
   */
  async sweepOverdue(now = new Date()) {
    // Deliberately unscoped: an SLA breach is a platform-level event, and
    // §6.14 makes the deadline index cross-tenant for exactly this sweep.
    return withCrossTenant(async () => {
      const overdue = await prisma.dataLifecycleRequest.findMany({
        where: {
          type: "DELETION",
          status: OPEN_STATUSES,
          hardDeleteDeadline: { lt: now },
        },
        select: { id: true, tenantId: true, requestedByUserId: true, hardDeleteDeadline: true },
        take: 100,
      });
      if (overdue.length === 0) return { breached: 0 };

      const alreadyFlagged = await prisma.auditEvent.findMany({
        where: {
          eventType: "DATA_DELETION_SLA_BREACHED",
          targetId: { in: overdue.map((request) => request.id) },
        },
        select: { targetId: true },
      });
      const flagged = new Set(alreadyFlagged.map((event) => event.targetId));

      let breached = 0;
      for (const request of overdue) {
        if (flagged.has(request.id)) continue;
        await auditService.record({
          tenantId: request.tenantId,
          // The actor is the requester, not the sweep: nobody performed this,
          // and inventing a system actor would misattribute it.
          actorUserId: request.requestedByUserId,
          eventType: "DATA_DELETION_SLA_BREACHED",
          targetType: "DataLifecycleRequest",
          targetId: request.id,
          metadata: {
            hardDeleteDeadline: request.hardDeleteDeadline?.toISOString() ?? null,
            slaDays: HARD_DELETE_SLA_DAYS,
            detectedAt: now.toISOString(),
          },
        });
        breached += 1;
      }
      return { breached };
    });
  }

  /**
   * Erase one person from one workspace — §6.14's USER target.
   *
   * Anonymization rather than deletion of the account row, which AC-012 offers
   * as an equal alternative ("hard-deleted or irreversibly anonymized") and
   * which is the right one here for two reasons.
   *
   * The first is evidence. The Audit specification says audit records may be
   * retained after customer data deletion "with minimization/anonymization
   * where required", and `audit_events.actor_user_id` points at the account.
   * Deleting the row would either orphan the trail or force an UPDATE that the
   * append-only trigger refuses outright.
   *
   * The second is that an account is not owned by one workspace. Somebody may
   * be a member of several, so this removes their membership and personal
   * mailbox here, and only anonymizes the account itself once no active
   * membership remains anywhere — otherwise one workspace's deletion request
   * would erase another workspace's colleague.
   */
  async anonymizeUser(tenantId: string, userId: string, context: ActorContext) {
    const membership = await prisma.tenantMembership.findFirst({
      where: { tenantId, userId },
      select: { id: true, user: { select: { id: true, email: true } } },
    });
    if (!membership) {
      throw new AppError("No membership for that user in this workspace", 404, ErrorCodes.NOT_FOUND);
    }

    const result = await prisma.$transaction(async (tx) => {
      // Cascades to the personal mailbox, its folder items, shared-mailbox
      // grants and connected accounts. Message recipient rows survive with
      // the membership link nulled, which is itself a minimisation: the
      // message stays, the person no longer resolves.
      await tx.tenantMembership.delete({ where: { id: membership.id } });

      const remaining = await tx.tenantMembership.count({
        where: { userId, status: "ACTIVE" },
      });

      let accountAnonymized = false;
      if (remaining === 0) {
        // A random placeholder rather than a hash of the address: a hash is a
        // pseudonym an attacker with a guess can confirm, and "irreversibly
        // anonymized" has to mean unlinkable.
        await tx.userIdentity.deleteMany({ where: { userId } });
        await tx.emailOtp.deleteMany({ where: { userId } });
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.appUser.update({
          where: { id: userId },
          data: {
            email: `deleted-${randomUUID()}@deleted.invalid`,
            displayName: "Deleted user",
            passwordHash: null,
            status: "DISABLED",
            activeTenantId: null,
            avatarUrl: null,
            emailVerifiedAt: null,
          },
        });
        accountAnonymized = true;
      }

      await auditService.record(
        {
          tenantId,
          actorUserId: context.userId,
          eventType: "DATA_USER_ANONYMIZED",
          targetType: "AppUser",
          targetId: userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            membershipRemoved: true,
            // Recorded because the two outcomes are materially different, and
            // a reader of the trail needs to know which one happened.
            accountAnonymized,
            remainingActiveMemberships: remaining,
          },
        },
        tx
      );

      return { accountAnonymized, remainingActiveMemberships: remaining };
    });

    return result;
  }
}

export const lifecycleService = new LifecycleService();
