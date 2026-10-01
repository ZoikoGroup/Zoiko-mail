import { providerRequest } from "./http.js";
import {
  DnsProviderError,
  zoneCandidates,
  type DnsProviderAdapter,
  type DnsZoneClient,
  type ProviderSecret,
  type ProviderSettings,
} from "./types.js";

interface GoDaddyRecord {
  data: string;
  name: string;
  type: string;
  ttl?: number;
  priority?: number;
}

/** GoDaddy refuses TTLs below 600 seconds. */
const MIN_TTL = 600;

function base(settings: ProviderSettings): string {
  return settings.environment === "OTE" ? "https://api.ote-godaddy.com" : "https://api.godaddy.com";
}

function describe(status: number, body: unknown): string {
  const message = (body as { message?: string } | null)?.message;
  if (status === 401) return "GoDaddy rejected the API key and secret.";
  if (status === 403) {
    // The most common production failure, and not one a retry fixes.
    return `GoDaddy refused access${message ? `: ${message}` : ""}. GoDaddy only grants DNS API access to some account types; if yours is not eligible, use manual setup or the zone file.`;
  }
  return `GoDaddy returned ${status}${message ? `: ${message}` : ""}`;
}

function authOf(secret: ProviderSecret): string {
  if (secret.provider !== "GODADDY") throw new DnsProviderError("Credential is not a GoDaddy key");
  return `sso-key ${secret.apiKey}:${secret.apiSecret}`;
}

export const godaddyAdapter: DnsProviderAdapter = {
  async verify(secret, settings) {
    await providerRequest(`${base(settings)}/v1/domains?limit=1`, { headers: { Authorization: authOf(secret) } }, describe);
    return { account: null };
  },

  async connect(secret, settings, domainName): Promise<DnsZoneClient> {
    const auth = authOf(secret);
    const root = base(settings);
    let zone: string | undefined;
    for (const candidate of zoneCandidates(domainName)) {
      try {
        await providerRequest(`${root}/v1/domains/${encodeURIComponent(candidate)}`, { headers: { Authorization: auth } }, describe);
        zone = candidate;
        break;
      } catch (error) {
        if (error instanceof DnsProviderError && error.status === 404) continue;
        throw error;
      }
    }
    if (!zone) throw new DnsProviderError(`${domainName} is not a domain in this GoDaddy account.`, 404);
    const zoneName = zone;

    // GoDaddy addresses records by name relative to the zone, "@" for apex.
    const relative = (fqdn: string) => (fqdn === zoneName ? "@" : fqdn.slice(0, -(zoneName.length + 1)));
    const path = (type: string, fqdn: string) =>
      `${root}/v1/domains/${encodeURIComponent(zoneName)}/records/${type}/${encodeURIComponent(relative(fqdn))}`;

    return {
      zone: zoneName,
      async get(type, fqdn) {
        const { body } = await providerRequest<GoDaddyRecord[]>(path(type, fqdn), { headers: { Authorization: auth } }, describe);
        return (body ?? []).map((record) => ({ content: record.data.replace(/\.$/, ""), priority: record.priority ?? null }));
      },
      async set(type, fqdn, values, ttl) {
        if (values.length === 0) {
          try {
            await providerRequest(path(type, fqdn), { method: "DELETE", headers: { Authorization: auth } }, describe);
          } catch (error) {
            if (!(error instanceof DnsProviderError && error.status === 404)) throw error;
          }
          return;
        }
        // PUT replaces every record of this type and name, which is exactly
        // the whole-set semantics the publisher expects.
        await providerRequest(path(type, fqdn), {
          method: "PUT",
          headers: { Authorization: auth },
          body: values.map((value) => ({
            data: value.content,
            ttl: Math.max(MIN_TTL, ttl),
            ...(type === "MX" ? { priority: value.priority ?? 10 } : {}),
          })),
        }, describe);
      },
    };
  },
};
