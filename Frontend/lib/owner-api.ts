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
  return apiRequest<Member[]>("/membership/members");
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

export async function getDomains(): Promise<Domain[]> {
  return apiRequest<Domain[]>("/domains/");
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
  return apiRequest<DomainCheck[]>(`/domains/${domainId}/checks`);
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
  return apiRequest(`/audit/events?${params.toString()}`);
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
  return apiRequest<Policy[]>("/policies/");
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
  return apiRequest<Connector[]>("/connectors/");
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
  return apiRequest<ConnectorHealth[]>("/connectors/health");
}

// ─── Mail (admin) ─────────────────────────────────────────────────────────────

export interface Mailbox {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  type: "PRIMARY" | "ALIAS" | "SHARED";
  provider: "ZOIKO" | "GMAIL" | "MICROSOFT_365";
  status: "ACTIVE" | "SUSPENDED";
  storageUsedMb: number;
  storageLimitMb: number;
  aiEnabled: boolean;
  createdAt: string;
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
