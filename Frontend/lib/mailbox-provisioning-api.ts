import { apiRequest } from "./api-client";

/**
 * Hosted mailbox creation (Create Email).
 *
 * Shared by the Owner and Admin dashboards — both reach the same endpoints,
 * and the server decides what each role may do. Nothing here is trusted for
 * authorization: the tenant comes from the session, and the address is
 * composed on the server from the domain the workspace owns.
 */

export type ProvisioningStatus = "PENDING" | "PROVISIONING" | "PROVISIONED" | "FAILED";
export type InvitationStatus = "NOT_REQUIRED" | "PENDING" | "SENT" | "FAILED";
export type MailboxDisplayStatus =
  | "ACTIVE"
  | "PROVISIONING"
  | "INVITATION_PENDING"
  | "FAILED"
  | "SUSPENDED";

export interface ProvisioningDomain {
  id: string;
  domainName: string;
  verificationStatus: "PENDING" | "VERIFIED" | "FAILED";
  usable: boolean;
  readiness: {
    ownershipVerified: boolean;
    inboundRouting: boolean;
    outboundConfigured: boolean;
    dmarcPublished: boolean;
  };
}

export interface ProvisioningOptions {
  providerConfigured: boolean;
  provider: string;
  domains: ProvisioningDomain[];
  quota: { optionsBytes: number[]; defaultBytes: number | null; maxBytes: number | null };
  mailboxes: { used: number; limit: number | null };
  invitationDelivery: "EMAIL" | "DISABLED";
}

export interface ProvisionMailboxInput {
  domainId: string;
  localPart: string;
  displayName: string;
  quotaBytes: number;
  initialAccess: "INVITE";
  recoveryEmail: string;
}

export interface ProvisionedMailbox {
  id: string;
  address: string;
  displayName: string | null;
  domainName: string | null;
  quotaBytes: number;
  appliedQuotaBytes: number | null;
  provisioningStatus: ProvisioningStatus | null;
  provisioningError: string | null;
  invitationStatus: InvitationStatus | null;
  invitationError: string | null;
  invitationRecipient: string | null;
  membershipStatus: string | null;
  status: MailboxDisplayStatus;
}

/** What a mailbox list row needs to show its status and its next action. */
export interface MailboxStatusRow {
  id: string;
  address: string;
  status: MailboxDisplayStatus;
  provisioningStatus: ProvisioningStatus | null;
  provisioningError: string | null;
  invitationStatus: InvitationStatus | null;
  invitationError: string | null;
  invitationRecipient: string | null;
  membershipStatus: string | null;
}

export function fetchProvisioningOptions(): Promise<ProvisioningOptions> {
  return apiRequest<ProvisioningOptions>("/mail/admin/mailboxes/provisioning-options");
}

/**
 * Create the mailbox.
 *
 * The Idempotency-Key is chosen by the caller and kept for the life of one
 * confirmation, so a double click or a retried request replays the first
 * answer instead of asking the mail server twice.
 */
export function provisionMailbox(
  input: ProvisionMailboxInput,
  idempotencyKey: string
): Promise<ProvisionedMailbox> {
  return apiRequest<ProvisionedMailbox>("/mail/admin/mailboxes/provision", {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function retryMailboxProvisioning(mailboxId: string): Promise<ProvisionedMailbox> {
  return apiRequest<ProvisionedMailbox>(`/mail/admin/mailboxes/${mailboxId}/provisioning/retry`, {
    method: "POST",
  });
}

export function resendMailboxInvitation(mailboxId: string): Promise<ProvisionedMailbox> {
  return apiRequest<ProvisionedMailbox>(`/mail/admin/mailboxes/${mailboxId}/invitation/resend`, {
    method: "POST",
  });
}

/* ── shared presentation rules ─────────────────────────────────────────── */

/**
 * The status a person reads, from the row's facts. The same order the server
 * uses, so the list and the result screen cannot disagree: a failed or
 * unfinished provisioning outranks everything, then suspension, then an
 * invitation nobody has accepted yet.
 */
export function mailboxDisplayStatus(row: {
  provisioningStatus?: ProvisioningStatus | null;
  sendSuspendedAt?: string | null;
  membership?: { status?: string } | null;
}): MailboxDisplayStatus {
  if (row.provisioningStatus === "FAILED") return "FAILED";
  if (row.provisioningStatus === "PENDING" || row.provisioningStatus === "PROVISIONING") return "PROVISIONING";
  if (row.sendSuspendedAt) return "SUSPENDED";
  if (row.membership?.status === "INVITED") return "INVITATION_PENDING";
  return "ACTIVE";
}

export const STATUS_LABEL: Record<MailboxDisplayStatus, string> = {
  ACTIVE: "Active",
  PROVISIONING: "Provisioning",
  INVITATION_PENDING: "Invitation Pending",
  FAILED: "Failed",
  SUSPENDED: "Suspended",
};

export const STATUS_TONE: Record<MailboxDisplayStatus, "ok" | "warn" | "crit" | "ai" | "nu"> = {
  ACTIVE: "ok",
  PROVISIONING: "ai",
  INVITATION_PENDING: "warn",
  FAILED: "crit",
  SUSPENDED: "crit",
};

/** Plain-language versions of the server's safe error codes. */
export function describeProvisioningError(code: string | null): string {
  switch (code) {
    case "STALWART_TIMEOUT":
      return "The mail server did not answer in time. It may still have created the account — retrying checks first and will not create a second one.";
    case "STALWART_UNREACHABLE":
    case "STALWART_UNAVAILABLE":
      return "The mail server could not be reached. Retry when it is back.";
    case "STALWART_RATE_LIMITED":
      return "The mail server is limiting requests. Retry in a minute.";
    case "STALWART_AUTH_FAILED":
    case "STALWART_FORBIDDEN":
    case "STALWART_NOT_CONFIGURED":
    case "STALWART_NOT_SUPPORTED":
      return "The platform's connection to the mail server is misconfigured. An operator needs to fix it before this can succeed.";
    case "STALWART_ALREADY_EXISTS":
      return "This address already exists on the mail server and was not created by Zoiko Mail, so it was not taken over.";
    case "STALWART_DOMAIN_MISSING":
      return "The domain is not registered on the mail server yet.";
    case null:
      return "";
    default:
      return "The mail server did not confirm the account.";
  }
}

export function describeInvitation(status: InvitationStatus | null, error: string | null, recipient: string | null): string {
  switch (status) {
    case "SENT":
      return `Invitation sent to ${recipient ?? "the recipient"}.`;
    case "FAILED":
      return `The invitation to ${recipient ?? "the recipient"} could not be delivered. Resending does not create another mailbox.`;
    case "NOT_REQUIRED":
      return `${recipient ?? "The member"} already belongs to this workspace — the mailbox appears for them directly.`;
    case "PENDING":
      return error === "SYSTEM_MAIL_DISABLED"
        ? "Email delivery is turned off on this deployment, so the invitation was not sent."
        : "The invitation will be sent once the mailbox is provisioned.";
    default:
      return "";
  }
}

export function formatQuota(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const gib = bytes / 1024 ** 3;
  return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GB`;
}

/** Names the mail system keeps for itself; mirrors the server's list. */
const RESERVED = new Set(["postmaster", "abuse", "hostmaster", "mailer-daemon", "root", "nobody", "noreply", "no-reply"]);

/**
 * The same rule the server enforces, checked early so the person sees it
 * while typing. The server checks again; this is convenience, not the gate.
 */
export function localPartProblem(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return "Enter the part before the @.";
  if (v.length > 64) return "Keep it to 64 characters or fewer.";
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(v) || v.includes("..")) {
    return "Use letters, numbers, dots, hyphens or underscores, starting and ending with a letter or number.";
  }
  if (RESERVED.has(v)) return `${v}@ is reserved for the mail system.`;
  return null;
}

export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return "Enter the address the invitation should go to.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address.";
  return null;
}
