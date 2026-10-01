import * as dns from "node:dns/promises";
import { env } from "../../config/env.js";

/**
 * DNS lookups with the one distinction verification depends on: a record
 * that is not there is a verdict, a resolver that failed is not.
 *
 * ENOTFOUND and ENODATA mean the authoritative answer was "nothing here", so
 * the record is MISSING. A timeout, SERVFAIL or refusal says nothing about
 * the record, and treating it as missing would suspend a healthy domain's
 * sending because a resolver had a bad minute.
 */

export type LookupOutcome<T> =
  | { ok: true; values: T }
  | { ok: false; kind: "ABSENT" | "ERROR"; code: string; message: string };

const ABSENT_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

export interface MxAnswer {
  exchange: string;
  priority: number;
}

export interface DnsLookup {
  txt(name: string): Promise<LookupOutcome<string[]>>;
  mx(name: string): Promise<LookupOutcome<MxAnswer[]>>;
  cname(name: string): Promise<LookupOutcome<string[]>>;
}

function describe(code: string, name: string): string {
  switch (code) {
    case "ENOTFOUND": return `${name} does not exist in DNS`;
    case "ENODATA": return `${name} exists but has no record of this type`;
    case "ETIMEOUT": return `The DNS lookup for ${name} timed out`;
    case "ESERVFAIL": return `The DNS server could not answer for ${name}`;
    case "EREFUSED": return `The DNS server refused the lookup for ${name}`;
    default: return `The DNS lookup for ${name} failed (${code})`;
  }
}

async function attempt<T>(name: string, run: () => Promise<T>): Promise<LookupOutcome<T>> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })),
        env.DNS_RESOLVER_TIMEOUT_MS
      );
    });
    return { ok: true, values: await Promise.race([run(), timeout]) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "DNS_LOOKUP_FAILED";
    return {
      ok: false,
      kind: ABSENT_CODES.has(code) ? "ABSENT" : "ERROR",
      code,
      message: describe(code, name),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type ResolverLike = Pick<typeof dns, "resolveTxt" | "resolveMx" | "resolveCname">;

/**
 * The module functions use the system resolver, which caches. When
 * DNS_RESOLVER_SERVERS is set, lookups go straight to those servers instead,
 * so a record the owner just published is seen as soon as it propagates
 * rather than whenever the host's cache expires.
 *
 * `dns.Resolver` is only touched when configured: the test suites mock this
 * module with the three lookup functions and nothing else.
 */
function resolver(): ResolverLike {
  if (!env.DNS_RESOLVER_SERVERS) return dns;
  const instance = new dns.Resolver({ timeout: env.DNS_RESOLVER_TIMEOUT_MS, tries: 2 });
  instance.setServers(env.DNS_RESOLVER_SERVERS.split(",").map((server) => server.trim()).filter(Boolean));
  return instance;
}

export function createDnsLookup(): DnsLookup {
  const r = resolver();
  return {
    txt: (name) => attempt(name, async () => (await r.resolveTxt(name)).map((parts) => parts.join(""))),
    mx: (name) => attempt(name, () => r.resolveMx(name)),
    cname: (name) => attempt(name, () => r.resolveCname(name)),
  };
}
