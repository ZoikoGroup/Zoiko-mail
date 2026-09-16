/**
 * Type definitions for the admin workspace.
 *
 * Data fixtures have been removed — all data comes from the API via
 * admin-queries.ts, including the capability matrix and guardrails
 * (GET /permissions/matrix and GET /permissions/guardrails).
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
  name: string | null;
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

/* ── security alerts ───────────────────────────────────────────────────── */

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

/* ── Policies ──────────────────────────────────────────────────────────── */

export interface PolicyRuleCondition {
  field: string;
  operator:
    | "EQUALS"
    | "NOT_EQUALS"
    | "IN"
    | "GREATER_THAN"
    | "GREATER_THAN_OR_EQUAL"
    | "LESS_THAN"
    | "LESS_THAN_OR_EQUAL";
  value: string | number | boolean | Array<string | number | boolean>;
  effect: "ALLOW" | "DENY";
}

export interface PolicyRulesDto {
  defaultEffect: "ALLOW" | "DENY";
  conditions: PolicyRuleCondition[];
}

export interface PolicyToggleDto {
  key: string;
  label: string;
  detail: string;
  enabled: boolean;
  /** Locked toggles are non-negotiable or Owner-only; refused server-side too. */
  locked: boolean;
  /** Which policy version this toggle reads from — and writes to. */
  policyId: string;
  /**
   * The leaf inside `rules` the toggle flips: "__default" for defaultEffect,
   * "__condition:{index}" for a binary condition's effect.
   */
  ruleKey: string;
  /** The policy's full rules, echoed back so a PATCH supersedes them intact. */
  rules: PolicyRulesDto;
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
