import { normalizeHost, type DnsRecordSpec } from "./dns.records.js";
import { parseTags, spfIncludes } from "./dns.verifier.js";
import { DnsProviderError, type DnsZoneClient, type ProviderRecordValue } from "./providers/index.js";

/**
 * Writing the expected records into a DNS host without breaking what is
 * already there.
 *
 * Each rule below exists because the naive version causes an outage:
 *
 *  - SPF: a second SPF record makes SPF fail for the whole domain, so ours
 *    is merged into the existing one as an include.
 *  - TXT at the apex also holds other services' verification tokens; ours
 *    is added beside them, never in place of them.
 *  - DMARC: an owner who already publishes a policy chose it. It is kept.
 *  - MX: replacing the MX set moves the domain's mail. That only happens when
 *    the domain is configured to take over inbound mail; otherwise ours is
 *    added and verification reports the competing hosts.
 *
 * Every change reads the current set first and writes the whole set back,
 * which is the one operation every provider supports the same way.
 */

export type PublishOutcome =
  | { status: "PUBLISHED"; note: string | null }
  | { status: "SKIPPED"; note: string }
  | { status: "FAILED"; error: string };

const isSpf = (value: string) => /^v=spf1(\s|$)/i.test(value.trim());
const isDmarc = (value: string) => /^v=dmarc1\s*(;|$)/i.test(value.trim());

/** Adds `include:x` before the terminating all/redirect mechanism. */
export function mergeSpfInclude(record: string, include: string): string {
  if (spfIncludes(record, include)) return record;
  const tokens = record.trim().split(/\s+/);
  const terminal = tokens.findIndex((token, index) => index > 0 && (/^[~+?-]?all$/i.test(token) || /^redirect=/i.test(token)));
  const mechanism = `include:${include}`;
  if (terminal < 0) tokens.push(mechanism);
  else tokens.splice(terminal, 0, mechanism);
  return tokens.join(" ");
}

/** Removes our include. Null when nothing but the terminator would remain. */
export function removeSpfInclude(record: string, include: string): string | null {
  const tokens = record.trim().split(/\s+/).filter((token) => token.replace(/^\+/, "").toLowerCase() !== `include:${include.toLowerCase()}`);
  const meaningful = tokens.slice(1).filter((token) => !/^[~+?-]?all$/i.test(token));
  return meaningful.length === 0 ? null : tokens.join(" ");
}

const includeOf = (spec: DnsRecordSpec) => /include:(\S+)/i.exec(spec.value)?.[1] ?? "";
const contents = (values: ProviderRecordValue[]) => values.map((value) => value.content);

export interface PublishOptions {
  replaceExistingMx: boolean;
  /** Every platform MX host, so replacing keeps all of ours. */
  platformMx: Array<{ host: string; priority: number }>;
}

export async function publishRecord(zone: DnsZoneClient, spec: DnsRecordSpec, options: PublishOptions): Promise<PublishOutcome> {
  try {
    switch (spec.purpose) {
      case "OWNERSHIP": {
        const current = await zone.get("TXT", spec.fqdn);
        if (contents(current).includes(spec.value)) return { status: "PUBLISHED", note: null };
        await zone.set("TXT", spec.fqdn, [...current, { content: spec.value }], spec.ttl);
        return { status: "PUBLISHED", note: null };
      }

      case "SPF": {
        const current = await zone.get("TXT", spec.fqdn);
        const spf = current.filter((value) => isSpf(value.content));
        if (spf.length > 1) {
          return { status: "FAILED", error: "The domain already has several SPF records. Merge them into one by hand; merging automatically could authorise the wrong servers." };
        }
        if (spf.length === 0) {
          await zone.set("TXT", spec.fqdn, [...current, { content: spec.value }], spec.ttl);
          return { status: "PUBLISHED", note: null };
        }
        const existing = spf[0]!.content;
        const merged = mergeSpfInclude(existing, includeOf(spec));
        if (merged === existing) return { status: "PUBLISHED", note: "The existing SPF record already included Zoiko Mail." };
        await zone.set("TXT", spec.fqdn, current.map((value) => (value.content === existing ? { content: merged } : value)), spec.ttl);
        return { status: "PUBLISHED", note: "Added to the existing SPF record rather than creating a second one." };
      }

      case "DKIM":
      case "AUTODISCOVER":
      case "AUTOCONFIG": {
        // These names belong to us: the selector is ours, and the
        // autoconfiguration hosts only mean one thing.
        await zone.set(spec.type, spec.fqdn, [{ content: spec.value }], spec.ttl);
        return { status: "PUBLISHED", note: null };
      }

      case "DMARC": {
        const current = await zone.get("TXT", spec.fqdn);
        const dmarc = current.filter((value) => isDmarc(value.content));
        const valid = dmarc.filter((value) => ["none", "quarantine", "reject"].includes(parseTags(value.content).get("p")?.toLowerCase() ?? ""));
        if (dmarc.length === 1 && valid.length === 1) {
          return { status: "SKIPPED", note: "The domain already publishes a DMARC policy; it was kept." };
        }
        // No DMARC, several, or one without a policy: all three leave the
        // domain without a working policy, so ours replaces them.
        await zone.set("TXT", spec.fqdn, [...current.filter((value) => !isDmarc(value.content)), { content: spec.value }], spec.ttl);
        return { status: "PUBLISHED", note: null };
      }

      case "MX": {
        const current = await zone.get("MX", spec.fqdn);
        const host = normalizeHost(spec.value);
        if (options.replaceExistingMx) {
          const desired = options.platformMx.map((mx) => ({ content: mx.host, priority: mx.priority }));
          const same = current.length === desired.length
            && desired.every((mx) => current.some((value) => normalizeHost(value.content) === mx.content && value.priority === mx.priority));
          if (!same) await zone.set("MX", spec.fqdn, desired, spec.ttl);
          return { status: "PUBLISHED", note: same ? null : "Replaced the domain's previous MX records." };
        }
        if (current.some((value) => normalizeHost(value.content) === host)) return { status: "PUBLISHED", note: null };
        await zone.set("MX", spec.fqdn, [...current, { content: host, priority: spec.priority ?? 10 }], spec.ttl);
        return {
          status: "PUBLISHED",
          note: current.length ? "Added beside the existing MX records, which still receive mail until they are removed." : null,
        };
      }
    }
  } catch (error) {
    return { status: "FAILED", error: error instanceof DnsProviderError ? error.message : "The DNS provider request failed" };
  }
}

/**
 * Takes out what `publishRecord` put in, and nothing else. Used when a
 * domain is removed or a record is no longer expected (a retired DKIM key,
 * receiving switched off).
 */
export async function unpublishRecord(zone: DnsZoneClient, spec: DnsRecordSpec): Promise<PublishOutcome> {
  try {
    switch (spec.purpose) {
      case "OWNERSHIP": {
        const current = await zone.get("TXT", spec.fqdn);
        if (!contents(current).includes(spec.value)) return { status: "SKIPPED", note: "Not present." };
        await zone.set("TXT", spec.fqdn, current.filter((value) => value.content !== spec.value), spec.ttl);
        return { status: "PUBLISHED", note: null };
      }
      case "SPF": {
        const current = await zone.get("TXT", spec.fqdn);
        const include = includeOf(spec);
        const target = current.find((value) => isSpf(value.content) && spfIncludes(value.content, include));
        if (!target) return { status: "SKIPPED", note: "Not present." };
        const reduced = removeSpfInclude(target.content, include);
        await zone.set(
          "TXT",
          spec.fqdn,
          reduced === null
            ? current.filter((value) => value !== target)
            : current.map((value) => (value === target ? { content: reduced } : value)),
          spec.ttl
        );
        return { status: "PUBLISHED", note: null };
      }
      case "DMARC": {
        const current = await zone.get("TXT", spec.fqdn);
        // Only a policy we wrote, byte for byte; an owner's own is theirs.
        if (!contents(current).includes(spec.value)) return { status: "SKIPPED", note: "The published DMARC policy is not ours; kept." };
        await zone.set("TXT", spec.fqdn, current.filter((value) => value.content !== spec.value), spec.ttl);
        return { status: "PUBLISHED", note: null };
      }
      case "MX": {
        const current = await zone.get("MX", spec.fqdn);
        const host = normalizeHost(spec.value);
        if (!current.some((value) => normalizeHost(value.content) === host)) return { status: "SKIPPED", note: "Not present." };
        await zone.set("MX", spec.fqdn, current.filter((value) => normalizeHost(value.content) !== host), spec.ttl);
        return { status: "PUBLISHED", note: null };
      }
      default: {
        const current = await zone.get(spec.type, spec.fqdn);
        if (!current.some((value) => normalizeHost(value.content) === normalizeHost(spec.value) || value.content === spec.value)) {
          return { status: "SKIPPED", note: "Not present." };
        }
        await zone.set(spec.type, spec.fqdn, [], spec.ttl);
        return { status: "PUBLISHED", note: null };
      }
    }
  } catch (error) {
    return { status: "FAILED", error: error instanceof DnsProviderError ? error.message : "The DNS provider request failed" };
  }
}
