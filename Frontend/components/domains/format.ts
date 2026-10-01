import type { Tone } from "@/components/admin/ui";
import type { DnsPublishState, DnsRecordPurpose, DnsRecordState, DomainStatus } from "@/lib/domains-api";

export const STATE_LABEL: Record<DnsRecordState, string> = {
  PENDING: "Not checked",
  VERIFIED: "Verified",
  MISSING: "Missing",
  MISMATCH: "Wrong value",
  CONFLICT: "Conflict",
  LOOKUP_ERROR: "Lookup failed",
};

export const STATE_TONE: Record<DnsRecordState, Tone> = {
  PENDING: "nu",
  VERIFIED: "ok",
  MISSING: "warn",
  MISMATCH: "crit",
  CONFLICT: "crit",
  LOOKUP_ERROR: "warn",
};

export const STATUS_LABEL: Record<DomainStatus, string> = {
  PENDING_VERIFICATION: "Awaiting DNS",
  VERIFIED: "Verified",
  ACTIVE: "Sending",
  DEGRADED: "Suspended",
  FAILED: "Verification failed",
};

export const STATUS_TONE: Record<DomainStatus, Tone> = {
  PENDING_VERIFICATION: "warn",
  VERIFIED: "accent",
  ACTIVE: "ok",
  DEGRADED: "crit",
  FAILED: "crit",
};

export const PURPOSE_LABEL: Record<DnsRecordPurpose, string> = {
  OWNERSHIP: "Ownership",
  MX: "Inbound mail (MX)",
  SPF: "SPF",
  DKIM: "DKIM",
  DMARC: "DMARC",
  AUTODISCOVER: "Autodiscover",
  AUTOCONFIG: "Autoconfig",
};

/** One line on what each record is for, shown beside it. */
export const PURPOSE_HELP: Record<DnsRecordPurpose, string> = {
  OWNERSHIP: "Proves this workspace controls the domain.",
  MX: "Routes mail for the domain to Zoiko Mail.",
  SPF: "Authorises Zoiko Mail's servers to send as the domain.",
  DKIM: "Publishes the key that signs outgoing mail.",
  DMARC: "Tells receivers what to do with mail that fails SPF and DKIM.",
  AUTODISCOVER: "Lets Outlook configure itself.",
  AUTOCONFIG: "Lets Thunderbird and mobile clients configure themselves.",
};

export const PUBLISH_LABEL: Record<DnsPublishState, string> = {
  NOT_APPLICABLE: "",
  PENDING: "Publishing…",
  PUBLISHED: "Published",
  FAILED: "Publish failed",
};

/** "3 min ago", "in 2 h" — relative to now, both directions. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const delta = new Date(iso).getTime() - now;
  const abs = Math.abs(delta);
  const units: Array<[number, string]> = [[86_400_000, "d"], [3_600_000, "h"], [60_000, "min"]];
  const [size, unit] = units.find(([ms]) => abs >= ms) ?? [1_000, "s"];
  const value = Math.max(1, Math.round(abs / size));
  if (abs < 30_000) return delta < 0 ? "just now" : "any moment";
  return delta < 0 ? `${value} ${unit} ago` : `in ${value} ${unit}`;
}

export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
