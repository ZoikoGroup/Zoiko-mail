import { describe, expect, it } from "vitest";
import {
  dmarcValue,
  expectedRecords,
  platformOwnedDomains,
  zoneFile,
  type DnsRecordSpec,
  type PlatformDnsConfig,
} from "../src/modules/domain/dns.records.js";
import { evaluateRecord } from "../src/modules/domain/dns.verifier.js";
import { nextCheckDelayMs, readiness, transition, type TransitionInput } from "../src/modules/domain/domain.lifecycle.js";
import { nextSelector } from "../src/modules/domain/dkim.service.js";

/**
 * The rules, without a database or a network.
 *
 * These are the decisions the old implementation got wrong — accepting a
 * placeholder DKIM key, a second SPF record, any MX at all — so each one is
 * pinned here as a case rather than left implicit in an API test.
 */

const config: PlatformDnsConfig = {
  mxHosts: [{ host: "mx1.platform.test", priority: 10 }, { host: "mx2.platform.test", priority: 20 }],
  spfInclude: "_spf.platform.test",
  spfAll: "~all",
  dmarcRua: null,
  autoconfigHost: null,
  ttl: 3600,
};

const domain = {
  domainName: "acme.test",
  verificationToken: "zoiko-mail-verification=abc",
  receivingEnabled: true,
  dmarcPolicy: "NONE" as const,
  dmarcReportEmail: null,
};

const activeKey = { id: "k1", selector: "zm202609", publicKey: "MIIBIjANBgkq", status: "ACTIVE" as const };
const records = expectedRecords(domain, [activeKey], config);
const spec = (key: string) => records.find((record) => record.recordKey === key)!;
const verification = { platformMxHosts: ["mx1.platform.test", "mx2.platform.test"] };
const txt = (values: string[]) => ({ ok: true as const, values });
const absent = { ok: false as const, kind: "ABSENT" as const, code: "ENOTFOUND", message: "not found" };

describe("record generation", () => {
  it("derives every record from the domain and the platform", () => {
    expect(records.map((record) => record.recordKey)).toEqual([
      "OWNERSHIP", "MX:mx1.platform.test", "MX:mx2.platform.test", "SPF", "DKIM:zm202609", "DMARC",
    ]);
    expect(spec("OWNERSHIP")).toMatchObject({ type: "TXT", name: "@", fqdn: "acme.test", value: "zoiko-mail-verification=abc", required: true });
    expect(spec("MX:mx1.platform.test")).toMatchObject({ type: "MX", name: "@", value: "mx1.platform.test", priority: 10 });
    expect(spec("SPF").value).toBe("v=spf1 include:_spf.platform.test ~all");
    // Relative host for the DNS dashboard, full name for lookups.
    expect(spec("DKIM:zm202609")).toMatchObject({ name: "zm202609._domainkey", fqdn: "zm202609._domainkey.acme.test", value: "v=DKIM1; k=rsa; p=MIIBIjANBgkq" });
    expect(spec("DMARC")).toMatchObject({ name: "_dmarc", value: "v=DMARC1; p=none; adkim=r; aspf=r" });
  });

  it("drops MX when the domain keeps its own mail host", () => {
    const outbound = expectedRecords({ ...domain, receivingEnabled: false }, [activeKey], config);
    expect(outbound.some((record) => record.purpose === "MX")).toBe(false);
  });

  it("publishes a rotation's new key without depending on it, and forgets retired keys", () => {
    const rotating = expectedRecords(domain, [
      { ...activeKey, status: "RETIRING" },
      { id: "k2", selector: "zm202610", publicKey: "NEW", status: "ACTIVE" },
      { id: "k3", selector: "zm202611", publicKey: "NEXT", status: "PENDING" },
      { id: "k0", selector: "zm202601", publicKey: "OLD", status: "RETIRED" },
    ], config);
    const dkim = rotating.filter((record) => record.purpose === "DKIM").map((record) => [record.recordKey, record.required]);
    expect(dkim).toEqual([["DKIM:zm202609", false], ["DKIM:zm202610", true], ["DKIM:zm202611", false]]);
  });

  it("adds autodiscover only when the platform offers it", () => {
    const withAutoconfig = expectedRecords(domain, [activeKey], { ...config, autoconfigHost: "autoconfig.platform.test" });
    expect(withAutoconfig.filter((record) => record.type === "CNAME").map((record) => [record.name, record.required]))
      .toEqual([["autodiscover", false], ["autoconfig", false]]);
  });

  it("names the report mailbox in DMARC when there is one", () => {
    expect(dmarcValue("QUARANTINE", "dmarc@acme.test")).toBe("v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.test; adkim=r; aspf=r");
  });

  it("refuses the platform's own domains", () => {
    expect(platformOwnedDomains(config)).toEqual(["platform.test"]);
  });

  it("dates DKIM selectors and keeps them unique", () => {
    const now = new Date("2026-09-15T00:00:00Z");
    expect(nextSelector([], now)).toBe("zm202609");
    expect(nextSelector(["zm202609"], now)).toBe("zm202609b");
    expect(nextSelector(["zm202609", "zm202609b"], now)).toBe("zm202609c");
  });

  it("writes an importable zone file, splitting long TXT values", () => {
    const longKey = "A".repeat(400);
    const file = zoneFile("acme.test", expectedRecords(domain, [{ ...activeKey, publicKey: longKey }], config));
    expect(file).toContain("$ORIGIN acme.test.");
    expect(file).toContain('@\t3600\tIN\tTXT\t"zoiko-mail-verification=abc"');
    expect(file).toContain("@\t3600\tIN\tMX\t10\tmx1.platform.test.");
    const dkimLine = file.split("\n").find((line) => line.startsWith("zm202609._domainkey"))!;
    // 255-byte character-strings, as DNS requires.
    expect(dkimLine.match(/"[^"]*"/g)!.every((chunk) => chunk.length - 2 <= 255)).toBe(true);
    expect(dkimLine.match(/"[^"]*"/g)!.map((chunk) => chunk.slice(1, -1)).join("")).toBe(`v=DKIM1; k=rsa; p=${longKey}`);
  });
});

describe("verification", () => {
  const evaluate = (record: DnsRecordSpec, outcome: Parameters<typeof evaluateRecord>[1], previous: Parameters<typeof evaluateRecord>[2] = "PENDING") =>
    evaluateRecord(record, outcome, previous, verification);

  it("verifies the ownership token only by exact value", () => {
    expect(evaluate(spec("OWNERSHIP"), txt(["google-site-verification=x", "zoiko-mail-verification=abc"])).state).toBe("VERIFIED");
    const other = evaluate(spec("OWNERSHIP"), txt(["google-site-verification=x"]));
    expect(other.state).toBe("MISSING");
    expect(other.diagnosis).toMatch(/none of them is this verification token/);
  });

  it("rejects the placeholder DKIM value the old screens displayed", () => {
    const result = evaluate(spec("DKIM:zm202609"), txt(["v=DKIM1; k=rsa; p=<provided by Zoiko support>"]));
    expect(result.state).toBe("MISMATCH");
    expect(evaluate(spec("DKIM:zm202609"), txt(["v=DKIM1; k=rsa; p=MIIBIj ANBgkq"])).state).toBe("VERIFIED");
    expect(evaluate(spec("DKIM:zm202609"), txt(["v=DKIM1; k=rsa; p="])).diagnosis).toMatch(/revokes the key/);
  });

  it("requires SPF to include the platform, and exactly one SPF record", () => {
    expect(evaluate(spec("SPF"), txt(["v=spf1 include:_spf.google.com ~all"])).state).toBe("MISMATCH");
    expect(evaluate(spec("SPF"), txt(["v=spf1 include:_spf.google.com include:_spf.platform.test ~all"])).state).toBe("VERIFIED");
    const two = evaluate(spec("SPF"), txt(["v=spf1 include:_spf.platform.test ~all", "v=spf1 include:_spf.google.com ~all"]));
    expect(two.state).toBe("CONFLICT");
    expect(two.diagnosis).toMatch(/permanent error/);
    expect(evaluate(spec("SPF"), txt(["v=spf1 include:_spf.platform.test +all"])).diagnosis).toMatch(/\+all/);
  });

  it("accepts a stricter DMARC policy than the generated one, and refuses two", () => {
    const stricter = evaluate(spec("DMARC"), txt(["v=DMARC1; p=reject; rua=mailto:x@acme.test"]));
    expect(stricter.state).toBe("VERIFIED");
    expect(stricter.diagnosis).toMatch(/p=reject/);
    expect(evaluate(spec("DMARC"), txt(["v=DMARC1; p=none", "v=DMARC1; p=reject"])).state).toBe("CONFLICT");
    expect(evaluate(spec("DMARC"), txt(["v=DMARC1; rua=mailto:x@acme.test"])).state).toBe("MISMATCH");
  });

  it("flags an MX that takes mail ahead of the platform", () => {
    const mx = spec("MX:mx1.platform.test");
    expect(evaluate(mx, { ok: true, values: [{ exchange: "mx1.platform.test.", priority: 10 }, { exchange: "mx2.platform.test", priority: 5 }] }).state).toBe("VERIFIED");
    const ahead = evaluate(mx, { ok: true, values: [{ exchange: "mx1.platform.test", priority: 10 }, { exchange: "aspmx.l.google.com", priority: 1 }] });
    expect(ahead.state).toBe("CONFLICT");
    expect(ahead.diagnosis).toMatch(/aspmx\.l\.google\.com/);
    expect(evaluate(mx, { ok: true, values: [{ exchange: "aspmx.l.google.com", priority: 1 }] }).state).toBe("MISMATCH");
  });

  it("treats a missing name as a verdict, and a resolver failure as no verdict", () => {
    expect(evaluate(spec("SPF"), absent).state).toBe("MISSING");
    const timeout = { ok: false as const, kind: "ERROR" as const, code: "ETIMEOUT", message: "timed out" };
    expect(evaluate(spec("SPF"), timeout, "VERIFIED").state).toBe("VERIFIED");
    expect(evaluate(spec("SPF"), timeout, "PENDING").state).toBe("LOOKUP_ERROR");
    expect(evaluate(spec("SPF"), timeout, "VERIFIED").errorCode).toBe("ETIMEOUT");
  });
});

describe("lifecycle", () => {
  const verdicts = (state: "VERIFIED" | "MISSING" | "LOOKUP_ERROR", overrides: Record<string, string> = {}) =>
    records.map((record) => ({ purpose: record.purpose, required: record.required, state: (overrides[record.purpose] ?? state) as never }));
  const now = new Date("2026-09-30T12:00:00Z");
  const base: TransitionInput = {
    status: "PENDING_VERIFICATION",
    sendingEnabled: false,
    suspendedByDns: false,
    autoActivateSending: true,
    consecutiveFailures: 0,
    readiness: readiness(verdicts("VERIFIED")),
    now,
    graceUntil: null,
    verificationDeadlineAt: new Date(now.getTime() + 3_600_000),
    threshold: 3,
  };

  it("sending readiness does not depend on MX", () => {
    const ready = readiness(verdicts("VERIFIED", { MX: "MISSING" }));
    expect(ready.sendReady).toBe(true);
    expect(ready.fullyReady).toBe(false);
    expect(ready.blocking).toEqual(["MX"]);
  });

  it("activates automatically, or stops at VERIFIED when told not to", () => {
    expect(transition(base)).toMatchObject({ status: "ACTIVE", sendingEnabled: true, events: ["VERIFIED", "AUTO_ACTIVATED"] });
    expect(transition({ ...base, autoActivateSending: false })).toMatchObject({ status: "VERIFIED", sendingEnabled: false, events: ["VERIFIED"] });
  });

  it("suspends a sending domain only after the threshold, and never in grace", () => {
    const failing = { ...base, status: "ACTIVE" as const, sendingEnabled: true, readiness: readiness(verdicts("VERIFIED", { DKIM: "MISSING" })) };
    expect(transition({ ...failing, consecutiveFailures: 0 })).toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 1, events: ["AT_RISK"] });
    expect(transition({ ...failing, consecutiveFailures: 2 })).toMatchObject({ status: "DEGRADED", sendingEnabled: false, events: ["SUSPENDED"] });
    expect(transition({ ...failing, consecutiveFailures: 9, graceUntil: new Date(now.getTime() + 1000) })).toMatchObject({ status: "ACTIVE", sendingEnabled: true });
  });

  it("does not move on resolver errors alone", () => {
    const flaky = { ...base, status: "ACTIVE" as const, sendingEnabled: true, consecutiveFailures: 2, readiness: readiness(verdicts("VERIFIED", { SPF: "LOOKUP_ERROR" })) };
    expect(transition(flaky)).toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 2, events: [] });
  });

  it("resumes a suspended domain by itself once the records pass", () => {
    expect(transition({ ...base, status: "DEGRADED", suspendedByDns: true, consecutiveFailures: 3 }))
      .toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 0, events: ["RESUMED"] });
  });

  it("fails verification only once the window has passed", () => {
    const missing = { ...base, readiness: readiness(verdicts("MISSING")) };
    expect(transition(missing).status).toBe("PENDING_VERIFICATION");
    expect(transition({ ...missing, verificationDeadlineAt: new Date(now.getTime() - 1) }))
      .toMatchObject({ status: "FAILED", events: ["VERIFICATION_FAILED"] });
  });

  it("checks fast while an owner is publishing, slowly once healthy", () => {
    const schedule = { status: "PENDING_VERIFICATION" as const, fullyReady: false, lookupErrors: false, rotationPending: false, createdAt: now, now, verifiedIntervalMs: 6 * 3_600_000 };
    expect(nextCheckDelayMs(schedule)).toBe(2 * 60_000);
    expect(nextCheckDelayMs({ ...schedule, createdAt: new Date(now.getTime() - 2 * 3_600_000) })).toBe(10 * 60_000);
    expect(nextCheckDelayMs({ ...schedule, status: "ACTIVE", fullyReady: true })).toBe(6 * 3_600_000);
    expect(nextCheckDelayMs({ ...schedule, status: "ACTIVE", fullyReady: true, lookupErrors: true })).toBe(5 * 60_000);
    expect(nextCheckDelayMs({ ...schedule, status: "FAILED" })).toBe(24 * 3_600_000);
  });
});
