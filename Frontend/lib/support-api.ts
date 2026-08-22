import { apiRequest } from "./api-client";
import { getAccessToken, getPlatformToken } from "./auth-storage";

export type SupportScope =
  | "TENANT_DIAGNOSTICS"
  | "DNS_DIAGNOSTICS"
  | "DELIVERY_DIAGNOSTICS"
  | "AUDIT_READ";

export interface SupportAccessGrant {
  id: string;
  tenantId: string;
  supportMembershipId: string;
  approvedByUserId: string;
  reason: string;
  scopes: SupportScope[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  supportMembership?: {
    id: string;
    user: { id: string; email: string; displayName: string };
  };
  approvedBy?: {
    id: string;
    email: string;
    displayName: string;
  };
}

export interface SupportDiagnosticsData {
  grant: {
    id: string;
    reason: string;
    scopes: SupportScope[];
    expiresAt: string;
  };
  tenant?: {
    id: string;
    name: string;
    status: string;
    planCode: string;
    createdAt: string;
    activeMembers: number;
    mailboxes: number;
  };
  domains?: Array<{
    id: string;
    domainName: string;
    verificationStatus: string;
    mxStatus: string;
    spfStatus: string;
    dkimStatus: string;
    dmarcStatus: string;
    lastCheckedAt: string | null;
  }>;
  delivery?: Array<{
    type: string;
    _count: number;
  }>;
  audit?: Array<{
    id: string;
    eventType: string;
    targetType: string | null;
    targetId: string | null;
    createdAt: string;
  }>;
}

export interface CreateSupportGrantInput {
  supportMembershipId: string;
  reason: string;
  expiresInMinutes: number;
  scopes: SupportScope[];
}

export interface SupportMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  userStatus: string;
  lastLoginAt: string | null;
  joinedAt: string;
  mailboxes: string[];
}

export interface SupportIssue {
  id: string;
  kind: "message" | "delivery" | "job";
  subject: string;
  customer: string;
  mailbox: string | null;
  category: string;
  priority: string;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: string;
}

export interface SupportOverview {
  stats: {
    tenantId: string;
    members: number;
    mailboxes: number;
    domains: number;
    activeGrants: number;
    openCommitments: number;
    issues: number;
    failedMessages24h: number;
    failedDeliveries24h: number;
    retryJobs: number;
    failedJobs: number;
    deliveryEvents24h: number;
  };
  domains: SupportDiagnosticsData["domains"];
  members: SupportMember[];
  team: SupportTeamMember[];
  issues: SupportIssue[];
  audit: Array<{
    id: string;
    eventType: string;
    targetType: string | null;
    targetId: string | null;
    actor: { id: string; email: string; displayName: string } | null;
    createdAt: string;
  }>;
  grants: SupportAccessGrant[];
}

export async function fetchSupportOverview(): Promise<SupportOverview> {
  return apiRequest<SupportOverview>("/support/overview");
}

export async function fetchSupportDiagnostics(grantId: string): Promise<SupportDiagnosticsData> {
  return apiRequest<SupportDiagnosticsData>("/support/diagnostics", {
    headers: {
      "x-support-grant-id": grantId,
    },
  });
}

export async function fetchSupportAccessGrants(): Promise<{ grants: SupportAccessGrant[] }> {
  return apiRequest<{ grants: SupportAccessGrant[] }>("/support/access-grants");
}

export async function createSupportAccessGrant(input: CreateSupportGrantInput): Promise<SupportAccessGrant> {
  return apiRequest<SupportAccessGrant>("/support/access-grants", {
    method: "POST",
    body: input,
  });
}

export async function revokeSupportAccessGrant(grantId: string): Promise<SupportAccessGrant> {
  return apiRequest<SupportAccessGrant>(`/support/access-grants/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Platform support console (staff). Sends the platform token when present,
// otherwise falls back to the tenant-scoped access token — the backend's
// authenticateStaff accepts either.
// ---------------------------------------------------------------------------

function staffToken(): string | null {
  return getPlatformToken() ?? getAccessToken();
}

function platformRequest<T>(path: string, opts: Parameters<typeof apiRequest>[1] = {}): Promise<T> {
  return apiRequest<T>(path, { ...opts, accessToken: staffToken() });
}

export interface PlatformOverview {
  stats: {
    activeTenants: number;
    tenantMembers: number;
    activeMailboxes: number;
    configuredDomains: number;
    providerAccounts: number;
    failedSends24h: number;
    syncFailures24h: number;
    failedJobs: number;
    retryJobs: number;
  };
  providerHealth: {
    byProvider: Array<{ provider: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
    matrix: Array<{ provider: string; status: string; count: number }>;
  };
  issues: PlatformIssue[];
}

export interface PlatformIssue {
  id: string;
  kind: string;
  tenantId: string;
  tenantName: string;
  resourceType: string;
  resource: string;
  status: string;
  error: string | null;
  providerEventId: string | null;
  createdAt: string;
}

export interface PlatformTenant {
  id: string;
  name: string;
  status: string;
  planCode: string;
  createdAt: string;
  members: number;
  mailboxes: number;
  domains: number;
  connectedAccounts: number;
}

export interface PlatformProviderEvent {
  id: string;
  providerEventId: string | null;
  tenantId: string;
  tenantName: string;
  provider: string;
  accountEmail: string;
  accountStatus: string;
  eventType: string;
  processingStatus: string;
  errorCode: string | null;
  attempts: number;
  maxAttempts: number;
  receivedAt: string;
  processedAt: string | null;
  payload: unknown;
}

export interface PlatformDeliveryEvent {
  id: string;
  type: string;
  tenantId: string;
  tenantName: string;
  failureCode: string | null;
  failureReason: string | null;
  providerEventId: string | null;
  createdAt: string;
  message: {
    subject: string | null;
    fromAddress: string | null;
    fromName: string | null;
    providerMessageId: string | null;
    status: string;
    createdAt: string;
    recipients: Array<{ email: string; type: string; deliveryStatus: string }>;
  } | null;
}

export interface PlatformJob {
  id: string;
  type: string;
  tenantId: string;
  tenantName: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  resource: string | null;
}

export interface PlatformSuppression {
  id: string;
  tenantId: string;
  tenantName: string;
  emailHash: string;
  reason: string;
  active: boolean;
  sourceEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformAuditEvent {
  id: string;
  eventType: string;
  actor: { id: string; email: string; displayName: string } | null;
  actorRole: string | null;
  tenantId: string;
  tenantName: string;
  resource: string | null;
  reason: string | null;
  result: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface PlatformMailbox {
  id: string;
  address: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  memberName: string;
  memberEmail: string;
  suspended: boolean;
  suspensionReason: string | null;
  createdAt: string;
  connectedAccounts: Array<{
    id: string;
    provider: string;
    email: string;
    status: string;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
  }>;
}

export interface PlatformDomain {
  id: string;
  domainName: string;
  verificationStatus: string;
  mxStatus: string;
  spfStatus: string;
  dkimStatus: string;
  dmarcStatus: string;
  lastCheckedAt: string | null;
  sendingEnabled: boolean;
  activatedAt: string | null;
  tenant: { id: string; name: string };
}

export interface PlatformDomainDetail {
  domain: {
    id: string;
    domainName: string;
    type: string | null;
    verificationToken: string | null;
    verificationStatus: string;
    mxStatus: string;
    spfStatus: string;
    dkimStatus: string;
    dmarcStatus: string;
    firstCheckedAt: string | null;
    lastCheckedAt: string | null;
    errorDetails: string | null;
    sendingEnabled: boolean;
    activatedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  checks: Array<{
    id: string;
    verificationStatus: string;
    mxStatus: string;
    spfStatus: string;
    dkimStatus: string;
    dmarcStatus: string;
    errorDetails: unknown;
    checkedAt: string;
  }>;
}

export interface PlatformMailboxDetail {
  mailbox: {
    id: string;
    address: string;
    tenantId: string;
    sendSuspendedAt: string | null;
    sendSuspensionReason: string | null;
    createdAt: string;
    updatedAt: string;
    member: { id: string; email: string; displayName: string; status: string; lastLoginAt: string | null } | null;
    connectedAccounts: Array<{
      id: string;
      provider: string;
      email: string;
      status: string;
      lastSyncedAt: string | null;
      lastErrorCode: string | null;
      createdAt: string;
      watchExpiresAt: string | null;
    }>;
  };
  syncJobs: Array<Record<string, unknown>>;
  providerEvents: Array<Record<string, unknown>>;
  deliveryEvents: Array<Record<string, unknown>>;
}

export interface PlatformGrant extends SupportAccessGrant {
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  supportMember: { id: string; email: string; displayName: string } | null;
}

export interface TenantOverview {
  tenant: {
    id: string;
    name: string;
    status: string;
    planCode: string;
    timezone: string | null;
    createdAt: string;
    updatedAt: string;
    _count: Record<string, number>;
  };
  members: Array<Record<string, unknown>>;
  mailboxes: Array<Record<string, unknown>>;
  domains: Array<Record<string, unknown>>;
  connectedAccounts: Array<Record<string, unknown>>;
  providerEvents: Array<Record<string, unknown>>;
  deliveryEvents: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  grants: PlatformGrant[];
  suppressions: PlatformSuppression[];
}

export interface PlatformListParams {
  tenantId?: string;
  provider?: string;
  status?: string;
  type?: string;
  result?: string;
  q?: string;
  limit?: number;
}

function listQueryString(params: PlatformListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function fetchPlatformOverview(): Promise<PlatformOverview> {
  return platformRequest<PlatformOverview>("/support/platform/overview");
}

export function searchPlatformTenants(q = "", limit = 50): Promise<{ tenants: PlatformTenant[] }> {
  return platformRequest<{ tenants: PlatformTenant[] }>(`/support/platform/tenants${listQueryString({ q, limit })}`);
}

export function fetchTenantOverview(tenantId: string): Promise<TenantOverview> {
  return platformRequest<TenantOverview>(`/support/platform/tenants/${encodeURIComponent(tenantId)}`);
}

export function searchPlatformMailboxes(q = "", limit = 50): Promise<{ mailboxes: PlatformMailbox[] }> {
  return platformRequest<{ mailboxes: PlatformMailbox[] }>(`/support/platform/mailboxes${listQueryString({ q, limit })}`);
}

export function searchPlatformDomains(q = "", limit = 50): Promise<{ domains: PlatformDomain[] }> {
  return platformRequest<{ domains: PlatformDomain[] }>(`/support/platform/domains${listQueryString({ q, limit })}`);
}

export function fetchPlatformDomainDetail(tenantId: string, domainId: string): Promise<PlatformDomainDetail> {
  return platformRequest<PlatformDomainDetail>(
    `/support/platform/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(domainId)}`,
  );
}

export function fetchPlatformMailboxDetail(tenantId: string, mailboxId: string): Promise<PlatformMailboxDetail> {
  return platformRequest<PlatformMailboxDetail>(
    `/support/platform/tenants/${encodeURIComponent(tenantId)}/mailboxes/${encodeURIComponent(mailboxId)}`,
  );
}

export function listPlatformProviderEvents(params: PlatformListParams): Promise<{ events: PlatformProviderEvent[] }> {
  return platformRequest<{ events: PlatformProviderEvent[] }>(`/support/platform/provider-events${listQueryString(params)}`);
}

export function listPlatformDeliveryEvents(params: PlatformListParams): Promise<{ events: PlatformDeliveryEvent[] }> {
  return platformRequest<{ events: PlatformDeliveryEvent[] }>(`/support/platform/delivery-events${listQueryString(params)}`);
}

export function listPlatformJobs(params: PlatformListParams): Promise<{ jobs: PlatformJob[] }> {
  return platformRequest<{ jobs: PlatformJob[] }>(`/support/platform/jobs${listQueryString(params)}`);
}

export function listPlatformSuppressions(params: PlatformListParams): Promise<{ suppressions: PlatformSuppression[] }> {
  return platformRequest<{ suppressions: PlatformSuppression[] }>(`/support/platform/suppressions${listQueryString(params)}`);
}

export function listPlatformAudit(params: PlatformListParams): Promise<{ events: PlatformAuditEvent[] }> {
  return platformRequest<{ events: PlatformAuditEvent[] }>(`/support/platform/audit${listQueryString(params)}`);
}

export function listPlatformGrants(): Promise<{ grants: PlatformGrant[] }> {
  return platformRequest<{ grants: PlatformGrant[] }>("/support/platform/grants");
}

export function revokePlatformGrant(grantId: string): Promise<PlatformGrant> {
  return platformRequest<PlatformGrant>(`/support/platform/grants/${encodeURIComponent(grantId)}`, { method: "DELETE" });
}

export function fetchPlatformDiagnostics(grantId: string): Promise<SupportDiagnosticsData> {
  return platformRequest<SupportDiagnosticsData>(`/support/platform/diagnostics?grantId=${encodeURIComponent(grantId)}`);
}
