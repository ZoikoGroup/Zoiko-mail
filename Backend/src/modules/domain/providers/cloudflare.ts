import type { DnsRecordType } from "@prisma/client";
import { providerRequest } from "./http.js";
import {
  DnsProviderError,
  unquoteTxt,
  zoneCandidates,
  type DnsProviderAdapter,
  type DnsZoneClient,
  type ProviderRecordValue,
  type ProviderSecret,
} from "./types.js";

const BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareEnvelope<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: T;
}

interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
}

function describe(status: number, body: unknown): string {
  const message = (body as CloudflareEnvelope<unknown> | null)?.errors?.[0]?.message;
  if (status === 401 || status === 403) {
    return `Cloudflare rejected the API token${message ? `: ${message}` : ""}. It needs Zone:Read and DNS:Edit on this zone.`;
  }
  return `Cloudflare returned ${status}${message ? `: ${message}` : ""}`;
}

function tokenOf(secret: ProviderSecret): string {
  if (secret.provider !== "CLOUDFLARE") throw new DnsProviderError("Credential is not a Cloudflare token");
  return secret.apiToken;
}

async function call<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const { body: envelope } = await providerRequest<CloudflareEnvelope<T>>(
    `${BASE}${path}`,
    { method, headers: { Authorization: `Bearer ${token}` }, body },
    describe
  );
  if (!envelope.success) throw new DnsProviderError(describe(200, envelope));
  return envelope.result;
}

const sameValue = (a: ProviderRecordValue, b: ProviderRecordValue) =>
  a.content.toLowerCase() === b.content.toLowerCase() && (a.priority ?? null) === (b.priority ?? null);

export const cloudflareAdapter: DnsProviderAdapter = {
  async verify(secret) {
    const result = await call<{ status: string }>(tokenOf(secret), "/user/tokens/verify");
    if (result.status !== "active") throw new DnsProviderError(`Cloudflare token status is ${result.status}`, 403);
    return { account: null };
  },

  async connect(secret, _settings, domainName): Promise<DnsZoneClient> {
    const token = tokenOf(secret);
    let zone: { id: string; name: string } | undefined;
    for (const candidate of zoneCandidates(domainName)) {
      const zones = await call<Array<{ id: string; name: string }>>(token, `/zones?name=${encodeURIComponent(candidate)}`);
      zone = zones[0];
      if (zone) break;
    }
    if (!zone) {
      throw new DnsProviderError(`No Cloudflare zone for ${domainName} is visible to this token.`, 404);
    }
    const zoneId = zone.id;

    const list = (type: DnsRecordType, fqdn: string) =>
      call<CloudflareRecord[]>(token, `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(fqdn)}&per_page=100`);

    return {
      zone: zone.name,
      async get(type, fqdn) {
        return (await list(type, fqdn)).map((record) => ({
          content: type === "TXT" ? unquoteTxt(record.content) : record.content.replace(/\.$/, ""),
          priority: record.priority ?? null,
        }));
      },
      async set(type, fqdn, values, ttl) {
        const existing = (await list(type, fqdn)).map((record) => ({
          id: record.id,
          value: { content: type === "TXT" ? unquoteTxt(record.content) : record.content.replace(/\.$/, ""), priority: record.priority ?? null },
        }));
        for (const record of existing) {
          if (!values.some((value) => sameValue(value, record.value))) {
            await call(token, `/zones/${zoneId}/dns_records/${record.id}`, "DELETE");
          }
        }
        for (const value of values) {
          if (existing.some((record) => sameValue(record.value, value))) continue;
          await call(token, `/zones/${zoneId}/dns_records`, "POST", {
            type,
            name: fqdn,
            // Quoted, as Cloudflare now recommends for TXT; it splits long
            // values into 255-byte strings itself.
            content: type === "TXT" ? `"${value.content.replace(/"/g, '\\"')}"` : value.content,
            ttl,
            ...(type === "MX" ? { priority: value.priority ?? 10 } : {}),
            ...(type === "CNAME" ? { proxied: false } : {}),
          });
        }
      },
    };
  },
};
