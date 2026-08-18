/**
 * Static fixtures for the admin workspace.
 *
 * Every shape here mirrors the response the API will eventually return, so the
 * real-data swap happens inside `lib/admin/hooks.ts` and no component changes.
 * Counts match `Backend/prisma/seed.ts` so the static UI and the seeded API show
 * the same workspace.
 *
 * Where the shape is already known from a live endpoint it is copied exactly —
 * `/membership/members` returns `{ members: [...] }`, not a bare array.
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

/* ── data ──────────────────────────────────────────────────────────────── */

export const MEMBERS: MemberDto[] = [
  { id: "mem-1", role: "OWNER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "2 min ago", user: { id: "u1", email: "alex@acme.test", displayName: "Alex Sharma" } },
  { id: "mem-2", role: "OWNER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "1 h ago", user: { id: "u2", email: "helena@acme.test", displayName: "Helena Voss" } },
  { id: "mem-3", role: "ADMIN", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "9 min ago", user: { id: "u3", email: "devon@acme.test", displayName: "Devon Blake" } },
  { id: "mem-4", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "14 min ago", user: { id: "u4", email: "priya@acme.test", displayName: "Priya Nair" } },
  { id: "mem-5", role: "MEMBER", status: "ACTIVE", mfaMethod: "NONE", lastActiveAt: "3 days ago", user: { id: "u5", email: "sam@acme.test", displayName: "Sam Okafor" } },
  { id: "mem-6", role: "MEMBER", status: "ACTIVE", mfaMethod: "TOTP", lastActiveAt: "94 days ago", user: { id: "u6", email: "contractor@acme.test", displayName: "Tomas Cruz" } },
  { id: "mem-7", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "40 min ago", user: { id: "u7", email: "mia@acme.test", displayName: "Mia Chen" } },
  { id: "mem-8", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "2 h ago", user: { id: "u8", email: "noah@acme.test", displayName: "Noah Reed" } },
  { id: "mem-9", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "5 h ago", user: { id: "u9", email: "ivy@acme.test", displayName: "Ivy Patel" } },
  { id: "mem-10", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "1 day ago", user: { id: "u10", email: "leo@acme.test", displayName: "Leo Marsh" } },
  { id: "mem-11", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "2 days ago", user: { id: "u11", email: "zara@acme.test", displayName: "Zara Khan" } },
  { id: "mem-12", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "6 h ago", user: { id: "u12", email: "owen@acme.test", displayName: "Owen Diaz" } },
  { id: "mem-13", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "30 min ago", user: { id: "u13", email: "ruby@acme.test", displayName: "Ruby Hart" } },
  { id: "mem-14", role: "MEMBER", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "8 h ago", user: { id: "u14", email: "felix@acme.test", displayName: "Felix Nwosu" } },
  // Present in the API response and filtered out by the Users screen: the
  // support actor holds a membership only because SupportAccessGrant requires
  // one. Keeping it here means the screen's filter is exercised, not assumed.
  { id: "mem-15", role: "SUPPORT", status: "ACTIVE", mfaMethod: "PASSKEY", lastActiveAt: "1 h ago", user: { id: "u15", email: "jordan@zoikosupport.test", displayName: "Jordan Reyes" } },
];

export const INVITATIONS: InvitationDto[] = [
  { id: "inv-1", email: "rob@acme.test", role: "MEMBER", invitedByName: "Devon Blake", createdAt: "2 days ago", expiresAt: "Expires tomorrow" },
  { id: "inv-2", email: "nina@acme.test", role: "MEMBER", invitedByName: "Devon Blake", createdAt: "6 hours ago", expiresAt: "3 days left" },
  { id: "inv-3", email: "ops@acme.test", role: "ADMIN", invitedByName: "Alex Sharma", createdAt: "1 day ago", expiresAt: "2 days left" },
];

export const MAILBOXES: MailboxDto[] = [
  { id: "mbx-1", address: "alex@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 4.2, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-2", address: "helena@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 6.1, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-3", address: "devon@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 9.8, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-4", address: "priya@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 12.4, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-5", address: "billing@acme.test", type: "SHARED", status: "ACTIVE", storageUsedGb: 1.1, storageLimitGb: 30, aiEnabled: false, sendSuspensionReason: null },
  { id: "mbx-6", address: "sales@acme.test", type: "SHARED", status: "ACTIVE", storageUsedGb: 5.5, storageLimitGb: 30, aiEnabled: false, sendSuspensionReason: null },
  { id: "mbx-7", address: "contractor@acme.test", type: "INDIVIDUAL", status: "SUSPENDED", storageUsedGb: 18.4, storageLimitGb: 30, aiEnabled: false, sendSuspensionReason: "Repeated hard bounces above pilot threshold" },
  { id: "mbx-8", address: "mia@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 2.7, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-9", address: "noah@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 7.9, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-10", address: "ivy@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 3.3, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
  { id: "mbx-11", address: "leo@acme.test", type: "INDIVIDUAL", status: "ACTIVE", storageUsedGb: 15.2, storageLimitGb: 30, aiEnabled: true, sendSuspensionReason: null },
];

export const DOMAINS: DomainDto[] = [
  {
    id: "dom-1",
    domainName: "acme.test",
    type: "CUSTOM",
    verificationStatus: "VERIFIED",
    mxStatus: "VALID",
    spfStatus: "VALID",
    dkimStatus: "VALID",
    dmarcStatus: "VALID",
    lastCheckedAt: "1 hour ago",
    sendingEnabled: true,
    warmupNote: null,
    records: [
      { type: "TXT", host: "@", value: "zoiko-verify=9f2c1ab74e65c55d41c887", purpose: "Ownership verification", status: "VALID" },
      { type: "MX", host: "@", value: "10 mx1.provider.zoikomail.com", purpose: "Inbound routing", status: "VALID" },
      { type: "TXT", host: "@", value: "v=spf1 include:spf.zoikomail.com ~all", purpose: "Authorises senders", status: "VALID" },
      { type: "CNAME", host: "zm1._domainkey", value: "zm1.dkim.zoikomail.com", purpose: "DKIM signing (2048-bit)", status: "VALID" },
      { type: "TXT", host: "_dmarc", value: "v=DMARC1; p=quarantine; pct=100", purpose: "Alignment policy", status: "VALID" },
    ],
  },
  {
    id: "dom-2",
    domainName: "zoikomail.com",
    type: "ZOIKO",
    verificationStatus: "VERIFIED",
    mxStatus: "VALID",
    spfStatus: "VALID",
    dkimStatus: "VALID",
    dmarcStatus: "VALID",
    lastCheckedAt: "1 minute ago",
    sendingEnabled: true,
    warmupNote: "Day 14 of 30 · sending capped at 50 recipients per mailbox per day",
    records: [],
  },
];

export const GROUPS: GroupDto[] = [
  { id: "grp-1", address: "sales@acme.test", kind: "SHARED", memberCount: 5, status: "ACTIVE" },
  { id: "grp-2", address: "support@acme.test", kind: "SHARED", memberCount: 3, status: "SUSPENDED" },
  { id: "grp-3", address: "billing@acme.test", kind: "SHARED", memberCount: 2, status: "ACTIVE" },
  { id: "grp-4", address: "all-staff@acme.test", kind: "DISTRIBUTION", memberCount: 14, status: "ACTIVE" },
];

export const AUDIT_EVENTS: AuditEventDto[] = [
  { id: "ae-1", eventType: "Mailbox created", actorName: "Devon Blake", actorType: "admin", targetLabel: "billing@acme.test", createdAtLabel: "2 min ago" },
  { id: "ae-2", eventType: "AI eligibility check passed", actorName: "System · Policy", actorType: "system", targetLabel: "Thread 8827", createdAtLabel: "9 min ago" },
  { id: "ae-3", eventType: "Access grant opened", actorName: "Jordan Reyes · Support", actorType: "support", targetLabel: "ZM-4821 · approved by H. Voss", createdAtLabel: "3 h ago" },
  { id: "ae-4", eventType: "Domain verified", actorName: "Alex Sharma", actorType: "admin", targetLabel: "acme.test", createdAtLabel: "1 day ago" },
  { id: "ae-5", eventType: "Connected account revoked", actorName: "Sam Okafor", actorType: "user", targetLabel: "Gmail", createdAtLabel: "2 days ago" },
  { id: "ae-6", eventType: "Failed sign-in ×5 → account locked", actorName: "Unknown", actorType: "system", targetLabel: "unknown@acme.test", createdAtLabel: "2 days ago" },
  { id: "ae-7", eventType: "Sending policy changed", actorName: "Alex Sharma", actorType: "admin", targetLabel: "Policy v1", createdAtLabel: "20 days ago" },
  { id: "ae-8", eventType: "Mailbox suspended", actorName: "Devon Blake", actorType: "admin", targetLabel: "contractor@acme.test", createdAtLabel: "2 days ago" },
];

export const CONNECTORS: ConnectorDto[] = [
  { id: "con-1", name: "Gmail API", detail: "Read-only OAuth · push notifications active", syncLabel: "Synced 4 min ago", status: "ACTIVE" },
  { id: "con-2", name: "Microsoft Graph", detail: "Change-notification subscriptions", syncLabel: "Synced 11 min ago", status: "ACTIVE" },
  { id: "con-3", name: "Hosted mail provider", detail: "SMTP/API send + webmail", syncLabel: "Synced 1 min ago", status: "ACTIVE" },
  { id: "con-4", name: "Subscription renewal worker", detail: "Microsoft Graph subscriptions", syncLabel: "Next run in 6 h", status: "IDLE" },
];

export const ACTIVE_GRANT: SupportGrantDto | null = {
  id: "grant-1",
  ticket: "ZM-4821",
  holderName: "Jordan Reyes",
  scopeLabel: "read-only · no mail bodies",
  approvedByName: "H. Voss",
  openedAtLabel: "11:13",
  expiresInLabel: "2h 47m left",
};

export const DASHBOARD: DashboardDto = {
  tenant: { name: "Acme Corp", planCode: "Growth", region: "US", status: "active" },
  counts: {
    people: 14,
    pendingInvitations: 3,
    mailboxes: 11,
    mailboxSeats: 25,
    connectedAccounts: 9,
    connectedGmail: 6,
    connectedMicrosoft: 3,
    domainsVerified: 2,
    domainsTotal: 2,
    mfaCovered: 12,
    mfaTotal: 14,
    failedSends24h: 3,
    storageUsedGb: 142,
    storageLimitGb: 330,
  },
  recentAudit: AUDIT_EVENTS.slice(0, 4),
  providerSync: CONNECTORS.slice(0, 3),
};

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
      { capability: "Read another member’s mail", member: 0, admin: 0, owner: 0, support: 0 },
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
      { capability: "Reset another person’s MFA", member: 0, admin: 0, owner: "Step-up", support: 0 },
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
      "An Admin inviting an Owner is escalation by proxy. The endpoint compares the requested role against the caller’s and refuses upward grants.",
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
      "An RBAC slip leaks a feature; a tenant-scoping slip leaks another company’s mail. Row-level security makes a forgotten WHERE return nothing.",
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
  /** Set when the whole group sits outside this role’s authority. */
  restriction: string | null;
  toggles: PolicyToggleDto[];
}

export const POLICY_GROUPS: PolicyGroupDto[] = [
  {
    group: "AI",
    restriction: null,
    toggles: [
      { key: "ai.commitment", label: "Commitment detection", detail: "Reply owed, approval, deadline and follow-up extraction", enabled: true, locked: false },
      { key: "ai.summary", label: "Thread summarisation", detail: "Pilot hosted mailboxes only", enabled: true, locked: false },
      { key: "ai.draft", label: "Draft reply", detail: "Human-approved send always required", enabled: true, locked: false },
      { key: "ai.restricted", label: "Restricted mailboxes excluded from AI", detail: "HR and legal flagged by default", enabled: true, locked: true },
      { key: "ai.training", label: "AI training on customer data", detail: "Never permitted", enabled: false, locked: true },
    ],
  },
  {
    group: "Sending",
    restriction: null,
    toggles: [
      { key: "send.ratelimit", label: "Rate-limited sending", detail: "Per-tenant and per-mailbox caps", enabled: true, locked: false },
      { key: "send.warmup", label: "New-domain warm-up", detail: "Gradual volume ramp", enabled: true, locked: false },
      { key: "send.templates", label: "Template-based sending", detail: "Requires admin-approved templates", enabled: false, locked: false },
      { key: "send.autonomous", label: "Autonomous external sending", detail: "Blocked at launch — governance review required", enabled: false, locked: true },
    ],
  },
  {
    group: "Access",
    restriction: "Owner only",
    toggles: [
      { key: "access.mfa.privileged", label: "Require MFA for Owner and Admin", detail: "Passkey preferred, TOTP fallback", enabled: true, locked: true },
      { key: "access.mfa.all", label: "Require MFA for all Members", detail: "2 people currently without", enabled: false, locked: true },
      { key: "access.silentsupport", label: "Silent support access", detail: "Never permitted — approval always required", enabled: false, locked: true },
      { key: "access.iplist", label: "IP allow-list", detail: "Configured but not enforced", enabled: false, locked: true },
    ],
  },
];

/* ── Provider sync ─────────────────────────────────────────────────────── */

export interface SyncErrorDto {
  id: string;
  title: string;
  detail: string;
  ago: string;
  action: string;
}

export const SYNC_ERRORS: SyncErrorDto[] = [
  {
    id: "err-1",
    title: "OAuth token expired",
    detail: "Gmail connector · sam@acme.test",
    ago: "1 day ago",
    action: "Re-auth",
  },
];

/* ── Notifications ─────────────────────────────────────────────────────── */

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  ago: string;
  severity: "INFO" | "WARNING" | "ACTION_REQUIRED" | "CRITICAL";
  readAt: string | null;
}

export const NOTIFICATIONS: NotificationDto[] = [
  { id: "n-1", title: "Failed sends detected", body: "3 messages failed from contractor@acme.test in the last 24 hours.", ago: "12m ago", severity: "CRITICAL", readAt: null },
  { id: "n-2", title: "Support access opened", body: "Jordan Reyes holds a 4 hour read-only grant, approved by H. Voss.", ago: "3h ago", severity: "ACTION_REQUIRED", readAt: null },
  { id: "n-3", title: "Invitation expiring", body: "The invitation for rob@acme.test expires tomorrow.", ago: "8h ago", severity: "WARNING", readAt: null },
  { id: "n-4", title: "Domain verified", body: "acme.test passed DKIM validation.", ago: "1d ago", severity: "INFO", readAt: "1d ago" },
];

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

export const SETTINGS: SettingsDto = {
  general: [
    { key: "name", label: "Workspace name", value: "Acme Corp", readOnly: false },
    { key: "defaultDomain", label: "Default domain", value: "acme.test", readOnly: false },
    { key: "timezone", label: "Timezone", value: "Europe/London", readOnly: false },
    { key: "quota", label: "Default mailbox quota", value: "30 GB", readOnly: false },
  ],
  sessions: [
    { key: "idle", label: "Idle timeout", value: "30 min Member · 15 min Owner and Admin", readOnly: true },
    { key: "absolute", label: "Absolute lifetime", value: "8 hours, then full re-authentication", readOnly: true },
  ],
};

/* ── Own work ──────────────────────────────────────────────────────────── */

export interface CommitmentDto {
  id: string;
  title: string;
  sourceExcerpt: string;
  meta: string;
  due: string;
  state: "OVERDUE" | "DUE_TODAY" | "OPEN" | "APPROVAL";
}

export const COMMITMENTS: CommitmentDto[] = [
  { id: "c-1", title: "Send revised proposal to Meridian", sourceExcerpt: "I’ll get the revised pricing over to you before end of week.", meta: "Meridian Partners · thread 8812", due: "Overdue 2 days", state: "OVERDUE" },
  { id: "c-2", title: "Confirm Q4 numbers for Finance", sourceExcerpt: "Can you confirm the Tuesday figures before the board pack goes out?", meta: "Finance Acme · thread 8827", due: "Due today", state: "DUE_TODAY" },
  { id: "c-3", title: "Counter-sign the Meridian NDA", sourceExcerpt: "Please find the signed copy attached, let us know once countersigned.", meta: "Meridian Legal · thread 8790", due: "Approval requested", state: "APPROVAL" },
  { id: "c-4", title: "Reply on invoice 4402 dispute", sourceExcerpt: "Flagging a line-item discrepancy on this invoice.", meta: "Billing Acme · thread 8801", due: "Due in 2 days", state: "OPEN" },
];
