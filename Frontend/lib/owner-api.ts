import { apiRequest } from "./api-client";

// ─── Membership / Users ───────────────────────────────────────────────────────

export interface Member {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  joinedAt: string;
  lastActiveAt: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
}

export async function getMembers(): Promise<Member[]> {
  const res = await apiRequest<{ members: Array<{
    id: string; tenantId: string; userId: string;
    role: Member["role"]; status: Member["status"];
    createdAt: string; updatedAt: string;
    user: { id: string; email: string; displayName: string; status: string };
  }> }>("/membership/members");
  return res.members.map((m) => ({
    id: m.id,
    userId: m.userId,
    displayName: m.user.displayName,
    email: m.user.email,
    role: m.role,
    status: m.status,
    joinedAt: m.createdAt,
    lastActiveAt: null,
  }));
}

export interface InviteMemberInput {
  email: string;
  role: "ADMIN" | "MEMBER";
}

export async function inviteMember(input: InviteMemberInput): Promise<Invitation> {
  return apiRequest<Invitation>("/membership/invitations", {
    method: "POST",
    body: input,
  });
}

export async function cancelInvitation(membershipId: string): Promise<void> {
  await apiRequest(`/membership/invitations/${membershipId}`, { method: "DELETE" });
}

export async function acceptInvitation(invitationToken: string): Promise<{ id: string; role: string; status: string }> {
  return apiRequest("/membership/invitations/accept", {
    method: "POST",
    body: { invitationToken },
  });
}

export async function acceptInvitationById(membershipId: string): Promise<{ id: string; role: string; status: string }> {
  return apiRequest("/membership/invitations/accept", {
    method: "POST",
    body: { membershipId },
  });
}

export interface UpdateMemberInput {
  role?: "ADMIN" | "MEMBER";
  status?: "ACTIVE" | "SUSPENDED";
}

export async function updateMember(membershipId: string, input: UpdateMemberInput): Promise<Member> {
  return apiRequest<Member>(`/membership/members/${membershipId}`, {
    method: "PATCH",
    body: input,
  });
}

export async function removeMember(membershipId: string): Promise<void> {
  await apiRequest(`/membership/members/${membershipId}`, { method: "DELETE" });
}

// ─── Domains ──────────────────────────────────────────────────────────────────

export interface Domain {
  id: string;
  domain: string;
  verificationStatus: "PENDING" | "VERIFIED" | "FAILED";
  mxStatus: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  spfStatus: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  dkimStatus: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  dmarcStatus: "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  isActive: boolean;
  createdAt: string;
}

type DnsStatus = "PENDING" | "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
const mapDns = (s: string): DnsStatus =>
  s === "VALID" ? "VERIFIED" : s === "INVALID" ? "FAILED" : s === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "PENDING";

export async function getDomains(): Promise<Domain[]> {
  const res = await apiRequest<{ domains: Array<{
    id: string; domainName: string; verificationStatus: string;
    mxStatus: string; spfStatus: string; dkimStatus: string; dmarcStatus: string;
    sendingEnabled: boolean; createdAt: string;
  }> }>("/domains/");
  return res.domains.map((d) => ({
    id: d.id,
    domain: d.domainName,
    verificationStatus: d.verificationStatus as Domain["verificationStatus"],
    mxStatus: mapDns(d.mxStatus),
    spfStatus: mapDns(d.spfStatus),
    dkimStatus: mapDns(d.dkimStatus),
    dmarcStatus: mapDns(d.dmarcStatus),
    isActive: d.sendingEnabled,
    createdAt: d.createdAt,
  }));
}

export interface AddDomainInput {
  domain: string;
}

export async function addDomain(input: AddDomainInput): Promise<Domain> {
  return apiRequest<Domain>("/domains/", {
    method: "POST",
    body: input,
  });
}

export async function runDiagnostics(domainId: string): Promise<Domain> {
  return apiRequest<Domain>(`/domains/${domainId}/diagnostics`, { method: "POST" });
}

export interface DomainCheck {
  type: string;
  status: string;
  records: Record<string, unknown>[];
}

export async function getDomainChecks(domainId: string): Promise<DomainCheck[]> {
  const res = await apiRequest<{ checks: DomainCheck[] }>(`/domains/${domainId}/checks`);
  return res.checks;
}

export async function activateDomain(domainId: string): Promise<Domain> {
  return apiRequest<Domain>(`/domains/${domainId}/activate`, { method: "POST" });
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  ipAddress: string;
  status: "SUCCESS" | "FAILURE";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventQuery {
  page?: number;
  limit?: number;
  action?: string;
  actorId?: string;
  startDate?: string;
  endDate?: string;
}

export async function getAuditEvents(query: AuditEventQuery = {}): Promise<{ events: AuditEvent[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  });
  const res = await apiRequest<{
    events: Array<{
      id: string; actorUserId: string; eventType: string; targetType: string;
      targetId: string; ipAddress: string | null; metadata: Record<string, unknown>;
      createdAt: string;
      actor: { id: string; email: string; displayName: string } | null;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(`/audit/events?${params.toString()}`);
  return {
    events: res.events.map((e) => ({
      id: e.id,
      actorId: e.actorUserId,
      actorName: e.actor?.displayName ?? "System",
      actorEmail: e.actor?.email ?? "",
      action: e.eventType,
      targetType: e.targetType,
      targetId: e.targetId,
      targetName: String(e.metadata?.targetName ?? e.targetId),
      ipAddress: e.ipAddress ?? "",
      status: "SUCCESS" as const,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
    total: res.pagination.total,
    page: res.pagination.page,
    limit: res.pagination.limit,
  };
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export interface Policy {
  id: string;
  name: string;
  description: string;
  category: "AI_FEATURES" | "SENDING" | "RATE_LIMITS" | "DATA_HANDLING" | "SECURITY";
  isEnabled: boolean;
  config: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export async function getPolicies(): Promise<Policy[]> {
  const res = await apiRequest<{ policies: Array<{
    id: string; name: string; description: string | null;
    type: string; status: string; rules: Record<string, unknown>;
    createdByUserId: string; createdAt: string; updatedAt: string;
  }> }>("/policies/");
  return res.policies.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    category: p.type as Policy["category"],
    isEnabled: p.status === "ACTIVE",
    config: p.rules,
    createdBy: p.createdByUserId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

export interface CreatePolicyInput {
  name: string;
  description: string;
  category: Policy["category"];
  config: Record<string, unknown>;
}

export async function createPolicy(input: CreatePolicyInput): Promise<Policy> {
  return apiRequest<Policy>("/policies/", {
    method: "POST",
    body: input,
  });
}

export async function activatePolicy(policyId: string): Promise<Policy> {
  return apiRequest<Policy>(`/policies/${policyId}/activate`, { method: "POST" });
}

// ─── Tenant ───────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  planCode: string;
  createdAt: string;
}

export async function getCurrentTenant(): Promise<Tenant> {
  return apiRequest<Tenant>("/tenants/current");
}

export interface UpdateTenantInput {
  name?: string;
}

export async function updateTenant(input: UpdateTenantInput): Promise<Tenant> {
  return apiRequest<Tenant>("/tenants/current", {
    method: "PATCH",
    body: input,
  });
}

// ─── Onboarding ─────────────────────────────────────────────────────────────

export interface OnboardingSteps {
  workspaceCreated: boolean;
  domainAdded: boolean;
  domainVerified: boolean;
  mailboxCreated: boolean;
  providerConnected: boolean;
  teamInvited: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingSteps;
  completedCount: number;
  totalSteps: number;
  isComplete: boolean;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return apiRequest<OnboardingStatus>("/tenants/onboarding-status");
}

// ─── Usage ───────────────────────────────────────────────────────────────

export interface UsageStorage {
  used: number;
  limit: number;
  mailboxes: Array<{ address: string; used: number; limit: number }>;
}

export interface UsageEmails {
  sent: number;
  received: number;
  failed: number;
  draft: number;
}

export interface UsageConnectedAccounts {
  total: number;
  active: number;
  providers: Record<string, number>;
}

export interface UsageData {
  period: { days: number; since: string };
  storage: UsageStorage;
  mailboxes: { count: number };
  emails: UsageEmails;
  emailVolume: Array<{ date: string; count: number }>;
  apiUsage: Array<{ date: string; count: number }>;
  activeMembers: number;
  totalDomains: number;
  connectedAccounts: UsageConnectedAccounts;
}

export async function getUsage(days: number = 30): Promise<UsageData> {
  return apiRequest<UsageData>(`/tenants/usage?days=${days}`);
}

// ─── Connectors ───────────────────────────────────────────────────────────────

export interface Connector {
  id: string;
  provider: "GMAIL" | "MICROSOFT_365";
  email: string;
  displayName: string;
  status: "ACTIVE" | "DISCONNECTED" | "ERROR";
  syncStatus: "IDLE" | "SYNCING" | "FAILED";
  lastSyncAt: string | null;
  connectedAt: string;
}

export async function getConnectors(): Promise<Connector[]> {
  const res = await apiRequest<{ accounts: Array<{
    id: string; provider: string; email: string;
    status: string; lastSyncedAt: string | null; createdAt: string;
  }> }>("/connectors/");
  return res.accounts.map((a) => ({
    id: a.id,
    provider: a.provider as Connector["provider"],
    email: a.email,
    displayName: a.email,
    status: a.status === "ACTIVE" ? "ACTIVE" as const
      : a.status === "DISCONNECTED" ? "DISCONNECTED" as const
      : "ERROR" as const,
    syncStatus: a.status === "ACTIVE" ? "IDLE" as const
      : a.status === "REAUTH_REQUIRED" || a.status === "DEGRADED" ? "FAILED" as const
      : "IDLE" as const,
    lastSyncAt: a.lastSyncedAt,
    connectedAt: a.createdAt,
  }));
}

export async function deleteConnector(accountId: string): Promise<void> {
  await apiRequest(`/connectors/${accountId}`, { method: "DELETE" });
}

export interface ConnectorHealth {
  provider: string;
  healthy: boolean;
  lastCheck: string;
}

export async function getConnectorHealth(): Promise<ConnectorHealth[]> {
  const res = await apiRequest<{ accounts: Array<{ provider: string; status: string; count: number }>; events: Array<{ provider: string; status: string; count: number }> }>("/connectors/health");
  return res.accounts.map((a) => ({
    provider: a.provider,
    healthy: a.status === "ACTIVE",
    lastCheck: new Date().toISOString(),
  }));
}

// ─── Mail (admin) ─────────────────────────────────────────────────────────────

export interface Mailbox {
  id: string;
  address: string;
  displayName: string;
  userId: string;
  storageUsedMb: number;
  storageLimitMb: number;
  sendSuspendedAt: string | null;
  createdAt: string;
}

export async function getAdminMailboxes(): Promise<Mailbox[]> {
  const res = await apiRequest<Array<{
    id: string; address: string; storageUsed: number; storageLimit: number;
    sendSuspendedAt: string | null; createdAt: string;
    membership: { user: { displayName: string }; userId: string };
  }>>("/mail/admin/mailboxes");
  return res.map((m) => ({
    id: m.id,
    address: m.address,
    displayName: m.membership?.user?.displayName ?? m.address,
    userId: m.membership?.userId ?? "",
    storageUsedMb: Math.round(m.storageUsed / 1024),
    storageLimitMb: Math.round(m.storageLimit / 1024),
    sendSuspendedAt: m.sendSuspendedAt,
    createdAt: m.createdAt,
  }));
}

export async function createAdminMailbox(membershipId: string): Promise<Mailbox> {
  const m = await apiRequest<{
    id: string; address: string; storageUsed: number; storageLimit: number;
    sendSuspendedAt: string | null; createdAt: string;
    membership: { user: { displayName: string }; userId: string };
  }>("/mail/admin/mailboxes", {
    method: "POST",
    body: { membershipId },
  });
  return {
    id: m.id,
    address: m.address,
    displayName: m.membership?.user?.displayName ?? m.address,
    userId: m.membership?.userId ?? "",
    storageUsedMb: Math.round(m.storageUsed / 1024),
    storageLimitMb: Math.round(m.storageLimit / 1024),
    sendSuspendedAt: m.sendSuspendedAt,
    createdAt: m.createdAt,
  };
}

export async function deleteAdminMailbox(mailboxId: string): Promise<void> {
  await apiRequest(`/mail/admin/mailboxes/${mailboxId}`, { method: "DELETE" });
}

export async function updateMailboxSendingStatus(
  mailboxId: string,
  data: { sendingEnabled: boolean }
): Promise<void> {
  await apiRequest(`/mail/admin/mailboxes/${mailboxId}/sending`, {
    method: "PATCH",
    body: data,
  });
}

// ─── Lifecycle (exports & deletions) ──────────────────────────────────────────

export interface LifecycleRequest {
  id: string;
  type: "EXPORT" | "DELETION";
  status: string;
  reason: string | null;
  createdAt: string;
  job: { id: string; status: string; result: Record<string, unknown> | null } | null;
}

export async function getLifecycleRequests(): Promise<LifecycleRequest[]> {
  const res = await apiRequest<{ requests: LifecycleRequest[] }>("/lifecycle/");
  return res.requests;
}

export interface RequestExportInput {
  idempotencyKey: string;
  reason?: string;
}

export async function requestDataExport(input: RequestExportInput): Promise<void> {
  await apiRequest("/lifecycle/exports", { method: "POST", body: input });
}

export interface RequestDeletionInput {
  idempotencyKey: string;
  reason?: string;
}

export async function requestDeletion(input: RequestDeletionInput): Promise<void> {
  await apiRequest("/lifecycle/deletions", { method: "POST", body: input });
}

export async function cancelLifecycleRequest(requestId: string): Promise<void> {
  await apiRequest(`/lifecycle/${requestId}/cancel`, { method: "POST" });
}

export async function approveDeletion(requestId: string): Promise<void> {
  await apiRequest(`/lifecycle/${requestId}/approve`, { method: "POST" });
}

export async function confirmDeletion(
  requestId: string,
  data: { confirmation: string; tenantName: string }
): Promise<void> {
  await apiRequest(`/lifecycle/${requestId}/confirm-deletion`, { method: "POST", body: data });
}

export async function downloadExport(requestId: string): Promise<Blob> {
  return apiRequest<Blob>(`/lifecycle/exports/${requestId}/download`);
}
