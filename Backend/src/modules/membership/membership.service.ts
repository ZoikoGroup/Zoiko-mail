import type { MembershipRole, MembershipStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { env } from "../../config/env.js";
import { generateOpaqueToken, hashToken } from "../../common/utils/tokenHash.js";
import { hashPassword } from "../../common/utils/password.js";
import { systemMailer } from "../../common/mailer/system-mailer.js";
import { logger } from "../../config/logger.js";
import type { AcceptInvitationInput, AddMemberInput, CreateInvitationInput, UpdateMemberInput } from "./membership.schema.js";

interface ActorContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface InviteeContext {
  userId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const memberSelect = {
  id: true,
  tenantId: true,
  userId: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: { id: true, email: true, displayName: true, status: true },
  },
} satisfies Prisma.TenantMembershipSelect;

function assertAdminBoundary(actorRole: MembershipRole, role: MembershipRole): void {
  if (actorRole === "ADMIN" && role === "OWNER") {
    throw new AppError(
      "Administrators cannot manage owner memberships",
      403,
      ErrorCodes.FORBIDDEN
    );
  }
}

async function protectLastOwner(
  tx: Prisma.TransactionClient,
  tenantId: string,
  target: { role: MembershipRole; status: MembershipStatus },
  nextRole: MembershipRole,
  nextStatus: MembershipStatus
): Promise<void> {
  if (
    target.role !== "OWNER" ||
    target.status !== "ACTIVE" ||
    (nextRole === "OWNER" && nextStatus === "ACTIVE")
  ) return;

  const ownerCount = await tx.tenantMembership.count({
    where: { tenantId, role: "OWNER", status: "ACTIVE" },
  });
  if (ownerCount <= 1) {
    throw new AppError(
      "A tenant must retain at least one active owner",
      409,
      ErrorCodes.CONFLICT
    );
  }
}

export class MembershipService {
  async list(context: ActorContext) {
    return prisma.tenantMembership.findMany({
      where: { tenantId: context.tenantId, status: { not: "REMOVED" } },
      select: memberSelect,
      orderBy: { createdAt: "asc" },
    });
  }

  async add(input: AddMemberInput, context: ActorContext) {
    assertAdminBoundary(context.role, input.role);
    return prisma.$transaction(async (tx) => {
      const user = await tx.appUser.findUnique({ where: { email: input.email } });
      if (!user) throw new AppError("Registered user not found", 404, ErrorCodes.NOT_FOUND);
      if (user.status !== "ACTIVE") {
        throw new AppError("User account is disabled", 409, ErrorCodes.CONFLICT);
      }

      const existing = await tx.tenantMembership.findFirst({
        where: { tenantId: context.tenantId, userId: user.id },
      });
      if (existing) {
        throw new AppError("User already belongs to this tenant", 409, ErrorCodes.CONFLICT);
      }

      const membership = await tx.tenantMembership.create({
        data: {
          tenantId: context.tenantId,
          userId: user.id,
          role: input.role,
          status: "ACTIVE",
        },
        select: memberSelect,
      });
      await this.audit(tx, context, "MEMBERSHIP_CREATED", membership.id, {
        userId: user.id,
        role: input.role,
      });
      return membership;
    });
  }

  async createInvitation(input: CreateInvitationInput, context: ActorContext) {
    assertAdminBoundary(context.role, input.role);
    const invitationToken = generateOpaqueToken();
    const inviteToken = hashToken(invitationToken);
    const inviteExpiresAt = new Date(
      Date.now() + env.INVITATION_EXPIRES_IN_HOURS * 60 * 60 * 1000
    );

    const membership = await prisma.$transaction(async (tx) => {
      let user = await tx.appUser.findUnique({ where: { email: input.email } });
      if (!user) {
        // The invitee hasn't signed up yet. Create a placeholder identity
        // (random password, status INVITED) that /auth/register claims —
        // the real password is chosen when the invitee registers.
        user = await tx.appUser.create({
          data: {
            email: input.email,
            passwordHash: await hashPassword(generateOpaqueToken()),
            displayName: input.email.split("@")[0] ?? input.email,
            status: "INVITED",
          },
        });
      }
      if (user.status !== "ACTIVE" && user.status !== "INVITED") {
        throw new AppError("User account is disabled", 409, ErrorCodes.CONFLICT);
      }

      const existing = await tx.tenantMembership.findFirst({
        where: { tenantId: context.tenantId, userId: user.id },
      });
      if (existing && !["INVITED", "REMOVED"].includes(existing.status)) {
        throw new AppError("User already belongs to this tenant", 409, ErrorCodes.CONFLICT);
      }

      const result = existing
        ? await tx.tenantMembership.update({
            where: { id: existing.id },
            data: { role: input.role, status: "INVITED", inviteToken, inviteExpiresAt },
            select: memberSelect,
          })
        : await tx.tenantMembership.create({
            data: {
              tenantId: context.tenantId,
              userId: user.id,
              role: input.role,
              status: "INVITED",
              inviteToken,
              inviteExpiresAt,
            },
            select: memberSelect,
          });

      await this.audit(tx, context, "MEMBERSHIP_INVITED", result.id, {
        userId: user.id,
        role: input.role,
        expiresAt: inviteExpiresAt.toISOString(),
      });
      return result;
    });

    // Send invitation email (fire-and-forget — don't block the response)
    const tenant = await prisma.tenant.findUnique({ where: { id: context.tenantId }, select: { name: true } });
    const actor = await prisma.appUser.findUnique({ where: { id: context.userId }, select: { displayName: true, email: true } });
    const acceptUrl = `${env.APP_URL}/accept-invitation?token=${invitationToken}`;
    systemMailer.sendInvitationEmail(
      input.email,
      actor?.displayName ?? actor?.email ?? "A team member",
      tenant?.name ?? "the workspace",
      acceptUrl,
    ).catch((err) => logger.error({ err }, "Failed to send invitation email"));

    return { membership, invitationToken, expiresAt: inviteExpiresAt };
  }

  async acceptInvitation(input: AcceptInvitationInput, context: InviteeContext) {
    return prisma.$transaction(async (tx) => {
      // Resolve the invitation — either by hashed token or by membershipId + userId ownership
      let invitation;
      if (input.invitationToken) {
        const tokenHash = hashToken(input.invitationToken);
        invitation = await tx.tenantMembership.findUnique({
          where: { inviteToken: tokenHash },
          include: { tenant: true },
        });
        if (!invitation) {
          throw new AppError("Invitation is invalid", 401, ErrorCodes.INVITATION_INVALID);
        }
        // Token-based accept: skip userId check — the token IS the proof of identity.
        // If user is authenticated, also verify ownership for extra safety.
        if (context.userId && invitation.userId !== context.userId) {
          throw new AppError("Invitation belongs to another user", 403, ErrorCodes.FORBIDDEN);
        }
        // Idempotent re-accept. Email links get triggered twice in practice —
        // React StrictMode double-mounts the accept page, mail scanners
        // prefetch URLs, users click again after a slow response. The invite
        // token is deliberately kept on the membership after activation so a
        // second presentment of the SAME token resolves instead of failing.
        if (invitation.status === "ACTIVE") {
          const current = await tx.tenantMembership.findUnique({
            where: { id: invitation.id },
            select: memberSelect,
          });
          return current!;
        }
        if (invitation.status !== "INVITED") {
          throw new AppError("Invitation is invalid", 401, ErrorCodes.INVITATION_INVALID);
        }
      } else {
        // membershipId path — used by the UI accept button
        invitation = await tx.tenantMembership.findFirst({
          where: { id: input.membershipId!, userId: context.userId, status: "INVITED" },
          include: { tenant: true },
        });
        if (!invitation) {
          throw new AppError("Invitation not found", 404, ErrorCodes.NOT_FOUND);
        }
      }

      if (!invitation.inviteExpiresAt || invitation.inviteExpiresAt <= new Date()) {
        await tx.tenantMembership.update({
          where: { id: invitation.id },
          data: { status: "REMOVED", inviteToken: null, inviteExpiresAt: null },
        });
        throw new AppError("Invitation has expired", 410, ErrorCodes.INVITATION_EXPIRED);
      }
      if (invitation.tenant.status !== "ACTIVE") {
        throw new AppError("Tenant is not active", 403, ErrorCodes.FORBIDDEN);
      }

      const membership = await tx.tenantMembership.update({
        where: { id: invitation.id },
        // inviteToken is intentionally preserved (not nulled) so presenting
        // the same email link again stays idempotent; it is cleared on
        // cancel, removal and re-invitation.
        data: { status: "ACTIVE", inviteExpiresAt: null },
        select: memberSelect,
      });
      await auditService.record(
        {
          tenantId: invitation.tenantId,
          actorUserId: context.userId || invitation.userId,
          eventType: "MEMBERSHIP_INVITATION_ACCEPTED",
          targetType: "TenantMembership",
          targetId: invitation.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx
      );
      return membership;
    });
  }

  async cancelInvitation(id: string, context: ActorContext): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const invitation = await tx.tenantMembership.findFirst({
        where: { id, tenantId: context.tenantId, status: "INVITED" },
      });
      if (!invitation) {
        throw new AppError("Pending invitation not found", 404, ErrorCodes.NOT_FOUND);
      }
      assertAdminBoundary(context.role, invitation.role);
      await tx.tenantMembership.update({
        where: { id: invitation.id },
        data: { status: "REMOVED", inviteToken: null, inviteExpiresAt: null },
      });
      await this.audit(tx, context, "MEMBERSHIP_INVITATION_CANCELLED", invitation.id, {
        userId: invitation.userId,
        role: invitation.role,
      });
    });
  }

  async update(id: string, input: UpdateMemberInput, context: ActorContext) {
    return prisma.$transaction(async (tx) => {
      const target = await tx.tenantMembership.findFirst({
        where: { id, tenantId: context.tenantId, status: { not: "REMOVED" } },
      });
      if (!target) throw new AppError("Membership not found", 404, ErrorCodes.NOT_FOUND);

      assertAdminBoundary(context.role, target.role);
      if (input.role) assertAdminBoundary(context.role, input.role);
      const nextRole = input.role ?? target.role;
      const nextStatus = input.status ?? target.status;
      await protectLastOwner(tx, context.tenantId, target, nextRole, nextStatus);

      const membership = await tx.tenantMembership.update({
        where: { id: target.id },
        data: { role: input.role, status: input.status },
        select: memberSelect,
      });
      if (input.status === "SUSPENDED") {
        await tx.refreshToken.updateMany({
          where: { tenantId: context.tenantId, userId: target.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit(tx, context, "MEMBERSHIP_UPDATED", target.id, {
        previousRole: target.role,
        previousStatus: target.status,
        role: membership.role,
        status: membership.status,
      });
      return membership;
    });
  }

  async remove(id: string, context: ActorContext): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const target = await tx.tenantMembership.findFirst({
        where: { id, tenantId: context.tenantId, status: { not: "REMOVED" } },
      });
      if (!target) throw new AppError("Membership not found", 404, ErrorCodes.NOT_FOUND);

      assertAdminBoundary(context.role, target.role);
      await protectLastOwner(tx, context.tenantId, target, "MEMBER", "REMOVED");
      await tx.refreshToken.deleteMany({
        where: { tenantId: context.tenantId, userId: target.userId },
      });
      await tx.tenantMembership.update({
        where: { id: target.id },
        data: { status: "REMOVED", inviteToken: null, inviteExpiresAt: null },
      });
      await this.audit(tx, context, "MEMBERSHIP_REMOVED", target.id, {
        userId: target.userId,
        role: target.role,
      });
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    eventType: string,
    targetId: string,
    metadata: Prisma.InputJsonValue
  ): Promise<void> {
    await auditService.record(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType,
        targetType: "TenantMembership",
        targetId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata,
      },
      tx
    );
  }
}

export const membershipService = new MembershipService();
