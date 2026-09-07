/**
 * Type definitions for the admin workspace.
 *
 * Data fixtures have been removed — all data now comes from the API via
 * admin-queries.ts. Only type definitions and the capability matrix /
 * guardrails (which have no backend endpoint yet) remain here.
 */

export type MfaMethod = "PASSKEY" | "TOTP" | "NONE";
export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";
export type MembershipStatus = "ACTIVE" | "INVITED" | "SUSPENDED" | "REMOVED";

export interface MemberDto {
  id: string;
  role: MembershipRole;
  status: MembershipStatus;
  mfaMethod: MfaMethod;
  lastActiveAt: string | null;
  user: { id: string; email: string; displayName: string };
}

export interface InvitationDto {
  id: string;
  email: string;
  role: MembershipRole;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface MailboxDto {
  id: string;
  address: string;
  type: "INDIVIDUAL" | "SHARED";
  status: "ACTIVE" | "SUSPENDED" | "PROVISIONING";
  storageUsedGb: number;
  storageLimitGb: number;
  aiEnabled: boolean;
  sendSuspensionReason: string | null;
}

export interface DnsRecordDto {
  type: "TXT" | "MX" | "CNAME";
  host: string;
  value: string;
  purpose: string;
  status: "VALID" | "INVALID" | "PENDING";
}

export interface DomainDto {
  id: string;
  domainName: string;
  type: "CUSTOM" | "ZOIKO";
  verificationStatus: "VERIFIED" | "PENDING" | "FAILED";
  mxStatus: "VALID" | "INVALID" | "PENDING";
  spfStatus: "VALID" | "INVALID" | "PENDING";
  dkimStatus: "VALID" | "INVALID" | "PENDING";
  dmarcStatus: "VALID" | "INVALID" | "PENDING";
  lastCheckedAt: string;
  sendingEnabled: boolean;
  warmupNote: string | null;
  records: DnsRecordDto[];
}

export interface GroupDto {
  id: string;
  address: string;
  kind: "SHARED" | "DISTRIBUTION";
  memberCount: number;
  status: "ACTIVE" | "SUSPENDED";
}

export interface AuditEventDto {
  id: string;
  eventType: string;
  actorName: string;
  actorType: "user" | "admin" | "support" | "system" | "ai_worker";
  targetLabel: string;
  createdAtLabel: string;
}

export interface ConnectorDto {
  id: string;
  name: string;
  detail: string;
  syncLabel: string;
  status: "ACTIVE" | "REAUTH_REQUIRED" | "IDLE";
}

export interface DashboardDto {
  tenant: { name: string; planCode: string; region: string; status: string };
  counts: {
    people: number;
    pendingInvitations: number;
    mailboxes: number;
    mailboxSeats: number;
    connectedAccounts: number;
    connectedGmail: number;
    connectedMicrosoft: number;
    domainsVerified: number;
    domainsTotal: number;
    mfaCovered: number;
    mfaTotal: number;
    failedSends24h: number;
    storageUsedGb: number;
    storageLimitGb: number;
  };
  recentAudit: AuditEventDto[];
  providerSync: ConnectorDto[];
}

export interface SupportGrantDto {
  id: string;
  ticket: string;
  holderName: string;
  scopeLabel: string;
  approvedByName: string;
  openedAtLabel: string;
  expiresInLabel: string;
}

/* ── Trust & access ────────────────────────────────────────────────────── */

/** 1 = allowed, 0 = denied, string = conditional (Step-up, 2-person, …). */
export type CapabilityCell = 1 | 0 | string;

export interface CapabilityRowDto {
  capability: string;
  member: CapabilityCell;
  admin: CapabilityCell;
  owner: CapabilityCell;
  support: CapabilityCell;
}

export interface CapabilityGroupDto {
  group: string;
  rows: CapabilityRowDto[];
}

export interface GuardrailDto {
  id: string;
  title: string;
  detail: string;
}

/**
 * The authoritative matrix. Rendered from fixtures today; once the server-side
 * capability map exists this comes from GET /permissions/matrix, so the page can
 * never drift from what the API actually enforces.
 */
export const CAPABILITY_MATRIX: CapabilityGroupDto[] = [
  {
    group: "Own work",
    rows: [
      { capability: "Read and send own mail", member: 1, admin: 1, owner: 1, support: 0 },
      { capability: "Manage own commitments", member: 1, admin: 1, owner: 1, support: 0 },
      { capability: "Connect own inbox", member: 1, admin: 1, owner: 1, support: 0 },
      { capability: "Read another member's mail", member: 0, admin: 0, owner: 0, support: 0 },
    ],
  },
  {
    group: "People",
    rows: [
      { capability: "See the user list", member: 0, admin: 1, owner: 1, support: "Read-only" },
      { capability: "Invite a Member", member: 0, admin: 1, owner: 1, support: 0 },
      { capability: "Invite an Admin", member: 0, admin: 0, owner: 1, support: 0 },
      { capability: "Invite an Owner", member: 0, admin: 0, owner: "2-person", support: 0 },
      { capability: "Suspend or remove a Member", member: 0, admin: 1, owner: 1, support: 0 },
      { capability: "Suspend or remove an Admin", member: 0, admin: 0, owner: 1, support: 0 },
      { capability: "Act on an Owner", member: 0, admin: 0, owner: 1, support: 0 },
      { capability: "Reset another person's MFA", member: 0, admin: 0, owner: "Step-up", support: 0 },
    ],
  },
  {
    group: "Workspace",
    rows: [
      { capability: "Read workspace settings", member: "Own", admin: 1, owner: 1, support: "Read-only" },
      { capability: "Change workspace settings", member: 0, admin: 1, owner: 1, support: 0 },
      { capability: "Manage mailboxes, domains, groups", member: 0, admin: 1, owner: 1, support: 0 },
      { capability: "Set the security policy", member: 0, admin: 0, owner: 1, support: 0 },
      { capability: "Read the audit log", member: 0, admin: 1, owner: 1, support: "Read-only" },
    ],
  },
  {
    group: "Money and liability",
    rows: [
      { capability: "View billing and seats", member: 0, admin: 0, owner: 1, support: 0 },
      { capability: "Change the plan", member: 0, admin: 0, owner: 1, support: 0 },
      { capability: "Export all workspace data", member: 0, admin: 0, owner: "Step-up", support: 0 },
      { capability: "Transfer ownership", member: 0, admin: 0, owner: "Step-up", support: 0 },
      { capability: "Delete the tenant", member: 0, admin: 0, owner: "Step-up", support: 0 },
    ],
  },
  {
    group: "Support",
    rows: [
      { capability: "Hold standing access", member: 0, admin: 0, owner: 0, support: 0 },
      { capability: "Access a workspace", member: 0, admin: 0, owner: 0, support: "Approved grant" },
      { capability: "End a support grant early", member: 0, admin: 1, owner: 1, support: 1 },
    ],
  },
];

export const GUARDRAILS: GuardrailDto[] = [
  {
    id: "g1",
    title: "No granting above your own level",
    detail:
      "An Admin inviting an Owner is escalation by proxy. The endpoint compares the requested role against the caller's and refuses upward grants.",
  },
  {
    id: "g2",
    title: "No acting on someone senior",
    detail:
      "An Admin cannot suspend, demote or remove an Owner. The button is disabled and the call is rejected server-side.",
  },
  {
    id: "g3",
    title: "A workspace always keeps one Owner",
    detail:
      "Removing or demoting the last active Owner is refused, or the workspace becomes unadministrable and only Zoiko could rescue it.",
  },
  {
    id: "g4",
    title: "Role is read per request",
    detail:
      "Never cached in the session. Demote an Admin and it takes effect on their next call, not when they choose to sign out.",
  },
  {
    id: "g5",
    title: "Every query is tenant-scoped",
    detail:
      "An RBAC slip leaks a feature; a tenant-scoping slip leaks another company's mail. Row-level security makes a forgotten WHERE return nothing.",
  },
  {
    id: "g6",
    title: "Step-up for consequential acts",
    detail:
      "Transfer, export and delete re-authenticate inside a valid session. A stolen cookie must not be enough to hand over the workspace.",
  },
];

/* ── Policies ──────────────────────────────────────────────────────────── */

export interface PolicyToggleDto {
  key: string;
  label: string;
  detail: string;
  enabled: boolean;
  /** Locked toggles are non-negotiable or Owner-only; refused server-side too. */
  locked: boolean;
}

export interface PolicyGroupDto {
  group: string;
  /** Set when the whole group sits outside this role's authority. */
  restriction: string | null;
  toggles: PolicyToggleDto[];
}

/* ── Provider sync ─────────────────────────────────────────────────────── */

export interface SyncErrorDto {
  id: string;
  title: string;
  detail: string;
  ago: string;
  action: string;
}

/* ── Notifications ─────────────────────────────────────────────────────── */

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  ago: string;
  severity: "INFO" | "WARNING" | "ACTION_REQUIRED" | "CRITICAL";
  readAt: string | null;
}

/* ── Workspace settings ────────────────────────────────────────────────── */

export interface SettingFieldDto {
  key: string;
  label: string;
  value: string;
  /** Read-only fields reflect a value enforced elsewhere, not an input. */
  readOnly: boolean;
}

export interface SettingsDto {
  general: SettingFieldDto[];
  sessions: SettingFieldDto[];
}

/* ── Own work ──────────────────────────────────────────────────────────── */

export interface CommitmentDto {
  id: string;
  title: string;
  sourceExcerpt: string;
  meta: string;
  due: string;
  state: "OVERDUE" | "DUE_TODAY" | "OPEN" | "APPROVAL";
}
