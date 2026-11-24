import { Prisma } from "@prisma/client";
import type { MembershipRole, SecurityAlertStatus, SecurityAlertType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { RevokedReason, revokeAllSessions } from "../../common/auth/sessions.js";
import { sseManager } from "../../common/sse/sse.manager.js";
import { auditService } from "../audit/audit.service.js";
import { assertCanManageRole } from "../membership/membership.service.js";
import {
  ALERT_SEVERITY,
  ALERT_REVIEW_ACTIONS,
  REMEDIATION_ACTIONS,
  REMEDIATIONS_BY_TYPE,
} from "./security-alert.types.js";
import type {
  AlertContext,
  AlertRemediationInput,
  AlertReviewAction,
  AlertReviewInput,
  RemediationAction,
} from "./security-alert.types.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** Who is acting on an alert, with the role their session acts in. */
export interface AlertActor {
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Request details of the change that raised an alert. */
interface ChangeContext {
  actorUserId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const OPEN_STATES: SecurityAlertStatus[] = ["OPEN", "ACKNOWLEDGED"];

/** The alert fields a review surface needs, minus the event plumbing. */
const ALERT_SELECT = {
  id: true,
  tenantId: true,
  type: true,
  severity: true,
  status: true,
  title: true,
  message: true,
  actorUserId: true,
  actorEmail: true,
  ipAddress: true,
  userAgent: true,
  deviceLabel: true,
  metadata: true,
  resolutionNote: true,
  resolvedById: true,
  resolvedAt: true,
  createdAt: true,
  actor: { select: { id: true, email: true, displayName: true } },
  resolvedBy: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.SecurityAlertSelect;

/** Minutes during which a duplicate event is treated as the same incident. */
const DEDUPE_WINDOW_MINUTES = 30;
/** Consecutive failed sign-ins from one address before an alert fires. */
const FAILED_LOGIN_BURST_THRESHOLD = 5;
/** Minutes back from now that count towards a failure burst. */
const FAILED_LOGIN_WINDOW_MINUTES = 10;

export class SecurityAlertService {
  // ── Generation (called by the auth pipeline) ─────────────────────────────

  /**
   * A sign-in from a device this member has never used in this workspace
   * before. Only fires when the account has *some* prior session to compare
   * against — the first-ever sign-in is not an alert, it is onboarding.
   */
  async recordNewDeviceLogin(
    tenantId: string,
    userId: string,
    userAgent: string | null,
    context: Pick<AlertContext, "ipAddress" | "deviceLabel" | "requestId">
  ): Promise<void> {
    if (!userAgent) return;

    const prior = await prisma.refreshToken.findMany({
      where: { tenantId, userId, userAgent },
      select: { id: true },
      take: 1,
    });
    if (prior.length > 0) return; // known device; not news

    const knownDevices = await prisma.refreshToken.count({
      where: { tenantId, userId },
    });
    if (knownDevices === 0) return; // first sign-in ever

    await this.createAlert(tenantId, {
      type: "NEW_DEVICE_LOGIN",
      title: "Sign-in from a new device",
      message: `This account signed in from a device it has not used before in this workspace.`,
      userId,
      email: null,
      ipAddress: context.ipAddress ?? null,
      userAgent,
      deviceLabel: context.deviceLabel ?? null,
      requestId: context.requestId,
      metadata: { firstSeenOnKnownDevices: knownDevices },
    });
  }

  /**
   * Five or more failed sign-ins for the same account from one address inside
   * ten minutes. Deduplicated so a brute-force attempt yields one alert, not
   * one per keystroke.
   */
  async recordFailedLoginBurst(
    tenantId: string,
    userId: string,
    email: string,
    context: Pick<AlertContext, "ipAddress" | "userAgent" | "requestId">
  ): Promise<void> {
    if (await this.freshOpenAlertExists(tenantId, "FAILED_LOGIN_BURST", userId, context.ipAddress)) {
      return;
    }

    const since = new Date(Date.now() - FAILED_LOGIN_WINDOW_MINUTES * 60_000);
    const failures = await prisma.auditEvent.count({
      where: {
        tenantId,
        actorUserId: userId,
        eventType: "LOGIN_FAILED",
        createdAt: { gte: since },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      },
    });
    if (failures < FAILED_LOGIN_BURST_THRESHOLD) return;

    await this.createAlert(tenantId, {
      type: "FAILED_LOGIN_BURST",
      title: "Repeated failed sign-in attempts",
      message: `${failures} failed sign-in attempts for this account in the last ${FAILED_LOGIN_WINDOW_MINUTES} minutes. The password may be compromised or an attacker may be guessing it.`,
      userId,
      email,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceLabel: null,
      requestId: context.requestId,
      metadata: { failures, windowMinutes: FAILED_LOGIN_WINDOW_MINUTES },
    });
  }

  /** A revoked refresh token was presented — the classic theft signal. */
  async recordRefreshTokenReuse(
    tenantId: string,
    userId: string,
    email: string,
    context: Pick<AlertContext, "ipAddress" | "userAgent" | "deviceLabel" | "requestId">
  ): Promise<void> {
    if (await this.freshOpenAlertExists(tenantId, "REFRESH_TOKEN_REUSE", userId, context.ipAddress)) {
      return;
    }

    await this.createAlert(tenantId, {
      type: "REFRESH_TOKEN_REUSE",
      title: "Sign-in session suspected stolen",
      message:
        "A previously revoked sign-in token was presented for this account. Every other session for this workspace has been ended as a precaution — confirm this was you and sign in again.",
      userId,
      email,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceLabel: context.deviceLabel ?? null,
      requestId: context.requestId,
      metadata: { nextStep: "Sign in again from a trusted device and review active sessions" },
    });
  }

  /** The password was changed from a logged-in session. */
  async recordPasswordChanged(
    tenantId: string,
    userId: string,
    email: string,
    context: Pick<AlertContext, "ipAddress" | "userAgent" | "requestId">
  ): Promise<void> {
    await this.createAlert(tenantId, {
      type: "PASSWORD_CHANGED",
      title: "Password changed",
      message: "The password for this account was changed from a logged-in session.",
      userId,
      email,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceLabel: null,
      requestId: context.requestId,
      metadata: {},
    });
  }

  /** The password was reset through the forgot-password flow. */
  async recordPasswordReset(
    tenantId: string,
    userId: string,
    email: string,
    context: Pick<AlertContext, "ipAddress" | "userAgent" | "requestId">
  ): Promise<void> {
    await this.createAlert(tenantId, {
      type: "PASSWORD_RESET",
      title: "Password reset",
      message: "The password for this account was reset using the forgot-password flow.",
      userId,
      email,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceLabel: null,
      requestId: context.requestId,
      metadata: {},
    });
  }

  /**
   * An administrator set a new password for this account from the Mailboxes
   * screen. Its own message: the forgot-password wording would tell a
   * reviewer the owner did it themselves.
   */
  async recordPasswordResetByAdmin(
    tenantId: string,
    userId: string,
    email: string,
    actorUserId: string,
    context: Pick<AlertContext, "ipAddress" | "userAgent" | "requestId">
  ): Promise<void> {
    await this.createAlert(tenantId, {
      type: "PASSWORD_RESET",
      title: "Password reset by an administrator",
      message: "An administrator set a new password for this account and signed it out everywhere.",
      userId,
      email,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      deviceLabel: null,
      requestId: context.requestId,
      metadata: { actorUserId },
    });
  }

  /**
   * A mailbox now forwards outside the organisation — S2 §06 "suspicious new
   * forwarding rules", ZMT-19. Raised in the transaction that creates the
   * rule, so a rule can never exist without the alert that reports it.
   *
   * The account under suspicion is whoever set the rule up: forwarding is an
   * administrator setting, and a taken-over administrator is exactly who
   * would add one.
   */
  async recordExternalForwarding(
    tenantId: string,
    rule: { ruleId: string; mailboxId: string; mailboxAddress: string; destination: string; keepCopy: boolean },
    change: ChangeContext,
    db: Db
  ): Promise<void> {
    await this.createAlert(tenantId, {
      type: "FORWARDING_EXTERNAL",
      title: "Mail forwarded outside the organisation",
      message: `${rule.mailboxAddress} now forwards incoming mail to ${rule.destination}, an address outside this workspace's domains. If nobody here intended that, suspend the rule and sign the account that created it out.`,
      userId: change.actorUserId,
      email: null,
      ipAddress: change.ipAddress ?? null,
      userAgent: change.userAgent ?? null,
      deviceLabel: null,
      requestId: change.requestId,
      metadata: {
        ruleId: rule.ruleId,
        mailboxId: rule.mailboxId,
        mailbox: rule.mailboxAddress,
        destination: rule.destination,
        keepCopy: rule.keepCopy,
        subjectUserId: change.actorUserId,
      },
    }, db);
  }

  /**
   * Someone can now act in a mailbox that is not theirs — S2 §06 "delegate
   * changes". Raised for any delegation of a personal mailbox, and for a
   * shared-mailbox grant only when it adds send, manage or assign: being
   * given read on a team inbox is routine, being able to send as it is not.
   */
  async recordMailboxAccessGranted(
    tenantId: string,
    grant: {
      kind: "DELEGATION" | "SHARED_MAILBOX";
      accessId: string;
      mailboxId: string;
      mailboxAddress: string;
      granteeMembershipId: string;
      granteeEmail: string;
      before: Record<string, boolean> | null;
      after: Record<string, boolean>;
    },
    change: ChangeContext,
    db: Db
  ): Promise<void> {
    const added = Object.entries(grant.after)
      .filter(([permission, on]) => on && !grant.before?.[permission])
      .map(([permission]) => permission);
    await this.createAlert(tenantId, {
      type: "MAILBOX_ACCESS_GRANTED",
      title: grant.kind === "DELEGATION" ? "Mailbox delegated to another member" : "Shared mailbox access widened",
      message:
        grant.kind === "DELEGATION"
          ? `${grant.granteeEmail} was given access to ${grant.mailboxAddress}, another member's mailbox.`
          : `${grant.granteeEmail} can now ${added.map((p) => p.replace("can", "").toLowerCase()).join(", ")} in ${grant.mailboxAddress}.`,
      userId: change.actorUserId,
      email: null,
      ipAddress: change.ipAddress ?? null,
      userAgent: change.userAgent ?? null,
      deviceLabel: null,
      requestId: change.requestId,
      metadata: {
        kind: grant.kind,
        accessId: grant.accessId,
        mailboxId: grant.mailboxId,
        mailbox: grant.mailboxAddress,
        granteeMembershipId: grant.granteeMembershipId,
        grantee: grant.granteeEmail,
        added,
        permissions: grant.after,
        subjectUserId: change.actorUserId,
      },
    }, db);
  }

  // ── Review surface (owner / admin) ───────────────────────────────────────

  async list(tenantId: string, opts: { status?: SecurityAlertStatus; type?: SecurityAlertType; limit?: number }) {
    const where: Prisma.SecurityAlertWhereInput = {
      tenantId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.type ? { type: opts.type } : {}),
    };

    const [alerts, byStatus, openCount] = await Promise.all([
      prisma.securityAlert.findMany({
        where,
        select: ALERT_SELECT,
        orderBy: [{ createdAt: "desc" }],
        take: Math.min(opts.limit ?? 50, 200),
      }),
      prisma.securityAlert.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: true,
      }),
      prisma.securityAlert.count({ where: { tenantId, status: "OPEN" } }),
    ]);

    return {
      counts: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      openCount,
      alerts: alerts.map((alert) => serializeAlert(alert)),
    };
  }

  async getById(tenantId: string, alertId: string) {
    const alert = await prisma.securityAlert.findFirst({
      where: { id: alertId, tenantId },
      select: ALERT_SELECT,
    });
    if (!alert) throw new AppError("Security alert not found", 404, ErrorCodes.NOT_FOUND);
    return serializeAlert(alert);
  }

  /**
   * Owner/admin decision on an open alert. The choice (and who made it, from
   * where) is recorded to the audit log so a later dispute has an answer.
   */
  async review(tenantId: string, alertId: string, input: AlertReviewInput, actor: { userId: string }) {
    if (!ALERT_REVIEW_ACTIONS.includes(input.action)) {
      throw new AppError("Unknown review action", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const alert = await prisma.securityAlert.findFirst({
      where: { id: alertId, tenantId },
      select: { id: true, type: true, status: true, title: true },
    });
    if (!alert) throw new AppError("Security alert not found", 404, ErrorCodes.NOT_FOUND);

    const statusByAction: Record<AlertReviewAction, SecurityAlertStatus> = {
      ACKNOWLEDGE: "ACKNOWLEDGED",
      RESOLVE: "RESOLVED",
      DISMISS: "DISMISSED",
    };
    const status = statusByAction[input.action as AlertReviewAction];

    if (alert.status === status) {
      return this.getById(tenantId, alertId);
    }

    await prisma.$transaction(async (tx) => {
      await tx.securityAlert.update({
        where: { id: alertId },
        data: {
          status,
          resolvedById: actor.userId,
          resolvedAt: new Date(),
          resolutionNote: input.note ?? null,
        },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: actor.userId,
          eventType: "SECURITY_ALERT_REVIEWED",
          targetType: "SecurityAlert",
          targetId: alertId,
          metadata: { action: input.action, status, note: input.note ?? null, alertType: alert.type },
        },
        tx
      );
    });

    return this.getById(tenantId, alertId);
  }

  /**
   * Contain what an alert reports, and close it — S2 §06/§09, ZMT-19.
   *
   * One transaction: the alert is claimed first (only an open or acknowledged
   * alert can be remediated, so two responders acting at once apply it once),
   * then the containment runs, then the audit row. Any refusal rolls all three
   * back. The target is re-read inside the transaction and must still belong
   * to this workspace; signing an account out is held to the same role ceiling
   * as managing that person, so an Admin cannot sign an Owner out from here.
   */
  async remediate(tenantId: string, alertId: string, input: AlertRemediationInput, actor: AlertActor) {
    if (!REMEDIATION_ACTIONS.includes(input.action)) {
      throw new AppError("Unknown remediation action", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const alert = await prisma.securityAlert.findFirst({
      where: { id: alertId, tenantId },
      select: { id: true, type: true, status: true, actorUserId: true, metadata: true },
    });
    if (!alert) throw new AppError("Security alert not found", 404, ErrorCodes.NOT_FOUND);
    if (!REMEDIATIONS_BY_TYPE[alert.type].includes(input.action)) {
      throw new AppError(
        `${input.action} does not apply to a ${alert.type} alert`,
        400,
        ErrorCodes.VALIDATION_ERROR,
        { allowed: REMEDIATIONS_BY_TYPE[alert.type] }
      );
    }
    const metadata = (alert.metadata ?? {}) as Record<string, unknown>;

    const outcome = await prisma.$transaction(async (tx) => {
      const claimed = await tx.securityAlert.updateMany({
        where: { id: alertId, tenantId, status: { in: OPEN_STATES } },
        data: {
          status: "RESOLVED",
          resolvedById: actor.userId,
          resolvedAt: new Date(),
          resolutionNote: input.note ?? `Remediated: ${input.action}`,
        },
      });
      if (claimed.count !== 1) {
        throw new AppError("This alert is already closed", 409, ErrorCodes.CONFLICT, { reason: "ALERT_CLOSED" });
      }

      const result = await this.applyRemediation(tx, tenantId, input.action, alert.actorUserId, metadata, actor);

      await auditService.record(
        {
          tenantId,
          actorUserId: actor.userId,
          eventType: "SECURITY_ALERT_REMEDIATED",
          targetType: "SecurityAlert",
          targetId: alertId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress ?? null,
          userAgent: actor.userAgent ?? null,
          metadata: { action: input.action, alertType: alert.type, note: input.note ?? null, ...result },
        },
        tx
      );
      return result;
    });

    // After commit, so the reconnecting stream finds the sessions ended.
    if (outcome.result === "SESSIONS_REVOKED" && typeof outcome.subjectUserId === "string") {
      sseManager.endSessions({ userId: outcome.subjectUserId, tenantId });
    }
    return { alert: await this.getById(tenantId, alertId), outcome };
  }

  private async applyRemediation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    action: RemediationAction,
    alertActorUserId: string | null,
    metadata: Record<string, unknown>,
    actor: AlertActor
  ): Promise<Record<string, unknown>> {
    const id = (key: string) => {
      const value = metadata[key];
      if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
        throw new AppError("This alert does not identify what to act on", 422, ErrorCodes.VALIDATION_ERROR, { missing: key });
      }
      return value;
    };

    if (action === "SUSPEND_FORWARDING") {
      const ruleId = id("ruleId");
      const rule = await tx.forwardingRule.findFirst({ where: { id: ruleId, tenantId }, select: { id: true, status: true } });
      // Already deleted is contained: there is nothing left to forward with.
      if (!rule) return { result: "ALREADY_REMOVED", ruleId };
      if (rule.status !== "SUSPENDED") {
        await tx.forwardingRule.update({ where: { id: rule.id }, data: { status: "SUSPENDED" } });
      }
      return { result: "SUSPENDED", ruleId };
    }

    if (action === "REVOKE_MAILBOX_ACCESS") {
      const accessId = id("accessId");
      const removed = await tx.mailboxAccess.deleteMany({ where: { id: accessId, tenantId } });
      return { result: removed.count ? "REVOKED" : "ALREADY_REMOVED", accessId };
    }

    // REVOKE_SESSIONS: the account the alert is about.
    const subject = typeof metadata.subjectUserId === "string" ? metadata.subjectUserId : alertActorUserId;
    if (!subject) {
      throw new AppError("This alert does not name an account to sign out", 422, ErrorCodes.VALIDATION_ERROR);
    }
    const membership = await tx.tenantMembership.findFirst({
      where: { tenantId, userId: subject },
      select: { role: true },
    });
    if (!membership) return { result: "NOT_A_MEMBER", subjectUserId: subject, sessionsRevoked: 0 };
    if (subject !== actor.userId) assertCanManageRole(actor.role, membership.role);
    const sessionsRevoked = await revokeAllSessions(
      { userId: subject, tenantId, reason: RevokedReason.SECURITY_REMEDIATION },
      tx
    );
    return { result: "SESSIONS_REVOKED", subjectUserId: subject, sessionsRevoked };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async createAlert(
    tenantId: string,
    input: {
      type: SecurityAlertType;
      title: string;
      message: string;
      userId: string | null;
      email: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      deviceLabel: string | null;
      requestId?: string;
      metadata?: Record<string, unknown>;
    },
    /** The caller's transaction, when the alert must commit with its cause. */
    db?: Db
  ): Promise<void> {
    const write = async (tx: Prisma.TransactionClient) => {
      const alert = await tx.securityAlert.create({
        data: {
          tenantId,
          type: input.type,
          severity: ALERT_SEVERITY[input.type],
          status: "OPEN",
          title: input.title,
          message: input.message,
          actorUserId: input.userId,
          actorEmail: input.email,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          deviceLabel: input.deviceLabel,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: input.userId,
          eventType: "SECURITY_ALERT_CREATED",
          targetType: "SecurityAlert",
          targetId: alert.id,
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: { type: input.type, severity: alert.severity, title: input.title },
        },
        tx
      );
    };
    if (db && db !== prisma) await write(db as Prisma.TransactionClient);
    else await prisma.$transaction(write);
  }

  /**
   * True when an open alert for this type+account+source already exists within
   * the dedupe window — a fresh incident is reported once, not five times.
   */
  private async freshOpenAlertExists(
    tenantId: string,
    type: SecurityAlertType,
    userId: string | null,
    ipAddress: string | null
  ): Promise<boolean> {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60_000);
    const count = await prisma.securityAlert.count({
      where: {
        tenantId,
        type,
        status: "OPEN",
        ...(userId ? { actorUserId: userId } : {}),
        ...(ipAddress ? { ipAddress } : {}),
        createdAt: { gte: since },
      },
    });
    return count > 0;
  }
}

function serializeAlert(alert: Prisma.SecurityAlertGetPayload<{ select: typeof ALERT_SELECT }>) {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    title: alert.title,
    message: alert.message,
    actor: alert.actor ?? null,
    actorEmail: alert.actorEmail,
    ipAddress: alert.ipAddress,
    userAgent: alert.userAgent,
    deviceLabel: alert.deviceLabel,
    metadata: alert.metadata,
    resolutionNote: alert.resolutionNote,
    resolvedBy: alert.resolvedBy ?? null,
    resolvedAt: alert.resolvedAt,
    createdAt: alert.createdAt,
    // What can still be done from the alert; nothing once it is closed.
    remediations: OPEN_STATES.includes(alert.status) ? REMEDIATIONS_BY_TYPE[alert.type] : [],
  };
}

export const securityAlertService = new SecurityAlertService();