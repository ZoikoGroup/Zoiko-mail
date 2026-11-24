import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import {
  RevokedReason,
  isWellFormedSessionKey,
  listSessions,
  revokeAllSessions,
  revokeSession,
} from "../../common/auth/sessions.js";
import { sseManager } from "../../common/sse/sse.manager.js";
import { auditService } from "../audit/audit.service.js";
import { assertCanManageRole } from "../membership/membership.service.js";

/**
 * Account security — P1 (ZM-05), S2 §09 "Account activity: sessions … revoke
 * sessions and investigate", authorised for the mailbox owner and for admins.
 *
 * Two audiences. A person sees and ends their own sessions, which is the
 * "Active sessions" row of their profile. An Owner or Admin sees and ends
 * another member's — containment when an account looks taken over — held to
 * the same ceiling as managing that member at all, so an Admin cannot sign an
 * Owner out.
 */

export interface AccountActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  sessionId: string | null;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const notFound = () => new AppError("Session not found", 404, ErrorCodes.NOT_FOUND);

export class AccountSecurityService {
  async listOwnSessions(actor: AccountActor) {
    return { sessions: await listSessions(actor.userId, actor.tenantId, actor.sessionId) };
  }

  /**
   * Sign one of your own devices out. Ending the current one is allowed — it
   * is a sign-out — and the response says so, so the client can leave.
   * Ending a session that has already ended answers as success with nothing
   * revoked; one that was never yours answers 404, identically to one that
   * does not exist.
   */
  async revokeOwnSession(actor: AccountActor, key: string) {
    if (!isWellFormedSessionKey(key)) throw notFound();
    const result = await prisma.$transaction(async (tx) => {
      const { existed, revoked } = await revokeSession(
        { userId: actor.userId, tenantId: actor.tenantId, key, reason: RevokedReason.SESSION_REVOKED },
        tx
      );
      if (!existed) throw notFound();
      const current = key === actor.sessionId;
      if (revoked > 0) {
        await auditService.record({
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          eventType: "SESSION_REVOKED",
          targetType: "Session",
          targetId: null,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
          metadata: { sessionKey: key, current, rowsRevoked: revoked },
        }, tx);
      }
      return { key, revoked: revoked > 0, current };
    });
    // After commit: the stream reconnects and must find the session ended.
    if (result.revoked) sseManager.endSessions({ userId: actor.userId, tenantId: actor.tenantId, sessionId: key });
    return result;
  }

  async listMemberSessions(actor: AccountActor, membershipId: string) {
    const target = await this.manageableMember(actor, membershipId);
    return {
      membershipId: target.id,
      sessions: await listSessions(target.userId, actor.tenantId, null),
    };
  }

  /** Containment: end every session one member holds in this workspace. */
  async revokeMemberSessions(actor: AccountActor, membershipId: string, note?: string) {
    const target = await this.manageableMember(actor, membershipId);
    const result = await prisma.$transaction(async (tx) => {
      const revoked = await revokeAllSessions(
        { userId: target.userId, tenantId: actor.tenantId, reason: RevokedReason.ADMIN_REVOKED },
        tx
      );
      await auditService.record({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        eventType: "MEMBER_SESSIONS_REVOKED",
        targetType: "TenantMembership",
        targetId: target.id,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        metadata: { userId: target.userId, email: target.email, role: target.role, sessionsRevoked: revoked, note: note ?? null },
      }, tx);
      return { membershipId: target.id, sessionsRevoked: revoked };
    });
    sseManager.endSessions({ userId: target.userId, tenantId: actor.tenantId });
    return result;
  }

  /**
   * A member of this workspace the actor may manage. Another workspace's
   * membership is a 404, not a 403: whether it exists is not this caller's
   * to learn. Acting on yourself needs no ceiling check.
   */
  private async manageableMember(actor: AccountActor, membershipId: string) {
    const target = await prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId: actor.tenantId },
      select: { id: true, userId: true, role: true, user: { select: { email: true } } },
    });
    if (!target) throw new AppError("Membership not found", 404, ErrorCodes.NOT_FOUND);
    if (target.userId !== actor.userId) assertCanManageRole(actor.role, target.role);
    return { id: target.id, userId: target.userId, role: target.role, email: target.user.email };
  }
}

export const accountSecurityService = new AccountSecurityService();
