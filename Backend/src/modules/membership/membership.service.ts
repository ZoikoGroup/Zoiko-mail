import type { MembershipRole, MembershipStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { billingService } from "../billing/billing.service.js";
import { can } from "../../common/capabilities/resolver.js";
import { cursorArgs, toPage } from "../../common/utils/pagination.js";
import { env } from "../../config/env.js";
import { generateOpaqueToken, hashToken } from "../../common/utils/tokenHash.js";
import { hashPassword } from "../../common/utils/password.js";
import { systemMailer } from "../../common/mailer/system-mailer.js";
import {
  draftInvitationLetter,
  fullName,
  type InvitationLetter,
} from "./invitation-letter.js";
import { logger } from "../../config/logger.js";
import type { AcceptInvitationInput, AddMemberInput, CreateInvitationInput, PreviewInvitationInput, UpdateMemberInput } from "./membership.schema.js";

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
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      // Whether this person holds a second factor — AC-002. The people screen
      // has always had a column for it and has always shown "none", because
      // there was nothing to read. There is now, and for an Owner or Admin it
      // is the difference between a compliant account and an exposed one.
      //
      // The date rather than a boolean: a reader who wants to know *when*
      // should not need a second request, and a client that only wants the
      // fact can test it for null.
      mfaEnrolledAt: true,
    },
  },
} satisfies Prisma.TenantMembershipSelect;

/**
 * Which capability it takes to act on a membership of a given role.
 *
 * The matrix already carries this: `people.owner.manage` sits in the Owner
 * row and nowhere else, `people.admin.manage` and `people.member.manage` sit
 * in both. Reading it here is what makes the admin/owner boundary a fact about
 * the matrix rather than a second opinion kept beside it.
 *
 * This used to be `actorRole === "ADMIN" && role === "OWNER"` — correct, and
 * tested, but hardcoded: the four capabilities written to express exactly this
 * were never read by anything, so the matrix described enforcement it did not
 * perform, and a fifth role would have needed this line found and edited.
 */
const MANAGE_CAPABILITY: Record<MembershipRole, string> = {
  OWNER: "people.owner.manage",
  ADMIN: "people.admin.manage",
  MEMBER: "people.member.manage",
  // A Support seat is a workspace membership like any other to the people who
  // administer it; it carries no elevated claim on being managed.
  SUPPORT: "people.member.manage",
};

/** Which capability it takes to bring somebody in at a given role. */
const INVITE_CAPABILITY: Record<MembershipRole, string> = {
  OWNER: "people.invite.owner",
  ADMIN: "people.invite.admin",
  MEMBER: "people.invite.member",
  SUPPORT: "people.invite.member",
};

function refuse(actorRole: MembershipRole, role: MembershipRole, capability: string): never {
  throw new AppError(
    `A ${actorRole.toLowerCase()} cannot act on ${role.toLowerCase()} memberships`,
    403,
    ErrorCodes.FORBIDDEN,
    { required: capability, targetRole: role }
  );
}

/** Acting on somebody who is already here. */
function assertCanManageRole(actorRole: MembershipRole, role: MembershipRole): void {
  const capability = MANAGE_CAPABILITY[role];
  if (!can(capability, { role: actorRole, membershipActive: true })) {
    refuse(actorRole, role, capability);
  }
}

/** Bringing somebody in, or moving them to a new role. */
function assertCanInviteRole(actorRole: MembershipRole, role: MembershipRole): void {
  const capability = INVITE_CAPABILITY[role];
  if (!can(capability, { role: actorRole, membershipActive: true })) {
    refuse(actorRole, role, capability);
  }
}

/**
 * A SUPPORT membership is workspace-scoped and read-only, so it must be the
 * user's single Support seat. Allowing a user to hold SUPPORT in more than one
 * tenant would silently widen the set of workspaces their Support seating can
 * reach without any additional vetting. Reject such grants up front.
 *
 * `excludeTenantId` lets the caller skip a membership already being re-issued
 * for the SAME workspace (re-invite, role update) without tripping on it.
 */
async function assertSupportNotElsewhere(
  tenantId: string,
  userId: string,
  excludeTenantId?: string
): Promise<void> {
  const elsewhere = await prisma.tenantMembership.findFirst({
    where: {
      userId,
      role: "SUPPORT",
      status: "ACTIVE",
      ...(excludeTenantId ? { tenantId: { not: excludeTenantId } } : {}),
    },
    select: { tenantId: true },
  });
  if (elsewhere) {
    throw new AppError(
      "This user already holds a Support membership in another workspace",
      409,
      ErrorCodes.CONFLICT
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
  /**
   * The workspace's people, a page at a time — API §4.
   *
   * `id` joins the sort key because `createdAt` alone is not unique: two
   * members added in the same transaction share a timestamp, and a cursor
   * over a non-unique order can drop one of them or serve it twice.
   */
  async list(context: ActorContext, options: { limit?: number; cursor?: string } = {}) {
    const limit = options.limit ?? 50;
    const rows = await prisma.tenantMembership.findMany({
      where: { tenantId: context.tenantId, status: { not: "REMOVED" } },
      select: memberSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...cursorArgs(limit, options.cursor),
    });
    return toPage(rows, limit);
  }

  async add(input: AddMemberInput, context: ActorContext) {
    assertCanInviteRole(context.role, input.role);
    // Enforce the tenant-level user limit before activating a new member.
    await billingService.assertUserWithinLimit(context.tenantId, 1);
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
      if (input.role === "SUPPORT") {
        await assertSupportNotElsewhere(context.tenantId, user.id);
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
    assertCanInviteRole(context.role, input.role);
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
            // The invitee's own name when the inviter gave one, rather than
            // the local part of their address. It is what every screen shows
            // them as until they register and set it themselves.
            displayName:
              fullName(input.firstName, input.lastName) ??
              input.email.split("@")[0] ??
              input.email,
            status: "INVITED",
          },
        });
      }
      if (user.status !== "ACTIVE" && user.status !== "INVITED") {
        throw new AppError("User account is disabled", 409, ErrorCodes.CONFLICT);
      }

      if (input.role === "SUPPORT") {
        await assertSupportNotElsewhere(context.tenantId, user.id);
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
    const letter = await this.buildLetter(input, context);
    const acceptUrl = `${env.APP_URL}/accept-invitation?token=${invitationToken}`;
    systemMailer
      .sendInvitationEmail(input.email, letter, acceptUrl)
      .catch((err) => logger.error({ err }, "Failed to send invitation email"));

    return { membership, invitationToken, expiresAt: inviteExpiresAt };
  }

  /**
   * The letter this invitation will send.
   *
   * One place, used by both the preview and the send, so what the admin
   * reviews is what actually goes out. An edited body replaces the drafted
   * paragraphs and nothing else: the greeting, the accept button and the
   * expiry footer are facts about the invitation rather than prose, so they
   * are not the admin's to rewrite.
   */
  private async buildLetter(
    input: CreateInvitationInput | PreviewInvitationInput,
    context: ActorContext
  ): Promise<InvitationLetter> {
    const [tenant, actor] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: context.tenantId },
        select: { name: true },
      }),
      prisma.appUser.findUnique({
        where: { id: context.userId },
        select: { displayName: true, email: true },
      }),
    ]);

    const letter = draftInvitationLetter({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      role: input.role,
      workspaceName: tenant?.name ?? "the workspace",
      inviterName: actor?.displayName ?? actor?.email ?? "A team member",
      expiresInHours: env.INVITATION_EXPIRES_IN_HOURS,
    });

    const edited = "letterBody" in input ? input.letterBody : undefined;
    return edited && edited.length > 0
      ? { ...letter, paragraphs: edited }
      : letter;
  }

  /**
   * Draft the letter without inviting anyone.
   *
   * Deliberately has no side effects — no membership, no account, no email —
   * so an admin can read what would be sent, and change it, before a stranger
   * receives anything. The role ceiling is still checked here: previewing an
   * invitation the caller could not send would be a way to probe the
   * boundary.
   */
  async previewInvitation(
    input: PreviewInvitationInput,
    context: ActorContext
  ): Promise<InvitationLetter> {
    assertCanInviteRole(context.role, input.role);
    return this.buildLetter(input, context);
  }

  /**
   * What an invitation link is for, before anyone has signed in.
   *
   * The accept page needs to know whether this person has an account yet,
   * and it cannot ask an authenticated endpoint: an invitee with no password
   * cannot sign in, so requiring a session to accept an invitation is a
   * closed loop with no way out. The token is the credential here, exactly as
   * it is for a password reset.
   *
   * Says as little as it can. Enough to address the person by the workspace
   * they were invited to, and nothing about who else is in it.
   */
  async lookupInvitation(invitationToken: string) {
    const invitation = await prisma.tenantMembership.findUnique({
      where: { inviteToken: hashToken(invitationToken) },
      include: { tenant: { select: { name: true, status: true } }, user: { select: { email: true, status: true } } },
    });

    if (!invitation || invitation.status !== "INVITED") {
      throw new AppError("Invitation is invalid", 401, ErrorCodes.INVITATION_INVALID);
    }
    if (!invitation.inviteExpiresAt || invitation.inviteExpiresAt <= new Date()) {
      throw new AppError("Invitation has expired", 410, ErrorCodes.INVITATION_EXPIRED);
    }
    if (invitation.tenant.status !== "ACTIVE") {
      throw new AppError("Tenant is not active", 403, ErrorCodes.FORBIDDEN);
    }

    return {
      email: invitation.user.email,
      tenantName: invitation.tenant.name,
      role: invitation.role,
      // INVITED means createInvitation made a placeholder account with a
      // random password nobody knows — that person has to choose one. An
      // account that already existed does not, and must not be offered the
      // chance: see claimInvitation.
      needsPassword: invitation.user.status === "INVITED",
    };
  }

  /**
   * Set the password on a placeholder account and activate the membership.
   *
   * Unauthenticated by necessity and safe by construction: the token was
   * delivered to the invited address, so presenting it proves control of that
   * mailbox — the same proof a password-reset link carries, and the same
   * proof `acceptInvitation` already relies on when it promotes the account
   * from INVITED to ACTIVE.
   *
   * The refusal below is the part that matters. If the invited address
   * already has a real account, this must not set a password on it. An admin
   * can invite any address they like, so allowing that would turn "invite" into
   * "take over an existing account" — the invitation would become a password
   * reset for a mailbox the admin does not control. Those people sign in
   * first, and accept from a session that is already theirs.
   */
  async claimInvitation(input: { invitationToken: string; password: string }, context: InviteeContext) {
    return prisma.$transaction(async (tx) => {
      const invitation = await tx.tenantMembership.findUnique({
        where: { inviteToken: hashToken(input.invitationToken) },
        include: { tenant: true, user: true },
      });

      if (!invitation || invitation.status !== "INVITED") {
        throw new AppError("Invitation is invalid", 401, ErrorCodes.INVITATION_INVALID);
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
      if (invitation.user.status !== "INVITED") {
        throw new AppError(
          "This email already has an account. Sign in, then accept the invitation.",
          409,
          ErrorCodes.CONFLICT,
          { reason: "ACCOUNT_ALREADY_EXISTS" }
        );
      }

      await billingService.assertUserWithinLimit(invitation.tenantId, 1);

      await tx.appUser.update({
        where: { id: invitation.userId },
        data: {
          passwordHash: await hashPassword(input.password),
          status: "ACTIVE",
          // The link arrived in that mailbox, which is the same evidence the
          // verification email would have produced. Asking for a code as well
          // would be asking them to prove it twice.
          emailVerifiedAt: invitation.user.emailVerifiedAt ?? new Date(),
        },
      });

      const membership = await tx.tenantMembership.update({
        where: { id: invitation.id },
        data: { status: "ACTIVE", inviteExpiresAt: null },
        select: memberSelect,
      });

      await auditService.record(
        {
          tenantId: invitation.tenantId,
          actorUserId: invitation.userId,
          eventType: "MEMBERSHIP_INVITATION_CLAIMED",
          targetType: "TenantMembership",
          targetId: invitation.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { email: invitation.user.email, role: invitation.role },
        },
        tx
      );

      return { email: invitation.user.email, membership };
    });
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

      // Enforce the tenant-level user limit before the invitee becomes active.
      await billingService.assertUserWithinLimit(invitation.tenantId, 1);

      // Promote the placeholder AppUser from INVITED → ACTIVE.
      // createInvitation creates the user with status INVITED when they
      // don't have an account yet; accepting the invitation proves they
      // control the email, so activate the account.
      const invitedUser = await tx.appUser.findUnique({ where: { id: invitation.userId } });
      if (invitedUser && invitedUser.status === "INVITED") {
        await tx.appUser.update({
          where: { id: invitation.userId },
          data: {
            status: "ACTIVE",
            emailVerifiedAt: invitedUser.emailVerifiedAt ?? new Date(),
          },
        });
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
      assertCanManageRole(context.role, invitation.role);
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

      assertCanManageRole(context.role, target.role);
      if (input.role) assertCanInviteRole(context.role, input.role);
      const nextRole = input.role ?? target.role;
      const nextStatus = input.status ?? target.status;
      // Promoting a user to SUPPORT in this workspace is only allowed if they
      // don't already seat SUPPORT in a DIFFERENT tenant. The current
      // membership (excludeTenantId) is skipped so an in-place re-issue or a
      // support→support no-op update is not treated as a violation.
      if (nextRole === "SUPPORT") {
        await assertSupportNotElsewhere(context.tenantId, target.userId, context.tenantId);
      }
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

  /**
   * Clear a member's authenticator so they can enrol a new one — RBAC §2
   * "people.mfa.reset", Owner only, step-up.
   *
   * This is the one MFA path an administrator holds, and it is deliberately
   * not `mfaService.disable`. Disable is self-service, requires a valid code
   * from the device being removed, and refuses outright for a role AC-002
   * covers — which is correct for someone who still has their authenticator
   * and wrong for someone who has lost it. Losing the device is the whole
   * reason this exists.
   *
   * What it does *not* do is turn MFA off. It removes the enrolled secret and
   * the recovery codes, so the account's next sign-in lands on
   * MFA_ENROLLMENT_REQUIRED and the member sets up a new authenticator before
   * reaching anything. Security §11 forbids support staff quietly bypassing
   * MFA; forcing re-enrolment is the opposite of a bypass — the factor is
   * never absent, it is re-established under the member's own control.
   *
   * Live sessions are revoked with it. Leaving them alone would mean the
   * window between "lost the device" and "enrolled a new one" is a window in
   * which whoever holds the old session keeps working without a factor, and
   * that window is exactly the one an attacker asking for a reset wants.
   */
  async resetMfa(
    id: string,
    context: ActorContext
  ): Promise<{ membershipId: string; userId: string; email: string }> {
    return prisma.$transaction(async (tx) => {
      const target = await tx.tenantMembership.findFirst({
        where: { id, tenantId: context.tenantId, status: { not: "REMOVED" } },
        include: { user: { select: { id: true, email: true, mfaEnrolledAt: true } } },
      });
      if (!target) throw new AppError("Membership not found", 404, ErrorCodes.NOT_FOUND);

      // The same ceiling every other member action observes: an Admin may
      // not act on an Owner. Reset is if anything the most attractive
      // action to abuse — it is the one that ends with somebody enrolling a
      // new factor of their choosing.
      assertCanManageRole(context.role, target.role);

      // Resetting your own is not an administrative act; it is the
      // self-service path, and that one asks for a code you can only supply
      // from the device you still have. Routing round it here would let a
      // stolen session re-enrol itself.
      if (target.userId === context.userId) {
        throw new AppError(
          "Use your own account settings to change your authenticator.",
          409,
          ErrorCodes.CONFLICT,
          { reason: "SELF_RESET_NOT_ADMINISTRATIVE" }
        );
      }

      if (!target.user.mfaEnrolledAt) {
        throw new AppError(
          "That member has no authenticator enrolled, so there is nothing to reset.",
          409,
          ErrorCodes.CONFLICT,
          { reason: "MFA_NOT_ENROLLED" }
        );
      }

      await tx.appUser.update({
        where: { id: target.userId },
        data: { mfaSecret: null, mfaEnrolledAt: null, mfaLastUsedStep: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: target.userId } });
      await tx.refreshToken.deleteMany({
        where: { tenantId: context.tenantId, userId: target.userId },
      });

      await this.audit(tx, context, "MFA_RESET_BY_ADMIN", target.id, {
        userId: target.userId,
        email: target.user.email,
        role: target.role,
        // Says plainly what the member now has to do, so the row reads as a
        // recovery rather than as a factor being removed.
        outcome: "RE_ENROLMENT_REQUIRED",
        sessionsRevoked: true,
      });

      return { membershipId: target.id, userId: target.userId, email: target.user.email };
    });
  }

  async remove(id: string, context: ActorContext): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const target = await tx.tenantMembership.findFirst({
        where: { id, tenantId: context.tenantId, status: { not: "REMOVED" } },
      });
      if (!target) throw new AppError("Membership not found", 404, ErrorCodes.NOT_FOUND);

      assertCanManageRole(context.role, target.role);
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
        // Every route into this service sits behind a people.* capability,
        // which only an Owner or Admin holds — so these are administration,
        // not a member acting on their own account (Audit §6.2).
        actorType: "ADMIN",
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
