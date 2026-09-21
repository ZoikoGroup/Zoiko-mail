import type { AlertSeverity, SecurityAlertType } from "@prisma/client";

/**
 * Severity mapping for each alert the auth pipeline can generate.
 *
 * Severity is assigned when the alert is *created*, from here, so a future
 * change in how alarming an event should be is one line in this table rather
 * than a data migration over `security_alerts`.
 */
export const ALERT_SEVERITY: Record<SecurityAlertType, AlertSeverity> = {
  NEW_DEVICE_LOGIN: "MEDIUM",
  FAILED_LOGIN_BURST: "HIGH",
  REFRESH_TOKEN_REUSE: "CRITICAL",
  PASSWORD_CHANGED: "LOW",
  PASSWORD_RESET: "HIGH",
};

export interface AlertFingerprint {
  tenantId: string;
  userId: string | null;
  email: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
}

/** The raw context the auth pipeline hands over when something happens. */
export interface AlertContext extends AlertFingerprint {
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/** How an opens alert may be handled by an owner or admin. */
export type AlertReviewAction = "ACKNOWLEDGE" | "RESOLVE" | "DISMISS";

export const ALERT_REVIEW_ACTIONS: AlertReviewAction[] = [
  "ACKNOWLEDGE",
  "RESOLVE",
  "DISMISS",
];

export interface AlertReviewInput {
  action: AlertReviewAction;
  note?: string;
}