import { apiRequest } from "@/lib/api-client";

/**
 * Account security — P1. Your own sessions, and containment from a security
 * alert. Backend: /api/v1/account-security and /api/v1/security-alerts/:id/remediate.
 */

export interface AccountSession {
  /** The session id, or `row:<id>` for a sign-in recorded before sessions were. */
  key: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  /** The session this browser is using. */
  current: boolean;
}

export async function fetchMySessions(): Promise<AccountSession[]> {
  const res = await apiRequest<{ sessions: AccountSession[] }>("/account-security/sessions");
  return res.sessions ?? [];
}

/** Sign one session out. Ending this browser's own session is a sign-out. */
export async function revokeMySession(key: string): Promise<{ key: string; revoked: boolean; current: boolean }> {
  return apiRequest(`/account-security/sessions/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export type RemediationAction = "REVOKE_SESSIONS" | "SUSPEND_FORWARDING" | "REVOKE_MAILBOX_ACCESS";

export const REMEDIATION_LABEL: Record<RemediationAction, { label: string; confirm: string }> = {
  REVOKE_SESSIONS: {
    label: "Sign account out",
    confirm: "Every session of the account this alert is about ends now, on every device. They can sign in again.",
  },
  SUSPEND_FORWARDING: {
    label: "Suspend forwarding",
    confirm: "The forwarding rule stops. It stays on the mailbox, suspended, so it can be reviewed or removed.",
  },
  REVOKE_MAILBOX_ACCESS: {
    label: "Remove access",
    confirm: "The access this alert reports is removed. It can be granted again from the mailbox's settings.",
  },
};

/** Contain what an alert reports and close it. The server audits it. */
export async function remediateSecurityAlert(id: string, action: RemediationAction, note?: string) {
  return apiRequest<{ outcome: Record<string, unknown> }>(`/security-alerts/${id}/remediate`, {
    method: "POST",
    body: { action, ...(note ? { note } : {}) },
  });
}
