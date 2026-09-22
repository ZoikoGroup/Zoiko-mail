import { Prisma } from "@prisma/client";
import type { SecurityAlertStatus, SecurityAlertType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { ALERT_SEVERITY, ALERT_REVIEW_ACTIONS } from "./security-alert.types.js";
import type { AlertContext, AlertReviewAction, AlertReviewInput } from "./security-alert.types.js";

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
    }
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
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
    });
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
  };
}

export const securityAlertService = new SecurityAlertService();