import type { DnsRecordType } from "@prisma/client";
import type { DnsLookup, MxAnswer } from "../src/modules/domain/dns.resolver.js";
import type { DnsProviderAdapter, DnsZoneClient, ProviderRecordValue } from "../src/modules/domain/providers/index.js";

/**
 * One in-memory DNS, readable as a resolver and writable as a provider.
 *
 * Tying the two together is the point: a record the publisher writes through
 * the fake provider is what the verifier then resolves, so a test exercises
 * create → publish → verify end to end without a network.
 */
export class FakeDns {
  private readonly rrsets = new Map<string, ProviderRecordValue[]>();
  /** fqdn → resolver error code, to simulate SERVFAIL or timeouts. */
  readonly failures = new Map<string, string>();

  private key(type: DnsRecordType, fqdn: string) {
    return `${type}:${fqdn.toLowerCase()}`;
  }

  get(type: DnsRecordType, fqdn: string): ProviderRecordValue[] {
    return [...(this.rrsets.get(this.key(type, fqdn)) ?? [])];
  }

  set(type: DnsRecordType, fqdn: string, values: ProviderRecordValue[]) {
    if (values.length === 0) this.rrsets.delete(this.key(type, fqdn));
    else this.rrsets.set(this.key(type, fqdn), values.map((value) => ({ ...value })));
  }

  add(type: DnsRecordType, fqdn: string, content: string, priority?: number) {
    this.set(type, fqdn, [...this.get(type, fqdn), { content, priority: priority ?? null }]);
  }

  /** Publishes a domain's generated records exactly as shown to the owner. */
  publishAll(records: Array<{ type: DnsRecordType; fqdn: string; value: string; priority: number | null }>) {
    for (const record of records) this.add(record.type, record.fqdn, record.value, record.priority ?? undefined);
  }

  clear() {
    this.rrsets.clear();
    this.failures.clear();
  }

  lookup(): DnsLookup {
    const answer = <T>(type: DnsRecordType, name: string, map: (values: ProviderRecordValue[]) => T) => {
      const failure = this.failures.get(name.toLowerCase());
      if (failure) return Promise.resolve({ ok: false as const, kind: "ERROR" as const, code: failure, message: `${failure} for ${name}` });
      const values = this.get(type, name);
      if (values.length === 0) return Promise.resolve({ ok: false as const, kind: "ABSENT" as const, code: "ENOTFOUND", message: `${name} not found` });
      return Promise.resolve({ ok: true as const, values: map(values) });
    };
    return {
      txt: (name) => answer("TXT", name, (values) => values.map((value) => value.content)),
      mx: (name) => answer("MX", name, (values) => values.map((value): MxAnswer => ({ exchange: value.content, priority: value.priority ?? 10 }))),
      cname: (name) => answer("CNAME", name, (values) => values.map((value) => value.content)),
    };
  }

  /** A provider adapter whose every zone writes into this DNS. */
  adapter(options: { rejectCredential?: boolean; calls?: string[] } = {}): DnsProviderAdapter {
    const get = (type: DnsRecordType, fqdn: string) => this.get(type, fqdn);
    const set = (type: DnsRecordType, fqdn: string, values: ProviderRecordValue[]) => this.set(type, fqdn, values);
    return {
      async verify() {
        options.calls?.push("verify");
        if (options.rejectCredential) {
          const { DnsProviderError } = await import("../src/modules/domain/providers/types.js");
          throw new DnsProviderError("Token is not valid", 403);
        }
        return { account: null };
      },
      async connect(_secret, _settings, domainName): Promise<DnsZoneClient> {
        options.calls?.push(`connect:${domainName}`);
        return {
          zone: domainName,
          async get(type, fqdn) {
            return get(type, fqdn);
          },
          async set(type, fqdn, values) {
            options.calls?.push(`set:${type}:${fqdn}`);
            set(type, fqdn, values);
          },
        };
      },
    };
  }
}
