import type { DnsRecordType } from "@prisma/client";

/**
 * The contract every DNS host is adapted to.
 *
 * Deliberately small: read the values at one name and type, and replace
 * them. Cloudflare has per-record ids and GoDaddy has none, but both can do
 * "this is the full set of values at this name" — and expressing every
 * change as a whole-set replacement is what lets the publisher merge with
 * what is already there (an existing SPF record, the owner's other TXT
 * records) instead of clobbering it.
 */

export interface ProviderRecordValue {
  content: string;
  priority?: number | null;
}

export interface DnsZoneClient {
  /** The zone the domain lives in, e.g. acme.com for mail.acme.com. */
  readonly zone: string;
  get(type: DnsRecordType, fqdn: string): Promise<ProviderRecordValue[]>;
  /** Replaces every value at (type, fqdn). An empty list deletes them. */
  set(type: DnsRecordType, fqdn: string, values: ProviderRecordValue[], ttl: number): Promise<void>;
}

/** Secret half of a credential, as stored in the secret store. */
export type ProviderSecret =
  | { provider: "CLOUDFLARE"; apiToken: string }
  | { provider: "GODADDY"; apiKey: string; apiSecret: string };

/** Non-secret options, stored on the credential row. */
export interface ProviderSettings {
  /** GoDaddy only: OTE is GoDaddy's test environment. */
  environment?: "PRODUCTION" | "OTE";
}

export interface DnsProviderAdapter {
  /** Proves the credential works. Resolves with a human label on success. */
  verify(secret: ProviderSecret, settings: ProviderSettings): Promise<{ account: string | null }>;
  /** Finds the zone holding `domainName` and returns a client scoped to it. */
  connect(secret: ProviderSecret, settings: ProviderSettings, domainName: string): Promise<DnsZoneClient>;
}

/**
 * A provider refused or failed. `status` is the provider's HTTP status when
 * there was one, so the caller can tell "bad credentials" (401/403) from
 * "provider down" (5xx, timeout).
 */
export class DnsProviderError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "DnsProviderError";
  }

  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** The zones a domain could live in, most specific first. */
export function zoneCandidates(domainName: string): string[] {
  const labels = domainName.split(".");
  const candidates: string[] = [];
  for (let index = 0; index <= labels.length - 2; index += 1) candidates.push(labels.slice(index).join("."));
  return candidates;
}

/** Strips the quotes some APIs wrap TXT content in, and rejoins split strings. */
export function unquoteTxt(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  const parts = [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1"));
  return parts.length ? parts.join("") : trimmed;
}
