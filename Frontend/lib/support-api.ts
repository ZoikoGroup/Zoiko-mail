import { apiRequest } from "./api-client";
import { getAccessToken, getPlatformToken } from "./auth-storage";

export type SupportScope =
  | "TENANT_DIAGNOSTICS"
  | "DNS_DIAGNOSTICS"
  | "DELIVERY_DIAGNOSTICS"
  | "AUDIT_READ"
  /** Reading inside a mailbox. Asked for by name, approved by name. */
  | "MAIL_CONTENT";

export interface SupportAccessGrant {
  id: string;
  tenantId: string;
  supportMembershipId: string;
  approvedByUserId: string;
  reason: string;
  ticketId: string | null;
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
  /**
   * The case this access is for — Runbook §7 "purpose-bound".
   *
   * Optional here and required by the server unless the reason names an
   * incident, because a P0 can begin before anyone has raised a ticket. An
   * access with neither is refused: what §7 forbids is one nobody can account
   * for afterwards.
   */
  ticketId?: string;
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
// Tenant-scoped support console (SUPPORT/OWNER/ADMIN roles). Uses the
// tenant-scoped access token. All list endpoints are forced to the caller's
// tenant by the backend (session-scoped tenantId).
// ---------------------------------------------------------------------------

export interface TenantMailbox {
  id: string;
  address: string;
  tenantId: string;
  memberName: string | null;
  memberEmail: string | null;
  suspended: boolean;
  suspensionReason: string | null;
  createdAt: string;
  mailboxType: string;
  connectedAccounts: Array<{
    id: string;
    provider: string;
    email: string;
    status: string;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
  }>;
}

export interface TenantDomain {
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
}

export interface TenantProviderEvent {
  id: string;
  providerEventId: string | null;
  tenantId: string;
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
}

export interface TenantDeliveryEvent {
  id: string;
  type: string;
  tenantId: string;
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

export interface TenantJob {
  id: string;
  type: string;
  tenantId: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSuppression {
  id: string;
  tenantId: string;
  emailHash: string;
  reason: string;
  active: boolean;
  sourceEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantAuditEvent {
  id: string;
  eventType: string;
  actor: { id: string; email: string; displayName: string } | null;
  actorRole: string | null;
  tenantId: string;
  resource: string | null;
  reason: string | null;
  result: string | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface TenantOverviewData {
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
  grants: SupportAccessGrant[];
  suppressions: TenantSuppression[];
}

export async function fetchTenantSupportOverview(): Promise<TenantOverviewData> {
  return apiRequest<TenantOverviewData>("/support/tenant");
}

export async function fetchTenantMailboxes(q = "", limit = 50): Promise<{ mailboxes: TenantMailbox[] }> {
  return apiRequest<{ mailboxes: TenantMailbox[] }>(`/support/mailboxes?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export async function fetchTenantDomains(q = "", limit = 50): Promise<{ domains: TenantDomain[] }> {
  return apiRequest<{ domains: TenantDomain[] }>(`/support/domains?q=${encodeURIComponent(q)}&limit=${limit}`);
}

/* ── RBAC §2, the two Support controls that had no screen ─────────────── */

/**
 * How the workspace is configured, as opposed to what it contains.
 *
 * Distinct from the overview: that one counts mailboxes and domains, this
 * one says what the workspace's rules are. Most "why is this happening"
 * questions are answered here, and without it support had to ask the
 * customer to read their own settings screen back over a call.
 */
export interface TenantConfiguration {
  tenant: {
    id: string;
    name: string;
    status: string;
    planCode: string;
    timezone: string | null;
    language: string | null;
    memberLimit: number | null;
    allowedDomains: string[];
    createdAt: string;
    updatedAt: string;
  };
  passwordPolicy: Record<string, unknown> | null;
  aiSettings: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  policies: Array<{
    id: string;
    type: string;
    name: string;
    description: string | null;
    version: number;
    status: string;
    rules: unknown;
    activatedAt: string | null;
    updatedAt: string;
  }>;
  domains: Array<{
    id: string;
    domainName: string;
    verificationStatus: string;
    sendingEnabled: boolean;
    activatedAt: string | null;
  }>;
  mail: {
    mailboxes: number;
    aiRestrictedMailboxes: number;
    sendingSuspendedMailboxes: number;
  };
}

export async function fetchTenantConfiguration(): Promise<TenantConfiguration> {
  return apiRequest<TenantConfiguration>("/support/configuration");
}

/**
 * A page of one mailbox's message headers.
 *
 * Headers only, by design on the server: §7 asks support views to prefer
 * metadata over content, and the endpoint does not return bodies at all.
 * `subject` comes back withheld for a mailbox whose owner has turned
 * processing off (AC-008), so the field can be null or a placeholder even
 * when the message is real.
 */
export interface SupportMailboxMessage {
  id: string;
  folder: string;
  isRead: boolean;
  receivedAt: string;
  subject: string | null;
  from: string | null;
  to: string[];
  status: string;
  attachments: number;
}

export interface SupportMailboxRead {
  mailbox: {
    id: string;
    address: string;
    type: string;
    aiEnabled: boolean;
    sendSuspendedAt: string | null;
    sendSuspensionReason: string | null;
    owner: { email: string; displayName: string } | null;
  };
  // Always null: reading mail is by the SUPPORT membership itself now, not
  // by an expiring grant, so there is no window left to report on.
  grant: null;
  messages: SupportMailboxMessage[];
}

export async function fetchMailboxMessages(
  mailboxId: string,
  params: { folder?: string; q?: string; limit?: number } = {}
): Promise<SupportMailboxRead> {
  const query = new URLSearchParams();
  if (params.folder) query.set("folder", params.folder);
  if (params.q) query.set("q", params.q);
  query.set("limit", String(params.limit ?? 25));
  return apiRequest<SupportMailboxRead>(
    `/support/mailboxes/${mailboxId}/messages?${query.toString()}`
  );
}

export interface TenantListParams {
  provider?: string;
  status?: string;
  type?: string;
  q?: string;
  limit?: number;
}

function tenantListQueryString(params: TenantListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function listTenantProviderEvents(params: TenantListParams = {}): Promise<{ events: TenantProviderEvent[] }> {
  return apiRequest<{ events: TenantProviderEvent[] }>(`/support/provider-events${tenantListQueryString(params)}`);
}

export async function listTenantDeliveryEvents(params: TenantListParams = {}): Promise<{ events: TenantDeliveryEvent[] }> {
  return apiRequest<{ events: TenantDeliveryEvent[] }>(`/support/delivery-events${tenantListQueryString(params)}`);
}

export async function listTenantJobs(params: TenantListParams = {}): Promise<{ jobs: TenantJob[] }> {
  return apiRequest<{ jobs: TenantJob[] }>(`/support/jobs${tenantListQueryString(params)}`);
}

export async function listTenantSuppressions(params: TenantListParams = {}): Promise<{ suppressions: TenantSuppression[] }> {
  return apiRequest<{ suppressions: TenantSuppression[] }>(`/support/suppressions${tenantListQueryString(params)}`);
}

export async function listTenantAudit(params: TenantListParams = {}): Promise<{ events: TenantAuditEvent[] }> {
  return apiRequest<{ events: TenantAuditEvent[] }>(`/support/audit${tenantListQueryString(params)}`);
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
  ticketStats: {
    open: number;
    overdue: number;
    urgent: number;
    byStatus: Record<string, number>;
  };
  recentTickets: Array<{
    id: string;
    ticketNumber: number;
    subject: string;
    tenantId: string;
    tenantName: string;
    category: TicketCategory;
    severity: TicketSeverity;
    status: TicketStatus;
    assignedStaff: { id: string; name: string } | null;
    slaDueAt: string | null;
    slaTarget?: string;
    slaOverdue: boolean;
    updatedAt: string;
  }>;
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
  providerConnection: {
    provider: string;
    status: string;
    lastErrorCode: string | null;
  } | null;
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

export interface PlatformGrant {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  reason: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
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

export function fetchPlatformTenantOverview(tenantId: string): Promise<TenantOverview> {
  return platformRequest<TenantOverview>(`/support/platform/tenants/${encodeURIComponent(tenantId)}`);
}

/**
 * Fleet credential health behind the staff "Tokens" section.
 *
 * Deliberately metadata only: connector tokens live in the secret manager, not
 * here, and never cross this client surface.
 */
export interface PlatformTokenHealth {
  id: string;
  provider: string;
  providerAccountId: string;
  email: string;
  scopes: string[];
  status: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  owner: { id: string; email: string; displayName: string } | null;
  tokenExpiresAt: string | null;
  watchExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  disconnectedAt: string | null;
  reauthRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export function listPlatformTokens(params: PlatformListParams = {}): Promise<{ tokens: PlatformTokenHealth[] }> {
  return platformRequest<{ tokens: PlatformTokenHealth[] }>(`/support/platform/tokens${listQueryString(params)}`);
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

export function listPlatformSuppressions(params: PlatformListParams): Promise<{ suppressions: PlatformSuppression[] }> {
  return platformRequest<{ suppressions: PlatformSuppression[] }>(`/support/platform/suppressions${listQueryString(params)}`);
}

export function listPlatformAudit(params: PlatformListParams): Promise<{ events: PlatformAuditEvent[] }> {
  return platformRequest<{ events: PlatformAuditEvent[] }>(`/support/platform/audit${listQueryString(params)}`);
}

export type PlatformJobType =
  | "DATA_EXPORT"
  | "DATA_DELETION"
  | "NOTIFICATION_DIGEST"
  | "IMAP_SYNC"
  | "SMTP_SEND"
  | "AI_EXTRACTION"
  | "AI_DRAFT_GENERATION";

export type PlatformJobStatus = "PENDING" | "RUNNING" | "RETRY" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface PlatformJob {
  id: string;
  type: PlatformJobType;
  tenantId: string;
  tenantName: string | null;
  status: PlatformJobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string | null;
  lockedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  resource: string | null;
}

export function listPlatformJobs(params: PlatformListParams): Promise<{ jobs: PlatformJob[] }> {
  return platformRequest<{ jobs: PlatformJob[] }>(`/support/platform/jobs${listQueryString(params)}`);
}

export function retryPlatformJob(jobId: string): Promise<{ job: PlatformJob }> {
  return platformRequest<{ job: PlatformJob }>(`/support/platform/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Support tickets. Tenant members use the tenant-scoped routes under
// /support/tickets: any ACTIVE member may view the workspace board (plain
// MEMBERs see only their own, SUPPORT/OWNER/ADMIN see the whole workspace).
// Staff use the platform console routes under /support/platform/tickets.
// ---------------------------------------------------------------------------

export type TicketCategory = "DELIVERY" | "DOMAIN" | "BILLING" | "ACCOUNT" | "SECURITY" | "OTHER";
export type TicketSeverity = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_TENANT" | "RESOLVED" | "CLOSED";

export interface TicketAuthor {
  id: string;
  email: string;
  displayName: string;
}

export interface TicketComment {
  id: string;
  authorType: string;
  internal: boolean;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: TicketAuthor | null;
}

export interface SupportTicket {
  id: string;
  ticketNumber: number;
  tenantId: string;
  tenantName: string;
  subject: string;
  description: string;
  category: TicketCategory;
  severity: TicketSeverity;
  status: TicketStatus;
  openedBy: TicketAuthor | null;
  openedByType: string;
  assignedStaff: TicketAuthor | null;
  slaDueAt: string | null;
  /** The response target in the runbook's words — "15 minutes", "4 business hours". */
  slaTarget?: string;
  slaOverdue: boolean;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TicketComment[];
}

export interface TicketListParams {
  tenantId?: string;
  status?: TicketStatus;
  severity?: TicketSeverity;
  assigned?: "me" | "unassigned" | "all";
  overdue?: boolean;
  q?: string;
  limit?: number;
}

export interface CreateTicketInput {
  subject: string;
  description: string;
  category: TicketCategory;
  severity: TicketSeverity;
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  severity?: TicketSeverity;
  assignedStaffId?: string | null;
}

export function listPlatformTickets(params: TicketListParams = {}): Promise<{ tickets: SupportTicket[] }> {
  return platformRequest<{ tickets: SupportTicket[] }>(`/support/platform/tickets${listQueryString(params)}`);
}

export function getPlatformTicket(ticketId: string): Promise<SupportTicket> {
  return platformRequest<SupportTicket>(`/support/platform/tickets/${encodeURIComponent(ticketId)}`);
}

export function createPlatformTicket(input: CreateTicketInput & { tenantId: string; assignedStaffId?: string | null }): Promise<SupportTicket> {
  return platformRequest<SupportTicket>("/support/platform/tickets", { method: "POST", body: input });
}

export function updatePlatformTicket(ticketId: string, input: UpdateTicketInput): Promise<SupportTicket> {
  return platformRequest<SupportTicket>(`/support/platform/tickets/${encodeURIComponent(ticketId)}`, { method: "PATCH", body: input });
}

export function commentPlatformTicket(ticketId: string, body: string, internal: boolean): Promise<TicketComment> {
  return platformRequest<TicketComment>(`/support/platform/tickets/${encodeURIComponent(ticketId)}/comments`, {
    method: "POST",
    body: { body, internal },
  });
}

export function listPlatformStaff(): Promise<{ staff: TicketAuthor[] }> {
  return platformRequest<{ staff: TicketAuthor[] }>("/support/platform/tickets/staff");
}

/* ─── asking this workspace for access — Runbook §7 ─────────────────────── */

export interface RequestAccessInput {
  reason: string;
  ticketId?: string;
  scopes: SupportScope[];
  requestedMinutes: number;
}

/**
 * The one support call that needs no grant, because it is how the first grant
 * comes to exist. Everything else on the tenant console is gated on
 * `support.console.read`, which is GRANT for a Support seat.
 */
export async function requestSupportAccess(input: RequestAccessInput): Promise<{ id: string; status: string }> {
  return apiRequest<{ id: string; status: string }>("/support/access-requests", {
    method: "POST",
    body: input,
  });
}

// ---------------------------------------------------------------------------
// Tenant-scoped tickets (own workspace). These use the tenant access token.
// ---------------------------------------------------------------------------

export interface TenantTicketListParams {
  status?: TicketStatus;
  q?: string;
  limit?: number;
}

function tenantTicketListQueryString(params: TenantTicketListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function listTenantTickets(
  params: TenantTicketListParams = {}
): Promise<{ tickets: SupportTicket[]; ticketCounts: Record<string, number> }> {
  return apiRequest<{ tickets: SupportTicket[]; ticketCounts: Record<string, number> }>(
    `/support/tickets${tenantTicketListQueryString(params)}`
  );
}

export function getTenantTicket(ticketId: string): Promise<SupportTicket> {
  return apiRequest<SupportTicket>(`/support/tickets/${encodeURIComponent(ticketId)}`);
}

export function createTenantTicket(input: CreateTicketInput): Promise<SupportTicket> {
  return apiRequest<SupportTicket>("/support/tickets", { method: "POST", body: input });
}

export function commentTenantTicket(ticketId: string, body: string): Promise<TicketComment> {
  return apiRequest<TicketComment>(`/support/tickets/${encodeURIComponent(ticketId)}/comments`, {
    method: "POST",
    body: { body },
  });
}
