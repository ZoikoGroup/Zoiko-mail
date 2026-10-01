import type { DkimKeyStatus, DmarcPolicy, DnsRecordPurpose, DnsRecordType } from "@prisma/client";
import { env } from "../../config/env.js";

/**
 * What the platform needs published in a customer domain's DNS.
 *
 * Everything here is derived, never stored as free text: the domain's own
 * configuration plus the platform's infrastructure (env). Regenerating is
 * therefore always safe — if the MX host or the SPF include changes, every
 * domain's expected records change with it on the next synchronization, and
 * the difference is what gets republished and re-verified.
 */

export interface PlatformDnsConfig {
  mxHosts: Array<{ host: string; priority: number }>;
  spfInclude: string;
  spfAll: "~all" | "-all";
  dmarcRua: string | null;
  autoconfigHost: string | null;
  ttl: number;
}

export function platformDnsConfig(): PlatformDnsConfig {
  return {
    mxHosts: env.DNS_MX_HOSTS.split(",").map((pair) => {
      const [host, priority] = pair.split(":");
      return { host: normalizeHost(host ?? ""), priority: Number(priority) };
    }),
    spfInclude: env.DNS_SPF_INCLUDE.toLowerCase(),
    spfAll: env.DNS_SPF_ALL,
    dmarcRua: env.DNS_DMARC_RUA ?? null,
    autoconfigHost: env.DNS_AUTOCONFIG_HOST ? normalizeHost(env.DNS_AUTOCONFIG_HOST) : null,
    ttl: env.DNS_RECORD_TTL,
  };
}

/** Lower-cased, with the trailing root dot some resolvers return removed. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export interface DnsRecordSpec {
  recordKey: string;
  purpose: DnsRecordPurpose;
  type: DnsRecordType;
  /** Relative to the domain: "@" for the apex, otherwise the label(s). */
  name: string;
  fqdn: string;
  value: string;
  priority: number | null;
  ttl: number;
  /** Whether the domain's readiness depends on this record. */
  required: boolean;
  dkimKeyId: string | null;
}

export interface DomainDnsInput {
  domainName: string;
  verificationToken: string;
  receivingEnabled: boolean;
  dmarcPolicy: DmarcPolicy;
  dmarcReportEmail: string | null;
}

export interface DkimKeyInput {
  id: string;
  selector: string;
  publicKey: string;
  status: DkimKeyStatus;
}

export function fqdnFor(name: string, domainName: string): string {
  return name === "@" ? domainName : `${name}.${domainName}`;
}

export function spfValue(config: PlatformDnsConfig): string {
  return `v=spf1 include:${config.spfInclude} ${config.spfAll}`;
}

export function dkimValue(publicKey: string): string {
  return `v=DKIM1; k=rsa; p=${publicKey}`;
}

export function dmarcValue(policy: DmarcPolicy, reportEmail: string | null): string {
  const parts = [`v=DMARC1`, `p=${policy.toLowerCase()}`];
  if (reportEmail) parts.push(`rua=mailto:${reportEmail}`);
  // Relaxed alignment on both: a subdomain of the From domain still aligns,
  // which is what almost every sending setup needs.
  parts.push("adkim=r", "aspf=r");
  return parts.join("; ");
}

/**
 * The full expected record set for one domain.
 *
 * DKIM gets one record per live key. The ACTIVE key's record is required; a
 * PENDING key (a rotation in progress) and a RETIRING key (kept for mail in
 * flight) are published but do not decide whether the domain is healthy.
 */
export function expectedRecords(
  domain: DomainDnsInput,
  keys: DkimKeyInput[],
  config: PlatformDnsConfig = platformDnsConfig()
): DnsRecordSpec[] {
  const d = domain.domainName;
  const record = (spec: Omit<DnsRecordSpec, "fqdn" | "ttl" | "priority" | "dkimKeyId"> & Partial<DnsRecordSpec>): DnsRecordSpec => ({
    priority: null,
    dkimKeyId: null,
    ttl: config.ttl,
    fqdn: fqdnFor(spec.name, d),
    ...spec,
  });

  const records: DnsRecordSpec[] = [
    record({
      recordKey: "OWNERSHIP",
      purpose: "OWNERSHIP",
      type: "TXT",
      name: "@",
      value: domain.verificationToken,
      required: true,
    }),
  ];

  if (domain.receivingEnabled) {
    for (const mx of config.mxHosts) {
      records.push(record({
        recordKey: `MX:${mx.host}`,
        purpose: "MX",
        type: "MX",
        name: "@",
        value: mx.host,
        priority: mx.priority,
        required: true,
      }));
    }
  }

  records.push(record({
    recordKey: "SPF",
    purpose: "SPF",
    type: "TXT",
    name: "@",
    value: spfValue(config),
    required: true,
  }));

  for (const key of keys) {
    if (key.status === "RETIRED") continue;
    records.push(record({
      recordKey: `DKIM:${key.selector}`,
      purpose: "DKIM",
      type: "TXT",
      name: `${key.selector}._domainkey`,
      value: dkimValue(key.publicKey),
      required: key.status === "ACTIVE",
      dkimKeyId: key.id,
    }));
  }

  records.push(record({
    recordKey: "DMARC",
    purpose: "DMARC",
    type: "TXT",
    name: "_dmarc",
    value: dmarcValue(domain.dmarcPolicy, domain.dmarcReportEmail ?? config.dmarcRua),
    required: true,
  }));

  if (domain.receivingEnabled && config.autoconfigHost) {
    records.push(record({
      recordKey: "AUTODISCOVER",
      purpose: "AUTODISCOVER",
      type: "CNAME",
      name: "autodiscover",
      value: config.autoconfigHost,
      required: false,
    }));
    records.push(record({
      recordKey: "AUTOCONFIG",
      purpose: "AUTOCONFIG",
      type: "CNAME",
      name: "autoconfig",
      value: config.autoconfigHost,
      required: false,
    }));
  }

  return records;
}

/**
 * Hosts that belong to the platform itself. A workspace may not claim one:
 * verifying ownership of the MX host's domain would let a tenant publish
 * records that every other customer's mail depends on.
 */
export function platformOwnedDomains(config: PlatformDnsConfig = platformDnsConfig()): string[] {
  const registrable = (host: string) => host.split(".").slice(-2).join(".");
  const hosts = [
    ...config.mxHosts.map((mx) => mx.host),
    config.spfInclude.replace(/^_spf\./, ""),
    ...(config.autoconfigHost ? [config.autoconfigHost] : []),
  ];
  return [...new Set(hosts.map(registrable))];
}

/** Splits a TXT value into DNS character-strings of at most 255 bytes. */
export function txtChunks(value: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += 255) chunks.push(value.slice(index, index + 255));
  return chunks.length ? chunks : [""];
}

/**
 * The records as a BIND zone-file fragment. Cloudflare, Route 53 and most
 * registrars import this format, which turns "copy six records by hand" into
 * one upload for hosts the platform has no API access to.
 */
export function zoneFile(domainName: string, records: Array<Pick<DnsRecordSpec, "type" | "name" | "value" | "priority" | "ttl">>, generatedAt = new Date()): string {
  const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = [
    `; Zoiko Mail DNS records for ${domainName}`,
    `; Generated ${generatedAt.toISOString()}. Import into your DNS host, or add each record by hand.`,
    `$ORIGIN ${domainName}.`,
  ];
  for (const record of records) {
    const owner = record.name;
    if (record.type === "TXT") {
      lines.push(`${owner}\t${record.ttl}\tIN\tTXT\t${txtChunks(record.value).map(quote).join(" ")}`);
    } else if (record.type === "MX") {
      lines.push(`${owner}\t${record.ttl}\tIN\tMX\t${record.priority ?? 10}\t${record.value}.`);
    } else {
      lines.push(`${owner}\t${record.ttl}\tIN\tCNAME\t${record.value}.`);
    }
  }
  return `${lines.join("\n")}\n`;
}
