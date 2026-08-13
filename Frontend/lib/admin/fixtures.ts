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
