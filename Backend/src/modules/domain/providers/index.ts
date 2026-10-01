import type { DnsProviderKind } from "@prisma/client";
import { cloudflareAdapter } from "./cloudflare.js";
import { godaddyAdapter } from "./godaddy.js";
import type { DnsProviderAdapter } from "./types.js";

export * from "./types.js";

const adapters: Partial<Record<DnsProviderKind, DnsProviderAdapter>> = {
  CLOUDFLARE: cloudflareAdapter,
  GODADDY: godaddyAdapter,
};

export function dnsProviderAdapter(kind: DnsProviderKind): DnsProviderAdapter | null {
  return adapters[kind] ?? null;
}

/** Test seam: replace a provider with an in-memory fake. */
export function setDnsProviderAdapter(kind: DnsProviderKind, adapter: DnsProviderAdapter): () => void {
  const previous = adapters[kind];
  adapters[kind] = adapter;
  return () => {
    if (previous) adapters[kind] = previous;
    else delete adapters[kind];
  };
}
