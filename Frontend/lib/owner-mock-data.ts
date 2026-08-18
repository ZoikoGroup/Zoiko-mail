import type { Mailbox } from "./owner-api";

// ─── Summary Stats ────────────────────────────────────────────────────────────

export const mockSummaryStats = {
  totalUsers: 24,
  activeUsers: 21,
  totalMailboxes: 31,
  activeDomains: 2,
  connectedAccounts: 8,
  pendingInvitations: 3,
  storageUsedGb: 42.7,
  storageLimitGb: 100,
  securityAlerts: 2,
};

// ─── Recent Activity ──────────────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  type: "user_invited" | "mailbox_created" | "domain_verified" | "role_changed" | "connected_account_added" | "policy_updated" | "user_joined" | "security_event";
  actor: string;
  target: string;
  description: string;
  timestamp: string;
}

export const mockRecentActivity: ActivityItem[] = [
  {
    id: "a1",
    type: "user_invited",
    actor: "Sarah Chen",
    target: "dev@zoiko.dev",
    description: "Invited dev@zoiko.dev as Member",
    timestamp: "2026-08-18T09:32:00Z",
  },
  {
    id: "a2",
    type: "mailbox_created",
    actor: "Admin",
    target: "support@zoiko.dev",
    description: "Created mailbox support@zoiko.dev",
    timestamp: "2026-08-18T08:15:00Z",
  },
  {
    id: "a3",
    type: "domain_verified",
    actor: "System",
    target: "zoiko.dev",
    description: "Domain zoiko.dev DNS verification passed",
    timestamp: "2026-08-17T16:42:00Z",
  },
  {
    id: "a4",
    type: "role_changed",
    actor: "Alex Morgan",
    target: "Jamie Lee",
    description: "Changed Jamie Lee role from Member to Admin",
    timestamp: "2026-08-17T14:10:00Z",
  },
  {
    id: "a5",
    type: "connected_account_added",
    actor: "Jordan Patel",
    target: "Gmail",
    description: "Connected Gmail account jordan@zoiko.dev",
    timestamp: "2026-08-17T11:05:00Z",
  },
  {
    id: "a6",
    type: "policy_updated",
    actor: "Admin",
    target: "AI Drafting Policy",
    description: "Updated AI Drafting Policy rate limits",
    timestamp: "2026-08-16T15:30:00Z",
  },
  {
    id: "a7",
    type: "user_joined",
    actor: "Taylor Kim",
    target: "Account",
    description: "Taylor Kim accepted invitation and joined",
    timestamp: "2026-08-16T10:20:00Z",
  },
  {
    id: "a8",
    type: "security_event",
    actor: "System",
    target: "Login Attempt",
    description: "Failed login attempt from unknown IP blocked",
    timestamp: "2026-08-16T03:45:00Z",
  },
];

// ─── Organization Health ──────────────────────────────────────────────────────

export interface HealthItem {
  label: string;
  status: "healthy" | "warning" | "error";
  detail: string;
}

export const mockOrgHealth: HealthItem[] = [
  { label: "Domain Health", status: "healthy", detail: "2/2 domains verified" },
  { label: "Mailbox Status", status: "healthy", detail: "31 active mailboxes" },
  { label: "Provider Connection", status: "warning", detail: "1 connector needs re-auth" },
  { label: "Security Status", status: "warning", detail: "2 unresolved alerts" },
  { label: "Storage Usage", status: "healthy", detail: "42.7 GB / 100 GB used" },
];

// ─── Mailboxes ────────────────────────────────────────────────────────────────

export const mockMailboxes: Mailbox[] = [
  { id: "m1", userId: "u1", displayName: "Alex Morgan", email: "alex@zoiko.dev", type: "PRIMARY", provider: "ZOIKO", status: "ACTIVE", storageUsedMb: 2340, storageLimitMb: 15000, aiEnabled: true, createdAt: "2026-06-01T00:00:00Z" },
  { id: "m2", userId: "u2", displayName: "Sarah Chen", email: "sarah@zoiko.dev", type: "PRIMARY", provider: "ZOIKO", status: "ACTIVE", storageUsedMb: 1890, storageLimitMb: 15000, aiEnabled: true, createdAt: "2026-06-05T00:00:00Z" },
  { id: "m3", userId: "u3", displayName: "Jordan Patel", email: "jordan@zoiko.dev", type: "PRIMARY", provider: "ZOIKO", status: "ACTIVE", storageUsedMb: 4200, storageLimitMb: 15000, aiEnabled: false, createdAt: "2026-06-10T00:00:00Z" },
  { id: "m4", userId: "u4", displayName: "Jamie Lee", email: "jamie@zoiko.dev", type: "PRIMARY", provider: "GMAIL", status: "ACTIVE", storageUsedMb: 890, storageLimitMb: 15000, aiEnabled: true, createdAt: "2026-06-15T00:00:00Z" },
  { id: "m5", userId: "u5", displayName: "Taylor Kim", email: "taylor@zoiko.dev", type: "PRIMARY", provider: "ZOIKO", status: "ACTIVE", storageUsedMb: 560, storageLimitMb: 15000, aiEnabled: true, createdAt: "2026-07-01T00:00:00Z" },
  { id: "m6", userId: "u6", displayName: "Casey Brooks", email: "casey@zoiko.dev", type: "PRIMARY", provider: "MICROSOFT_365", status: "SUSPENDED", storageUsedMb: 320, storageLimitMb: 15000, aiEnabled: false, createdAt: "2026-07-10T00:00:00Z" },
  { id: "m7", userId: "u1", displayName: "Alex Morgan", email: "alex.m@zoiko.dev", type: "ALIAS", provider: "ZOIKO", status: "ACTIVE", storageUsedMb: 0, storageLimitMb: 0, aiEnabled: false, createdAt: "2026-07-15T00:00:00Z" },
  { id: "m8", userId: "u7", displayName: "Support Queue", email: "support@zoiko.dev", type: "SHARED", provider: "ZOIKO", status: "ACTIVE", storageUsedMb: 6780, storageLimitMb: 30000, aiEnabled: true, createdAt: "2026-06-01T00:00:00Z" },
];

// ─── Subscription / Billing ───────────────────────────────────────────────────

export interface SubscriptionPlan {
  name: string;
  code: string;
  status: "active" | "past_due" | "cancelled";
  priceMonthly: number;
  activeUsers: number;
  userLimit: number;
  mailboxesUsed: number;
  mailboxLimit: number;
  storageUsedGb: number;
  storageLimitGb: number;
  renewalDate: string;
  nextBillingDate: string;
}

export const mockSubscription: SubscriptionPlan = {
  name: "Business Pro",
  code: "business_pro",
  status: "active",
  priceMonthly: 249,
  activeUsers: 21,
  userLimit: 50,
  mailboxesUsed: 31,
  mailboxLimit: 75,
  storageUsedGb: 42.7,
  storageLimitGb: 100,
  renewalDate: "2026-09-18T00:00:00Z",
  nextBillingDate: "2026-09-18T00:00:00Z",
};

export interface BillingHistoryItem {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "failed";
  description: string;
}

export const mockBillingHistory: BillingHistoryItem[] = [
  { id: "b1", date: "2026-08-01T00:00:00Z", amount: 249, status: "paid", description: "Business Pro — August 2026" },
  { id: "b2", date: "2026-07-01T00:00:00Z", amount: 249, status: "paid", description: "Business Pro — July 2026" },
  { id: "b3", date: "2026-06-01T00:00:00Z", amount: 199, status: "paid", description: "Business Starter — June 2026" },
  { id: "b4", date: "2026-05-01T00:00:00Z", amount: 199, status: "paid", description: "Business Starter — May 2026" },
];

// ─── Security Alerts ──────────────────────────────────────────────────────────

export interface SecurityAlert {
  id: string;
  type: "suspicious_login" | "failed_auth" | "provider_issue" | "policy_violation" | "rate_limit";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  source: string;
  ipAddress?: string;
  timestamp: string;
  resolved: boolean;
}

export const mockSecurityAlerts: SecurityAlert[] = [
  {
    id: "sa1",
    type: "suspicious_login",
    severity: "critical",
    title: "Suspicious login attempt detected",
    description: "Multiple failed login attempts from an unrecognized IP address in a different geographic region.",
    source: "Auth System",
    ipAddress: "203.0.113.42",
    timestamp: "2026-08-18T02:15:00Z",
    resolved: false,
  },
  {
    id: "sa2",
    type: "failed_auth",
    severity: "warning",
    title: "Repeated authentication failures",
    description: "User casey@zoiko.dev has had 5 failed login attempts in the last hour.",
    source: "Auth System",
    timestamp: "2026-08-17T22:30:00Z",
    resolved: false,
  },
  {
    id: "sa3",
    type: "provider_issue",
    severity: "warning",
    title: "Gmail connector sync issue",
    description: "The Gmail connector for jordan@zoiko.dev has not synced in 12 hours. Re-authentication may be required.",
    source: "Connector Service",
    timestamp: "2026-08-17T18:00:00Z",
    resolved: false,
  },
  {
    id: "sa4",
    type: "rate_limit",
    severity: "info",
    title: "API rate limit approached",
    description: "The workspace has reached 80% of the hourly API rate limit for mail operations.",
    source: "Rate Limiter",
    timestamp: "2026-08-17T14:45:00Z",
    resolved: true,
  },
];

// ─── Export Data ──────────────────────────────────────────────────────────────

export interface ExportRequest {
  id: string;
  type: "organization" | "user" | "mailbox";
  requestedBy: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  completedAt: string | null;
  downloadUrl: string | null;
}

export const mockExportRequests: ExportRequest[] = [
  { id: "e1", type: "organization", requestedBy: "Alex Morgan", status: "completed", createdAt: "2026-08-15T10:00:00Z", completedAt: "2026-08-15T10:32:00Z", downloadUrl: "#" },
  { id: "e2", type: "user", requestedBy: "Sarah Chen", status: "processing", createdAt: "2026-08-18T08:00:00Z", completedAt: null, downloadUrl: null },
];

// ─── Deletion Requests ────────────────────────────────────────────────────────

export interface DeletionRequest {
  id: string;
  type: "user_data" | "mailbox" | "organization";
  requestedBy: string;
  target: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
}

export const mockDeletionRequests: DeletionRequest[] = [
  { id: "d1", type: "user_data", requestedBy: "Casey Brooks", target: "casey@zoiko.dev", status: "completed", createdAt: "2026-08-10T12:00:00Z", completedAt: "2026-08-11T12:00:00Z" },
  { id: "d2", type: "mailbox", requestedBy: "Admin", target: "old-mailbox@zoiko.dev", status: "pending", createdAt: "2026-08-18T09:00:00Z", completedAt: null },
];
