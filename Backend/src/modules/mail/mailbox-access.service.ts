import { randomUUID } from "node:crypto";
import type { MembershipRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { matrixKind } from "../../common/capabilities/matrix.js";
import { can } from "../../common/capabilities/resolver.js";
import { WORKSPACE_SCOPES } from "../../common/utils/workspaceScope.js";
import { systemMailer } from "../../common/mailer/system-mailer.js";
import { auditService } from "../audit/audit.service.js";
import { otpService } from "../auth/otp.service.js";
import { securityAlertService } from "../security-alert/security-alert.service.js";
import { assertCanManageRole } from "../membership/membership.service.js";
import { stalwartClient } from "../stalwart/stalwart.client.js";
import { StalwartError, type MailHostingProvider } from "../stalwart/stalwart.types.js";

/**
 * Who a mailbox opens for, and how its owner gets back in.
 *
 * Two admin controls on the Mailboxes screen that both turn on the same fact:
 * a personal mailbox belongs to a person, and that person's role decides which
 * consoles they can open and who may manage them.
 */

export interface MailboxActor {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  /** The console the actor's own session was opened for. */
  workspace?: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The workspaces a mailbox may be assigned to: all four, for every mailbox.
 *
 * The assignment is a property of the mailbox — which workspace consoles it
 * can be opened in — not of the people who use it. Who may read it is still
 * decided by ownership and mailbox access, so assigning a member's mailbox to
 * the Admin workspace never lets an admin read that member's mail.
 *
 * For a personal mailbox it is also the explicit authorisation for its owner
 * to sign into the Admin, Owner or Support console (consoleAuthorized): the
 * role must reach the console and the mailbox must list it. The Member
 * workspace needs no authorisation, and an Owner always reaches Owner.
 */
export function assignableWorkspaces(): MembershipRole[] {
  return [...WORKSPACE_SCOPES];
}

/**
 * The assignment to store for a mailbox being created or edited: the request
 * when given, otherwise the Member workspace alone. Refuses an empty list (a
 * mailbox that opens nowhere is unreachable mail); duplicates are collapsed.
 */
export function resolveWorkspaces(requested: readonly MembershipRole[] | undefined): MembershipRole[] {
  const chosen = requested ?? ["MEMBER"];
  if (chosen.length === 0) {
    throw new AppError("Choose at least one workspace", 422, ErrorCodes.VALIDATION_ERROR, { parameter: "workspaces" });
  }
  // Stored in the UI's order so the same choice always reads the same way.
  return WORKSPACE_SCOPES.filter((scope) => chosen.includes(scope));
}

/**
 * The Member sign-in link for a mailbox. Composed from the stored key rather
 * than stored whole, so a change of APP_URL (a new domain, staging) moves
 * every link with it instead of leaving stale URLs in the database.
 */
export function memberLoginUrl(memberLoginKey: string): string {
  return `${env.APP_URL.replace(/\/+$/, "")}/login/member/${memberLoginKey}`;
}

export type CredentialMode = "SET_PASSWORD" | "RESET_EMAIL" | "UNAVAILABLE";
export type CredentialReason =
  | "SHARED_MAILBOX"
  | "SELF"
  | "ROLE_NOT_MANAGEABLE"
  | "INVITATION_PENDING"
  | "MEMBERSHIP_INACTIVE"
  | "ACCOUNT_DISABLED"
  | "SHARED_ACCOUNT"
  | "NOT_PERMITTED"
  | "MAIL_SERVER_PENDING"
  | "MAIL_SERVER_UNAVAILABLE";

const REASON_TEXT: Record<CredentialReason, string> = {
  SHARED_MAILBOX: "Shared mailboxes have no password of their own. Their assignees sign in with their own accounts.",
  SELF: "This is your own mailbox. Change your password from your account settings.",
  ROLE_NOT_MANAGEABLE: "Your role cannot manage this mailbox's owner.",
  INVITATION_PENDING: "The owner has not accepted their invitation yet. They choose their own password when they accept it.",
  MEMBERSHIP_INACTIVE: "The owner's membership in this workspace is not active.",
  ACCOUNT_DISABLED: "The owner's account is disabled.",
  SHARED_ACCOUNT:
    "The owner also belongs to another workspace, and the same password signs them in there. Setting it from here would change their access elsewhere, so send them a reset code instead.",
  NOT_PERMITTED: "Setting a password needs the credential reset permission. You can still send the owner a reset code.",
  MAIL_SERVER_PENDING:
    "This mailbox is still being set up on the mail server. Try again once its status shows Active, so the new password reaches the mail server too.",
  MAIL_SERVER_UNAVAILABLE:
    "This mailbox lives on the mail server, which is not connected right now. Its password cannot be changed until it is, or the two would disagree.",
};

/**
 * Where the mailbox's sign-in is checked besides Zoiko.
 *
 * HOSTED: an account on the mail server (IMAP, SMTP submission), whose
 * password is replaced together with the Zoiko one. ZOIKO: the mailbox lives
 * in Zoiko's own store, so the Zoiko password is the only one.
 */
export type MailServerSync = "HOSTED" | "ZOIKO";

export class MailboxAccessService {
  constructor(private provider: MailHostingProvider = stalwartClient) {}

  /** Test seam. */
  setProvider(provider: MailHostingProvider): void {
    this.provider = provider;
  }

  /** The mailbox and the person behind it, scoped to this workspace. */
  private async target(tenantId: string, mailboxId: string) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      select: {
        id: true,
        address: true,
        workspaces: true,
        provisioningStatus: true,
        providerAccountId: true,
        membership: {
          select: {
            id: true,
            role: true,
            status: true,
            userId: true,
            user: { select: { id: true, email: true, displayName: true, status: true, passwordHash: true } },
          },
        },
      },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);
    return mailbox;
  }

  /**
   * Memberships this person holds outside the current workspace.
   *
   * Read across tenants on purpose: the question is exactly whether the
   * password reaches beyond here. Only a count leaves this function, so
   * nothing about the other workspaces is disclosed to the caller.
   */
  private otherMemberships(userId: string, tenantId: string): Promise<number> {
    return withCrossTenant(() =>
      prisma.tenantMembership.count({
        where: { userId, tenantId: { not: tenantId }, status: { not: "REMOVED" } },
      })
    );
  }

  /** What the credentials dialog may offer for this mailbox, and why. */
  async credentialStatus(mailboxId: string, actor: MailboxActor) {
    const mailbox = await this.target(actor.tenantId, mailboxId);
    const membership = mailbox.membership;
    const owner = membership
      ? {
          email: membership.user.email,
          displayName: membership.user.displayName,
          role: membership.role,
          hasPassword: Boolean(membership.user.passwordHash),
        }
      : null;

    const mailServer: MailServerSync = mailbox.provisioningStatus === "PROVISIONED" && mailbox.providerAccountId ? "HOSTED" : "ZOIKO";
    const unavailable = (reason: CredentialReason) => ({
      mailboxId: mailbox.id,
      address: mailbox.address,
      mode: "UNAVAILABLE" as CredentialMode,
      reason,
      message: REASON_TEXT[reason],
      owner,
      mailServer,
    });

    if (!membership) return unavailable("SHARED_MAILBOX");
    if (membership.userId === actor.userId) return unavailable("SELF");
    if (!can(MANAGE_FOR[membership.role], { role: actor.role, membershipActive: true })) {
      return unavailable("ROLE_NOT_MANAGEABLE");
    }
    if (membership.status === "INVITED") return unavailable("INVITATION_PENDING");
    if (membership.status !== "ACTIVE") return unavailable("MEMBERSHIP_INACTIVE");
    if (membership.user.status !== "ACTIVE") return unavailable("ACCOUNT_DISABLED");
    // Mid-provisioning, the mail-server account either does not exist yet or
    // is about to be created with its own credential; a password set now
    // would not reach it.
    if (mailbox.provisioningStatus === "PENDING" || mailbox.provisioningStatus === "PROVISIONING") {
      return unavailable("MAIL_SERVER_PENDING");
    }

    const resetEmail = (reason: CredentialReason) => ({
      mailboxId: mailbox.id,
      address: mailbox.address,
      mode: "RESET_EMAIL" as CredentialMode,
      reason,
      message: REASON_TEXT[reason],
      owner,
      mailServer,
    });
    if ((await this.otherMemberships(membership.userId, actor.tenantId)) > 0) return resetEmail("SHARED_ACCOUNT");
    if (!matrixKind(actor.role, "people.credentials.reset")) return resetEmail("NOT_PERMITTED");
    if (mailServer === "HOSTED" && !this.provider.isConfigured()) return unavailable("MAIL_SERVER_UNAVAILABLE");

    return {
      mailboxId: mailbox.id,
      address: mailbox.address,
      mode: "SET_PASSWORD" as CredentialMode,
      reason: null,
      message: null,
      owner,
      mailServer,
    };
  }

  /**
   * Set a new sign-in password for the mailbox's owner.
   *
   * Every refusal the status endpoint describes is re-checked here, because a
   * dialog can sit open while the owner joins another workspace or is
   * suspended. On success the owner is signed out everywhere: their refresh
   * tokens are revoked and the live-session claim is released, so even an
   * access token already in a browser tab stops working on its next request.
   */
  async resetPassword(mailboxId: string, newPassword: string, actor: MailboxActor) {
    const status = await this.credentialStatus(mailboxId, actor);
    if (status.mode !== "SET_PASSWORD") {
      const code = status.reason === "ROLE_NOT_MANAGEABLE" || status.reason === "NOT_PERMITTED" ? 403 : 409;
      throw new AppError(status.message ?? "This mailbox's password cannot be set here", code, code === 403 ? ErrorCodes.FORBIDDEN : ErrorCodes.CONFLICT, {
        reason: status.reason,
      });
    }

    const mailbox = await this.target(actor.tenantId, mailboxId);
    const membership = mailbox.membership!;
    // The role ceiling, stated through the same helper member management
    // uses, so an Admin can never set an Owner's password from this screen.
    assertCanManageRole(actor.role, membership.role);

    if (membership.user.passwordHash && (await verifyPassword(newPassword, membership.user.passwordHash))) {
      throw new AppError("Choose a password different from the current one", 409, ErrorCodes.CONFLICT, {
        reason: "SAME_PASSWORD",
      });
    }

    // The mail server first. If it refuses, nothing in Zoiko has changed, so
    // the owner's Zoiko and IMAP/SMTP passwords never disagree. The reverse
    // order could leave Zoiko on the new password and the mail server on the
    // old one with no way to tell.
    if (status.mailServer === "HOSTED") {
      try {
        await this.provider.setAccountPassword(mailbox.providerAccountId!, newPassword);
      } catch (error) {
        const code = error instanceof StalwartError ? error.code : "UNKNOWN";
        logger.warn({ mailboxId, provider: this.provider.name, code }, "Mail server refused the password change");
        throw new AppError(
          "The mail server did not accept the new password, so nothing was changed. Try again in a moment.",
          502,
          ErrorCodes.MAIL_SERVER_SYNC_FAILED,
          { reason: `STALWART_${code}`, retryable: error instanceof StalwartError ? error.retryable : true }
        );
      }
    }

    const passwordHash = await hashPassword(newPassword);
    let sessionsRevoked = 0;
    await prisma.$transaction(async (tx) => {
      // activeTenantId: null is what ends sessions immediately — the
      // tenant-context middleware refuses any access token whose account no
      // longer claims this workspace.
      await tx.appUser.update({
        where: { id: membership.userId },
        data: { passwordHash, activeTenantId: null },
      });
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      sessionsRevoked = revoked.count;
      await auditService.record(
        {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          eventType: "MAILBOX_CREDENTIALS_RESET",
          targetType: "Mailbox",
          targetId: mailbox.id,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          // Never the password, its hash, or its length.
          metadata: {
            address: mailbox.address,
            ownerUserId: membership.userId,
            ownerEmail: membership.user.email,
            ownerRole: membership.role,
            sessionsRevoked,
            mailServer: status.mailServer,
          },
        },
        tx
      );
    });

    await securityAlertService
      .recordPasswordResetByAdmin(actor.tenantId, membership.userId, membership.user.email, actor.userId, {
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId,
      })
      .catch((error: unknown) => logger.warn({ err: error, mailboxId }, "Could not record the password-reset security alert"));

    // Tell the owner. A failure here must not undo a reset that already
    // happened, so it is logged rather than thrown.
    await systemMailer
      .send({
        to: membership.user.email,
        subject: "Your Zoiko Mail password was changed",
        text: [
          `Hello${membership.user.displayName ? ` ${membership.user.displayName}` : ""},`,
          "",
          `An administrator of your Zoiko Mail workspace set a new password for your account (mailbox ${mailbox.address}).`,
          "You have been signed out everywhere. Ask your administrator for the new password, then change it from your account settings after you sign in.",
          "",
          "If you did not expect this, contact your administrator straight away.",
        ].join("\n"),
      })
      .catch((error: unknown) => logger.warn({ err: error, mailboxId }, "Could not send the password-changed notice"));

    return {
      mailboxId: mailbox.id,
      address: mailbox.address,
      ownerEmail: membership.user.email,
      sessionsRevoked,
      mailServer: status.mailServer,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Email the owner a one-time password-reset code.
   *
   * The safe option in every case where setting a password is not: the owner
   * chooses the new password themselves, and nobody else learns it. Uses the
   * same code, cooldown and hourly cap as "Forgot password".
   */
  async sendResetEmail(mailboxId: string, actor: MailboxActor) {
    const status = await this.credentialStatus(mailboxId, actor);
    if (status.mode === "UNAVAILABLE") {
      const code = status.reason === "ROLE_NOT_MANAGEABLE" ? 403 : 409;
      throw new AppError(status.message ?? "A reset code cannot be sent for this mailbox", code, code === 403 ? ErrorCodes.FORBIDDEN : ErrorCodes.CONFLICT, {
        reason: status.reason,
      });
    }
    const mailbox = await this.target(actor.tenantId, mailboxId);
    const membership = mailbox.membership!;
    assertCanManageRole(actor.role, membership.role);

    try {
      await otpService.issuePasswordReset(membership.userId, membership.user.email);
    } catch (error) {
      if (error instanceof AppError && (error.code === ErrorCodes.OTP_COOLDOWN || error.code === ErrorCodes.OTP_RESEND_LIMIT)) {
        throw new AppError(
          "A reset code was sent to this person very recently. Wait a few minutes before sending another.",
          429,
          ErrorCodes.RATE_LIMIT_EXCEEDED,
          { reason: error.code }
        );
      }
      throw error;
    }

    await auditService.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      eventType: "MAILBOX_CREDENTIAL_RESET_EMAIL_SENT",
      targetType: "Mailbox",
      targetId: mailbox.id,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: { address: mailbox.address, ownerUserId: membership.userId, ownerEmail: membership.user.email },
    });
    return { mailboxId: mailbox.id, sentTo: membership.user.email };
  }

  /** Replace the workspaces a mailbox can be opened in. */
  async updateWorkspaces(mailboxId: string, requested: MembershipRole[], actor: MailboxActor) {
    const mailbox = await this.target(actor.tenantId, mailboxId);
    const workspaces = resolveWorkspaces(requested);
    const before = mailbox.workspaces;
    const unchanged = before.length === workspaces.length && workspaces.every((scope) => before.includes(scope));
    // The assignment also decides which consoles the owner may sign into, so
    // an admin unticking their own current console would end their session on
    // the next request. Refused, so nobody locks themselves out by accident;
    // another admin can still change it.
    if (
      mailbox.membership?.userId === actor.userId &&
      actor.workspace &&
      actor.workspace !== "MEMBER" &&
      before.includes(actor.workspace) &&
      !workspaces.includes(actor.workspace)
    ) {
      throw new AppError(
        "You can't remove the workspace you're signed in to from your own mailbox. Ask another administrator to change it.",
        409,
        ErrorCodes.CONFLICT,
        { reason: "OWN_CURRENT_WORKSPACE", workspace: actor.workspace }
      );
    }
    if (!unchanged) {
      await prisma.$transaction(async (tx) => {
        await tx.mailbox.update({ where: { id: mailbox.id }, data: { workspaces } });
        await auditService.record(
          {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            eventType: "MAILBOX_WORKSPACES_UPDATED",
            targetType: "Mailbox",
            targetId: mailbox.id,
            requestId: actor.requestId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
            metadata: { address: mailbox.address, before, after: workspaces },
          },
          tx
        );
      });
    }
    return {
      mailboxId: mailbox.id,
      workspaces,
      assignableWorkspaces: assignableWorkspaces(),
      changed: !unchanged,
    };
  }

  /**
   * Replace a mailbox's Member sign-in link. The old link stops resolving at
   * once; anyone holding it is told to ask for the current one. Sessions are
   * untouched — the link was never a credential.
   */
  async regenerateMemberLoginLink(mailboxId: string, actor: MailboxActor) {
    const mailbox = await this.target(actor.tenantId, mailboxId);
    const memberLoginKey = randomUUID().replace(/-/g, "");
    await prisma.$transaction(async (tx) => {
      await tx.mailbox.update({ where: { id: mailbox.id }, data: { memberLoginKey } });
      await auditService.record(
        {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          eventType: "MAILBOX_MEMBER_LOGIN_LINK_REGENERATED",
          targetType: "Mailbox",
          targetId: mailbox.id,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
          // The address only; the link itself is not worth recording.
          metadata: { address: mailbox.address },
        },
        tx
      );
    });
    return { mailboxId: mailbox.id, memberLoginKey, memberLoginUrl: memberLoginUrl(memberLoginKey) };
  }
}

/** The capability it takes to act on a person of each role (see membership.service). */
const MANAGE_FOR: Record<MembershipRole, string> = {
  OWNER: "people.owner.manage",
  ADMIN: "people.admin.manage",
  MEMBER: "people.member.manage",
  SUPPORT: "people.member.manage",
};

export const mailboxAccessService = new MailboxAccessService();
