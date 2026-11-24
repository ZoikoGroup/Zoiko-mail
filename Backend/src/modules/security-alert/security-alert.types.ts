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
  // Forwarding to outside the organisation is how a compromised account
  // keeps reading mail after the password is changed (S2 §06, ZMT-19).
  FORWARDING_EXTERNAL: "HIGH",
  MAILBOX_ACCESS_GRANTED: "MEDIUM",
};

/**
 * The containment an owner or admin can apply straight from an alert — S2 §06
 * "containment controls respect authorization and support recovery", §09
 * "revoke sessions and investigate". Each is reversible by the ordinary
 * screens: a suspended rule can be re-enabled or deleted, access re-granted,
 * and a signed-out account signs in again.
 */
export type RemediationAction = "REVOKE_SESSIONS" | "SUSPEND_FORWARDING" | "REVOKE_MAILBOX_ACCESS";

export const REMEDIATION_ACTIONS: RemediationAction[] = [
  "REVOKE_SESSIONS",
  "SUSPEND_FORWARDING",
  "REVOKE_MAILBOX_ACCESS",
];

/**
 * Which containment fits which alert. Signing the account out applies to every
 * alert that names an account; the other two only to the change that raised
 * the alert, because they act on the rule or grant it points at.
 */
export const REMEDIATIONS_BY_TYPE: Record<SecurityAlertType, RemediationAction[]> = {
  NEW_DEVICE_LOGIN: ["REVOKE_SESSIONS"],
  FAILED_LOGIN_BURST: ["REVOKE_SESSIONS"],
  REFRESH_TOKEN_REUSE: ["REVOKE_SESSIONS"],
  PASSWORD_CHANGED: ["REVOKE_SESSIONS"],
  PASSWORD_RESET: ["REVOKE_SESSIONS"],
  FORWARDING_EXTERNAL: ["SUSPEND_FORWARDING", "REVOKE_SESSIONS"],
  MAILBOX_ACCESS_GRANTED: ["REVOKE_MAILBOX_ACCESS", "REVOKE_SESSIONS"],
};

export interface AlertRemediationInput {
  action: RemediationAction;
  note?: string;
}

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