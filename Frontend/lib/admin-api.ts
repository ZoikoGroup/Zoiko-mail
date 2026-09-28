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
  /**
   * The member this mailbox belongs to, or null for a shared or distribution
   * mailbox, which belongs to the workspace rather than to one person.
   * Carried so the create dialog can offer members who have no mailbox yet.
   */
  membershipId: string | null;
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

/**
 * One past DNS check for a domain.
 *
 * The domain row carries only the latest result, so it answers "is it failing"
 * and not "since when" — which is the question an admin actually has after a
 * re-check comes back red. `errors` names the resolver failures the check
 * recorded, rather than leaving a red pill to be interpreted.
 */
export interface DomainCheckDto {
  id: string;
  checkedAt: string;
  verificationStatus: "VERIFIED" | "PENDING" | "FAILED";
  mxStatus: "VALID" | "INVALID" | "PENDING";
  spfStatus: "VALID" | "INVALID" | "PENDING";
  dkimStatus: "VALID" | "INVALID" | "PENDING";
  dmarcStatus: "VALID" | "INVALID" | "PENDING";
  errors: string[];
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
  /**
   * Audit §6.2's enumerated actor type, lower-cased for display. "provider" is
   * a callback from Google or Microsoft acting on its own schedule, which is
   * neither a person nor this system.
   */
  actorType: "user" | "admin" | "support" | "system" | "ai_worker" | "provider";
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

/** Failure counts behind the dashboard's failed-sends tile. */
export interface DeliveryFailureSummaryDto {
  windowHours: number;
  failed: number;
  /** Per-type breakdown, so the tile can say what kind of failure it saw. */
  byType: Record<string, number>;
}

export interface DashboardDto {
  /**
   * `timezone`, not `region`. The tenant has no region column — Data Model
   * §6.1 specifies `primary_region` and the schema does not implement it — so
   * the subtitle used to print the timezone under the word "region". Naming
   * the field for what it holds is what stops that recurring.
   */
  tenant: { name: string; planCode: string; timezone: string; status: string };
  counts: {
    people: number;
    pendingInvitations: number;
    mailboxes: number;
    suspendedMailboxes: number;
    connectedAccounts: number;
    connectedGmail: number;
    connectedMicrosoft: number;
    domainsVerified: number;
    domainsTotal: number;
    storageUsedGb: number;
    storageLimitGb: number;
  };
  /**
   * MFA state, reported rather than inferred.
   *
   * Counted two ways, because they answer different questions. `covered` of
   * `total` is how much of the workspace holds a second factor; `requiredCovered`
   * of `requiredTotal` is the only one that means compliance, since AC-002
   * compels Owners, Admins and Support and leaves members free to decline.
   * A workspace can be fully compliant with most of its people unenrolled,
   * and warning on the wider number tells an Admin to chase a problem that
   * does not exist.
   *
   * `supported: false` is now only produced by the fallback path, which
   * composes the dashboard from individual reads and has no way to count.
   */
  mfa: {
    supported: boolean;
    covered: number;
    total: number;
    requiredCovered: number;
    requiredTotal: number;
  };
  /** Null while the read is in flight or refused; the tile then shows "—". */
  deliveryFailures: DeliveryFailureSummaryDto | null;
  supportGrants: number;
  recentAudit: AuditEventDto[];
  providerSync: ConnectorDto[];
  /**
   * Sections the server could not read. Empty on a healthy response. Present
   * so the page can name what is missing instead of showing a confident zero.
   */
  degraded: string[];
  /** True when the audit tail was withheld for lack of `audit.read`. */
  auditWithheld: boolean;
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

/**
 * A policy as the API actually models it.
 *
 * The screen used to render a list of boolean toggles built by filtering the
 * rules object for boolean values. `policyRulesSchema` is
 * `{ defaultEffect, conditions[] }` — no rule is ever a boolean — so that list
 * was empty in every workspace and always had been. This is the real shape.
 */
export type PolicyType = "AI" | "SENDING" | "RETENTION" | "DELETION" | "ABUSE";
export type PolicyEffect = "ALLOW" | "DENY";

export interface PolicyConditionDto {
  field: string;
  operator: string;
  /** Already rendered for display; a value may be a scalar or a list. */
  value: string;
  effect: PolicyEffect;
}

export interface PolicyDto {
  id: string;
  type: PolicyType;
  name: string;
  description: string | null;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  /** What applies when no condition matches — the one rule worth editing here. */
  defaultEffect: PolicyEffect;
  conditions: PolicyConditionDto[];
}

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

/* ── security alerts ───────────────────────────────────────────────────── */

/**
 * The alert inbox. Recovered along with the module behind it, which PR #35
 * dropped together with the `security_alerts` table's model — the table kept
 * being created on every deploy and nothing in the product knew about it.
 */
export type SecurityAlertType =
  | "NEW_DEVICE_LOGIN"
  | "FAILED_LOGIN_BURST"
  | "REFRESH_TOKEN_REUSE"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
export type AlertReviewAction = "ACKNOWLEDGE" | "RESOLVE" | "DISMISS";

export interface SecurityAlertDto {
  id: string;
  type: SecurityAlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  actor: { id: string; email: string; displayName: string | null } | null;
  resolvedBy: { id: string; email: string; displayName: string | null } | null;
}

export interface SecurityAlertListResponse {
  counts: Partial<Record<AlertStatus, number>>;
  openCount: number;
  alerts: SecurityAlertDto[];
}
