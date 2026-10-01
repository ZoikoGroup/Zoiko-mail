import type { DnsRecordState } from "@prisma/client";
import { normalizeHost, type DnsRecordSpec } from "./dns.records.js";
import type { DnsLookup, LookupOutcome, MxAnswer } from "./dns.resolver.js";

/**
 * Checks each expected record against what DNS actually returns.
 *
 * The earlier check accepted any TXT that started with "v=spf1" and any DKIM
 * record containing "v=DKIM1", so a placeholder pasted verbatim passed. Every
 * rule here compares against the value this domain needs, and says in words
 * what is wrong when it is not there — the diagnosis is what the owner reads.
 */

export interface RecordEvaluation {
  recordKey: string;
  state: DnsRecordState;
  observed: string[];
  diagnosis: string | null;
  errorCode: string | null;
}

export interface VerificationContext {
  /** Every platform MX host, so a second platform MX is not a conflict. */
  platformMxHosts: string[];
}

type Outcome = LookupOutcome<string[]> | LookupOutcome<MxAnswer[]>;

const lookupKey = (type: string, fqdn: string) => `${type}:${fqdn}`;

/** Runs each distinct lookup once, however many records share a name. */
export async function lookupAll(specs: DnsRecordSpec[], lookup: DnsLookup): Promise<Map<string, Outcome>> {
  const pending = new Map<string, Promise<Outcome>>();
  for (const spec of specs) {
    const key = lookupKey(spec.type, spec.fqdn);
    if (pending.has(key)) continue;
    pending.set(
      key,
      spec.type === "MX" ? lookup.mx(spec.fqdn) : spec.type === "CNAME" ? lookup.cname(spec.fqdn) : lookup.txt(spec.fqdn)
    );
  }
  const results = new Map<string, Outcome>();
  await Promise.all([...pending].map(async ([key, promise]) => results.set(key, await promise)));
  return results;
}

export function outcomeFor(results: Map<string, Outcome>, spec: DnsRecordSpec): Outcome | undefined {
  return results.get(lookupKey(spec.type, spec.fqdn));
}

function result(spec: DnsRecordSpec, state: DnsRecordState, observed: string[], diagnosis: string | null, errorCode: string | null = null): RecordEvaluation {
  return { recordKey: spec.recordKey, state, observed, diagnosis, errorCode };
}

/** Parses `k=v; k=v` tag lists (DKIM, DMARC). Keys lower-cased. */
export function parseTags(record: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    tags.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
  }
  return tags;
}

const isSpf = (value: string) => /^v=spf1(\s|$)/i.test(value.trim());
const isDmarc = (value: string) => /^v=dmarc1\s*(;|$)/i.test(value.trim());
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function includeOf(spec: DnsRecordSpec): string {
  return /include:(\S+)/i.exec(spec.value)?.[1] ?? "";
}

export function spfIncludes(record: string, include: string): boolean {
  return new RegExp(`(^|\\s)\\+?include:${escapeRegExp(include)}(\\s|$)`, "i").test(record);
}

function evaluateTxt(spec: DnsRecordSpec, values: string[]): RecordEvaluation {
  switch (spec.purpose) {
    case "OWNERSHIP":
      return values.includes(spec.value)
        ? result(spec, "VERIFIED", values, null)
        : result(spec, "MISSING", values, values.length
          ? "TXT records exist at the domain, but none of them is this verification token."
          : "No TXT record at the domain yet.");

    case "SPF": {
      const spf = values.filter(isSpf);
      if (spf.length === 0) return result(spec, "MISSING", values, "The domain has no SPF record.");
      if (spf.length > 1) {
        return result(spec, "CONFLICT", spf,
          `The domain has ${spf.length} SPF records. Receivers treat that as a permanent error, so SPF fails for every message — merge them into one.`);
      }
      const record = spf[0]!;
      if (/(^|\s)\+?all(\s|$)/i.test(record)) {
        return result(spec, "MISMATCH", spf, "The SPF record ends in +all, which authorises every server on the internet to send as this domain.");
      }
      const include = includeOf(spec);
      return spfIncludes(record, include)
        ? result(spec, "VERIFIED", spf, null)
        : result(spec, "MISMATCH", spf, `The SPF record does not include ${include}. Add include:${include} before the final "all".`);
    }

    case "DKIM": {
      const expected = parseTags(spec.value).get("p")?.replace(/\s+/g, "") ?? "";
      const candidates = values.filter((value) => parseTags(value).has("p"));
      if (candidates.length === 0) return result(spec, "MISSING", values, `No DKIM key is published at ${spec.fqdn}.`);
      const keys = candidates.map((value) => parseTags(value).get("p")?.replace(/\s+/g, "") ?? "");
      if (keys.includes(expected)) return result(spec, "VERIFIED", candidates, null);
      if (keys.every((key) => key === "")) {
        return result(spec, "MISMATCH", candidates, "The DKIM record has an empty p= tag, which revokes the key.");
      }
      return result(spec, "MISMATCH", candidates,
        "A DKIM key is published under this selector, but it is not this domain's key. Replace it with the value shown — a truncated copy is the usual cause.");
    }

    case "DMARC": {
      const dmarc = values.filter(isDmarc);
      if (dmarc.length === 0) return result(spec, "MISSING", values, "The domain has no DMARC record.");
      if (dmarc.length > 1) {
        return result(spec, "CONFLICT", dmarc,
          `There are ${dmarc.length} DMARC records. Receivers ignore DMARC entirely when there is more than one — keep one.`);
      }
      const policy = parseTags(dmarc[0]!).get("p")?.toLowerCase();
      if (!policy || !["none", "quarantine", "reject"].includes(policy)) {
        return result(spec, "MISMATCH", dmarc, "The DMARC record has no valid p= policy (none, quarantine or reject).");
      }
      // A stricter policy than the one generated is the owner's choice, and
      // it is a valid DMARC record either way.
      const configured = parseTags(spec.value).get("p")?.toLowerCase();
      return result(spec, "VERIFIED", dmarc,
        configured && configured !== policy ? `Published policy is p=${policy}; the configured default is p=${configured}. The published one is used.` : null);
    }

    default:
      return values.includes(spec.value)
        ? result(spec, "VERIFIED", values, null)
        : result(spec, values.length ? "MISMATCH" : "MISSING", values, `Expected ${spec.value}.`);
  }
}

function evaluateMx(spec: DnsRecordSpec, answers: MxAnswer[], context: VerificationContext): RecordEvaluation {
  const observed = answers.map((answer) => `${answer.priority} ${normalizeHost(answer.exchange)}`);
  const ours = answers.find((answer) => normalizeHost(answer.exchange) === spec.value);
  if (!ours) {
    return result(spec, answers.length ? "MISMATCH" : "MISSING", observed, answers.length
      ? `Mail for this domain is routed to ${observed.join(", ")}, not ${spec.value}.`
      : "The domain has no MX record.");
  }
  const platform = new Set(context.platformMxHosts);
  const ahead = answers.filter((answer) => answer.priority < ours.priority && !platform.has(normalizeHost(answer.exchange)));
  if (ahead.length) {
    return result(spec, "CONFLICT", observed,
      `${ahead.map((answer) => normalizeHost(answer.exchange)).join(", ")} has a lower priority number, so senders deliver there first. Remove the old MX records.`);
  }
  return result(spec, "VERIFIED", observed, null);
}

function evaluateCname(spec: DnsRecordSpec, targets: string[]): RecordEvaluation {
  const observed = targets.map(normalizeHost);
  if (observed.includes(spec.value)) return result(spec, "VERIFIED", observed, null);
  return result(spec, observed.length ? "MISMATCH" : "MISSING", observed,
    observed.length ? `Points to ${observed.join(", ")} instead of ${spec.value}.` : `No CNAME at ${spec.fqdn}.`);
}

/**
 * One record's verdict. A resolver failure carries the previous verdict
 * forward rather than inventing one; the caller decides what that means.
 */
export function evaluateRecord(
  spec: DnsRecordSpec,
  outcome: Outcome | undefined,
  previous: DnsRecordState,
  context: VerificationContext
): RecordEvaluation {
  if (!outcome) return result(spec, previous, [], "Not looked up.", "NOT_LOOKED_UP");
  if (!outcome.ok) {
    if (outcome.kind === "ERROR") {
      return result(spec, previous === "PENDING" ? "LOOKUP_ERROR" : previous, [], outcome.message, outcome.code);
    }
    // Absent is a verdict, and an empty one for every purpose.
    const empty = spec.type === "MX" ? evaluateMx(spec, [], context) : evaluateTxt(spec, []);
    return { ...empty, errorCode: outcome.code, diagnosis: empty.diagnosis ?? outcome.message };
  }
  if (spec.type === "MX") return evaluateMx(spec, outcome.values as MxAnswer[], context);
  if (spec.type === "CNAME") return evaluateCname(spec, outcome.values as string[]);
  return evaluateTxt(spec, outcome.values as string[]);
}

/** Whether a state is a firm "this record is wrong" rather than "unknown". */
export function isDefinitiveFailure(state: DnsRecordState): boolean {
  return state === "MISSING" || state === "MISMATCH" || state === "CONFLICT";
}
