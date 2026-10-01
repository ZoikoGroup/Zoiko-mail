import { apiDownload, apiRequest } from "./api-client";

/**
 * Custom domains and their DNS records — one client for both consoles.
 *
 * The records a customer is asked to publish come from the server, generated
 * per domain. They used to be text in three components, pointing at hosts
 * that did not exist; nothing here hardcodes a record value, so the admin and
 * owner screens cannot disagree with each other or with what the server
 * actually verifies.
 */

export type DomainStatus = "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "DEGRADED" | "FAILED";
export type DnsRecordState = "PENDING" | "VERIFIED" | "MISSING" | "MISMATCH" | "CONFLICT" | "LOOKUP_ERROR";
export type DnsRecordPurpose = "OWNERSHIP" | "MX" | "SPF" | "DKIM" | "DMARC" | "AUTODISCOVER" | "AUTOCONFIG";
export type DnsPublishState = "NOT_APPLICABLE" | "PENDING" | "PUBLISHED" | "FAILED";
export type DnsProviderKind = "MANUAL" | "CLOUDFLARE" | "GODADDY";
export type DmarcPolicy = "NONE" | "QUARANTINE" | "REJECT";
/** The legacy per-record verdicts, still returned for older screens. */
export type LegacyDnsStatus = "PENDING" | "VALID" | "INVALID";

export interface DnsRecord {
  id: string;
  recordKey: string;
  purpose: DnsRecordPurpose;
  type: "TXT" | "MX" | "CNAME";
  /** Relative host, as DNS dashboards want it: "@", "_dmarc". */
  name: string;
  fqdn: string;
  value: string;
  priority: number | null;
  ttl: number;
  required: boolean;
  state: DnsRecordState;
  status: LegacyDnsStatus;
  observed: string[] | null;
  diagnosis: string | null;
  lastErrorCode: string | null;
  lastCheckedAt: string | null;
  lastVerifiedAt: string | null;
  publishState: DnsPublishState;
  publishedAt: string | null;
  publishError: string | null;
}

export interface DkimKeySummary {
  id: string;
  selector: string;
  keyBits: number;
  status: "PENDING" | "ACTIVE" | "RETIRING" | "RETIRED";
  activatedAt: string | null;
  retiringAt: string | null;
  createdAt: string;
}

export interface DomainDetail {
  id: string;
  domainName: string;
  type: "CUSTOM" | "ZOIKO";
  status: DomainStatus;
  verificationToken: string;
  verificationStatus: "PENDING" | "VERIFIED" | "FAILED";
  mxStatus: LegacyDnsStatus;
  spfStatus: LegacyDnsStatus;
  dkimStatus: LegacyDnsStatus;
  dmarcStatus: LegacyDnsStatus;
  sendingEnabled: boolean;
  activatedAt: string | null;
  dnsProvider: DnsProviderKind;
  dnsCredentialId: string | null;
  dnsCredential: { id: string; provider: DnsProviderKind; label: string; status: "ACTIVE" | "INVALID" } | null;
  receivingEnabled: boolean;
  replaceExistingMx: boolean;
  autoActivateSending: boolean;
  dmarcPolicy: DmarcPolicy;
  dmarcReportEmail: string | null;
  configVersion: number;
  firstCheckedAt: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastVerifiedAt: string | null;
  lastPublishedAt: string | null;
  lastSyncError: string | null;
  consecutiveFailures: number;
  graceUntil: string | null;
  verificationDeadlineAt: string | null;
  sendingSuspendedAt: string | null;
  suspensionReason: string | null;
  errorDetails: Record<string, { code: string; message: string }> | null;
  records: DnsRecord[];
  dkimKeys: DkimKeySummary[];
  readiness: { sendReady: boolean; fullyReady: boolean; blocking: DnsRecordPurpose[] };
  createdAt: string;
}

export interface DomainConfigInput {
  dnsProvider?: DnsProviderKind;
  dnsCredentialId?: string | null;
  receivingEnabled?: boolean;
  replaceExistingMx?: boolean;
  autoActivateSending?: boolean;
  dmarcPolicy?: DmarcPolicy;
  dmarcReportEmail?: string | null;
}

export interface DomainCheck {
  id: string;
  checkedAt: string;
  trigger: "CREATED" | "MANUAL" | "SCHEDULED" | "CONFIG_CHANGE" | "PUBLISH";
  resultStatus: DomainStatus | null;
  verificationStatus: "PENDING" | "VERIFIED" | "FAILED";
  mxStatus: LegacyDnsStatus;
  spfStatus: LegacyDnsStatus;
  dkimStatus: LegacyDnsStatus;
  dmarcStatus: LegacyDnsStatus;
  durationMs: number | null;
  /** Keyed by record group; values are `{code,message}` (older rows: strings). */
  errorDetails: Record<string, unknown> | null;
}

export interface DnsProviderCredential {
  id: string;
  provider: Exclude<DnsProviderKind, "MANUAL">;
  label: string;
  status: "ACTIVE" | "INVALID";
  settings: { environment?: "PRODUCTION" | "OTE" } | null;
  lastValidatedAt: string | null;
  lastError: string | null;
  createdAt: string;
  _count?: { domains: number };
}

export type ConnectProviderInput =
  | { provider: "CLOUDFLARE"; label: string; apiToken: string }
  | { provider: "GODADDY"; label: string; apiKey: string; apiSecret: string; environment?: "PRODUCTION" | "OTE" };

/**
 * Fills what an API older than this screen leaves out.
 *
 * The frontend and backend deploy separately, and a dev server pointed at a
 * backend that has not been rebuilt is the common case. Without this, one
 * missing array crashed the whole page; with it, the domain still renders and
 * the records section says they are being generated.
 */
export function normalizeDomain(raw: Partial<DomainDetail> & Pick<DomainDetail, "id" | "domainName">): DomainDetail {
  const records = raw.records ?? [];
  return {
    ...raw,
    type: raw.type ?? "CUSTOM",
    status: raw.status ?? (raw.sendingEnabled ? "ACTIVE" : raw.verificationStatus === "VERIFIED" ? "VERIFIED" : "PENDING_VERIFICATION"),
    dnsProvider: raw.dnsProvider ?? "MANUAL",
    dnsCredentialId: raw.dnsCredentialId ?? null,
    dnsCredential: raw.dnsCredential ?? null,
    receivingEnabled: raw.receivingEnabled ?? true,
    replaceExistingMx: raw.replaceExistingMx ?? false,
    autoActivateSending: raw.autoActivateSending ?? true,
    dmarcPolicy: raw.dmarcPolicy ?? "NONE",
    dmarcReportEmail: raw.dmarcReportEmail ?? null,
    consecutiveFailures: raw.consecutiveFailures ?? 0,
    graceUntil: raw.graceUntil ?? null,
    nextCheckAt: raw.nextCheckAt ?? null,
    lastSyncError: raw.lastSyncError ?? null,
    suspensionReason: raw.suspensionReason ?? null,
    records,
    dkimKeys: raw.dkimKeys ?? [],
    readiness: raw.readiness ?? { sendReady: false, fullyReady: false, blocking: [] },
  } as DomainDetail;
}

/** Every page of the domain list; a workspace rarely has more than one. */
export async function listDomains(): Promise<DomainDetail[]> {
  const all: DomainDetail[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : "?limit=200";
    const page: { domains: DomainDetail[]; nextCursor: string | null } = await apiRequest(`/domains${query}`);
    all.push(...page.domains.map(normalizeDomain));
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export const getDomain = async (domainId: string) => normalizeDomain(await apiRequest<DomainDetail>(`/domains/${domainId}`));

export const addDomain = (input: { domainName: string } & DomainConfigInput) =>
  apiRequest<DomainDetail>("/domains", { method: "POST", body: input });

export const updateDomain = (domainId: string, input: DomainConfigInput) =>
  apiRequest<DomainDetail>(`/domains/${domainId}`, { method: "PATCH", body: input });

export const recheckDomain = (domainId: string) =>
  apiRequest<DomainDetail>(`/domains/${domainId}/diagnostics`, { method: "POST" });

export const publishDomain = (domainId: string) =>
  apiRequest<DomainDetail & { publishResult: { published: string[]; failed: Array<{ recordKey: string; error: string }> } }>(
    `/domains/${domainId}/publish`, { method: "POST" }
  );

export const rotateDkim = (domainId: string) =>
  apiRequest<DomainDetail>(`/domains/${domainId}/dkim/rotate`, { method: "POST" });

export const activateDomain = (domainId: string) =>
  apiRequest<DomainDetail>(`/domains/${domainId}/activate`, { method: "POST" });

export const deactivateDomain = (domainId: string) =>
  apiRequest<DomainDetail>(`/domains/${domainId}/deactivate`, { method: "POST" });

export const removeDomain = (domainId: string, stepUpToken?: string) =>
  apiRequest<{ id: string; domainName: string }>(`/domains/${domainId}`, { method: "DELETE", stepUpToken });

export async function listDomainChecks(domainId: string): Promise<DomainCheck[]> {
  return (await apiRequest<{ checks: DomainCheck[] }>(`/domains/${domainId}/checks`)).checks;
}

export const downloadZoneFile = (domain: Pick<DomainDetail, "id" | "domainName">) =>
  apiDownload(`/domains/${domain.id}/zone-file`, `${domain.domainName}.zone`);

export async function listDnsProviders(): Promise<DnsProviderCredential[]> {
  return (await apiRequest<{ credentials: DnsProviderCredential[] }>("/domains/dns-providers")).credentials;
}

export const connectDnsProvider = (input: ConnectProviderInput, stepUpToken?: string) =>
  apiRequest<DnsProviderCredential>("/domains/dns-providers", { method: "POST", body: input, stepUpToken });

export const verifyDnsProvider = (credentialId: string) =>
  apiRequest<DnsProviderCredential>(`/domains/dns-providers/${credentialId}/verify`, { method: "POST" });

export const removeDnsProvider = (credentialId: string, stepUpToken?: string) =>
  apiRequest<{ id: string }>(`/domains/dns-providers/${credentialId}`, { method: "DELETE", stepUpToken });

/** Whether a domain is still settling, which is when the screen polls fast. */
export function isSettling(domain: DomainDetail): boolean {
  return domain.status === "PENDING_VERIFICATION"
    || domain.status === "DEGRADED"
    || (domain.records ?? []).some((record) => record.state === "PENDING" || record.publishState === "PENDING")
    || (domain.dkimKeys ?? []).some((key) => key.status === "PENDING");
}
