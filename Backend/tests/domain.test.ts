import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import nodemailer from "nodemailer";
import { domainService } from "../src/modules/domain/domain.service.js";
import { dkimService } from "../src/modules/domain/dkim.service.js";
import { runDueDomainSyncs } from "../src/modules/domain/domain.sync.js";
import { clearSecretCache, getSecret } from "../src/common/secrets/secrets.js";
import { authHeader, registerUser, stepUpHeader } from "./helpers.js";
import { FakeDns } from "./dns-fakes.js";

const app = createApp();
const dns = new FakeDns();
let restoreLookup: () => void;

beforeEach(() => {
  dns.clear();
  restoreLookup = domainService.setLookupFactory(() => dns.lookup());
});
afterEach(() => restoreLookup());

interface ApiRecord {
  recordKey: string;
  purpose: string;
  type: "TXT" | "MX" | "CNAME";
  name: string;
  fqdn: string;
  value: string;
  priority: number | null;
  required: boolean;
  state: string;
  diagnosis: string | null;
  lastErrorCode: string | null;
  publishState: string;
}

async function ownerWithDomain(email: string, body: Record<string, unknown> = {}) {
  const owner = await registerUser(app, { email });
  const res = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName: `${email.split("@")[0]}.example.test`, ...body })
    .expect(201);
  return { owner, domain: res.body.data as { id: string; domainName: string; records: ApiRecord[]; dkimKeys: Array<{ id: string; selector: string; status: string }> } };
}

const record = (records: ApiRecord[], purpose: string) => records.find((entry) => entry.purpose === purpose)!;

async function diagnose(accessToken: string, domainId: string) {
  return (await request(app).post(`/api/v1/domains/${domainId}/diagnostics`).set(authHeader(accessToken)).expect(200)).body.data;
}

/** Makes a domain due and lets the scheduler take it, as production does. */
async function scheduledSync(domainId: string) {
  await prisma.mailDomain.update({ where: { id: domainId }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
  return runDueDomainSyncs();
}

async function auditTypes(tenantId: string) {
  return (await prisma.auditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })).map((event) => event.eventType);
}

describe("creating a domain generates its records", () => {
  it("issues the token, a DKIM key and every required record, and schedules the first check", async () => {
    const owner = await registerUser(app, { email: "dom-add-owner@zoiko.test" });
    const res = await request(app)
      .post("/api/v1/domains/")
      .set(authHeader(owner.accessToken))
      .send({ domainName: "Acme-Example.COM" })
      .expect(201);
    const domain = res.body.data;

    expect(domain.domainName).toBe("acme-example.com");
    expect(domain.verificationToken).toMatch(/^zoiko-mail-verification=[a-f0-9]{48}$/);
    expect(domain).toMatchObject({ sendingEnabled: false, status: "PENDING_VERIFICATION", dnsProvider: "MANUAL", receivingEnabled: true, dmarcPolicy: "NONE" });
    expect(new Date(domain.nextCheckAt).getTime()).toBeLessThanOrEqual(Date.now());

    const selector = domain.dkimKeys[0].selector;
    expect(domain.dkimKeys).toEqual([expect.objectContaining({ status: "ACTIVE", keyBits: 1024 })]);
    expect(domain.records.map((entry: ApiRecord) => entry.recordKey)).toEqual([
      "OWNERSHIP", "MX:mx1.zoikomail.test", "MX:mx2.zoikomail.test", "SPF", `DKIM:${selector}`, "DMARC",
    ]);
    expect(record(domain.records, "OWNERSHIP")).toMatchObject({ type: "TXT", name: "@", value: domain.verificationToken, state: "PENDING", required: true });
    expect(record(domain.records, "SPF").value).toBe("v=spf1 include:_spf.zoikomail.test ~all");
    expect(record(domain.records, "DMARC")).toMatchObject({ name: "_dmarc", value: "v=DMARC1; p=none; adkim=r; aspf=r" });
    const dkim = record(domain.records, "DKIM");
    // The host is relative, as DNS dashboards want it; no domain appended.
    expect(dkim.name).toBe(`${selector}._domainkey`);
    expect(dkim.value).toMatch(/^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]{150,}$/);

    // The private half is in the secret store and nowhere in the response.
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|privateKeySecretRef|secretRef/);
    const key = await prisma.domainDkimKey.findFirstOrThrow({ where: { domainId: domain.id } });
    expect(await getSecret(key.privateKeySecretRef, { purpose: "test" })).toContain("BEGIN PRIVATE KEY");

    expect(await auditTypes(owner.tenantId)).toEqual(expect.arrayContaining(["DOMAIN_ADDED", "DOMAIN_DNS_RECORDS_GENERATED"]));

    const dup = await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: "acme-example.com" }).expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");
  });

  it("validates the payload strictly", async () => {
    const owner = await registerUser(app, { email: "dom-schema-owner@zoiko.test" });
    await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domain: "wrong-key.com" }).expect(400);
    await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: "https://acme.com/x" }).expect(400);
    await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: "acme.com", dmarcPolicy: "SOMETIMES" }).expect(400);
    // Automatic publishing needs somewhere to publish to.
    const noCredential = await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: "acme.com", dnsProvider: "CLOUDFLARE" }).expect(400);
    expect(noCredential.body.error.message).toMatch(/credential/);
  });

  it("refuses the platform's own domains and domains verified by another workspace", async () => {
    const owner = await registerUser(app, { email: "dom-claim-owner@zoiko.test" });
    await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: "zoikomail.test" }).expect(400);
    await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: "evil.zoikomail.test" }).expect(400);

    const first = await ownerWithDomain("dom-claim-first@zoiko.test");
    await prisma.mailDomain.update({ where: { id: first.domain.id }, data: { verificationStatus: "VERIFIED" } });
    const taken = await request(app).post("/api/v1/domains/").set(authHeader(owner.accessToken)).send({ domainName: first.domain.domainName }).expect(409);
    expect(taken.body.error.message).toMatch(/another workspace/);
  });

  it("lists only the caller tenant's domains, with their records", async () => {
    const { owner, domain } = await ownerWithDomain("dom-list-owner@zoiko.test");
    const other = await ownerWithDomain("dom-list-other@zoiko.test");

    const res = await request(app).get("/api/v1/domains/").set(authHeader(owner.accessToken)).expect(200);
    const ids = res.body.data.domains.map((entry: { id: string }) => entry.id);
    expect(ids).toEqual([domain.id]);
    expect(ids).not.toContain(other.domain.id);
    expect(res.body.data.domains[0].records).toHaveLength(6);

    await request(app).get(`/api/v1/domains/${other.domain.id}`).set(authHeader(owner.accessToken)).expect(404);
  });
});

describe("verification", () => {
  it("verifies the exact published records, activates sending and records the check", async () => {
    const { owner, domain } = await ownerWithDomain("dom-diag-owner@zoiko.test");
    dns.publishAll(domain.records);

    const result = await diagnose(owner.accessToken, domain.id);
    expect(result).toMatchObject({
      status: "ACTIVE",
      sendingEnabled: true,
      verificationStatus: "VERIFIED",
      mxStatus: "VALID",
      spfStatus: "VALID",
      dkimStatus: "VALID",
      dmarcStatus: "VALID",
      readiness: { sendReady: true, fullyReady: true, blocking: [] },
    });
    expect(result.records.every((entry: ApiRecord) => entry.state === "VERIFIED")).toBe(true);

    const snapshot = await prisma.domainDnsCheck.findFirstOrThrow({ where: { tenantId: owner.tenantId, domainId: domain.id } });
    expect(snapshot).toMatchObject({ trigger: "MANUAL", resultStatus: "ACTIVE", verificationStatus: "VERIFIED" });
    expect(snapshot.results).toHaveLength(6);

    expect(await auditTypes(owner.tenantId)).toEqual(expect.arrayContaining(["DOMAIN_DNS_CHECKED", "DOMAIN_VERIFIED", "DOMAIN_SENDING_ACTIVATED"]));
    const notice = await prisma.notification.findFirstOrThrow({ where: { tenantId: owner.tenantId, userId: owner.userId } });
    expect(notice.title).toMatch(/is ready/);
  });

  it("rejects the placeholder values the old screens told owners to publish", async () => {
    const { owner, domain } = await ownerWithDomain("dom-placeholder-owner@zoiko.test");
    const dkim = record(domain.records, "DKIM");
    dns.publishAll(domain.records.filter((entry) => entry.purpose === "OWNERSHIP" || entry.purpose === "MX" || entry.purpose === "DMARC"));
    dns.add("TXT", domain.domainName, "v=spf1 include:zoiko.dev ~all");
    dns.add("TXT", dkim.fqdn, "v=DKIM1; k=rsa; p=<provided by Zoiko support>");

    const result = await diagnose(owner.accessToken, domain.id);
    expect(record(result.records, "SPF")).toMatchObject({ state: "MISMATCH" });
    expect(record(result.records, "SPF").diagnosis).toMatch(/include:_spf\.zoikomail\.test/);
    expect(record(result.records, "DKIM")).toMatchObject({ state: "MISMATCH" });
    expect(result).toMatchObject({ sendingEnabled: false, status: "PENDING_VERIFICATION", spfStatus: "INVALID", dkimStatus: "INVALID" });
    expect(result.readiness.blocking).toEqual(["SPF", "DKIM"]);

    const refused = await request(app).post(`/api/v1/domains/${domain.id}/activate`).set(authHeader(owner.accessToken)).expect(409);
    expect(refused.body.error.message).toMatch(/SPF, DKIM/);
  });

  it("reports missing records with the resolver's reason and keeps sending disabled", async () => {
    const { owner, domain } = await ownerWithDomain("dom-diagfail-owner@zoiko.test");
    const result = await diagnose(owner.accessToken, domain.id);
    expect(result).toMatchObject({ verificationStatus: "FAILED", mxStatus: "INVALID", spfStatus: "INVALID", dkimStatus: "INVALID", dmarcStatus: "INVALID", sendingEnabled: false });
    expect(result.errorDetails.txt.code).toBe("ENOTFOUND");
    expect(result.errorDetails.mx).toBeDefined();
    expect(result.errorDetails.dkim).toBeDefined();
    expect(result.errorDetails.dmarc).toBeDefined();
    expect(result.records.every((entry: ApiRecord) => entry.state === "MISSING")).toBe(true);
  });

  it("gives a timed-out domain a fresh window when an admin re-checks it", async () => {
    const { owner, domain } = await ownerWithDomain("dom-restart-owner@zoiko.test");
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { status: "FAILED", verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });

    // Still nothing published: back to the fast schedule, not FAILED again.
    const pending = await diagnose(owner.accessToken, domain.id);
    expect(pending.status).toBe("PENDING_VERIFICATION");
    expect(new Date(pending.verificationDeadlineAt).getTime()).toBeGreaterThan(Date.now() + 70 * 3_600_000);
    expect(new Date(pending.nextCheckAt).getTime() - Date.now()).toBeLessThanOrEqual(2 * 60_000);
    expect(await auditTypes(owner.tenantId)).toContain("DOMAIN_VERIFICATION_RESTARTED");

    // Published: verifies on the next re-check.
    dns.publishAll(domain.records);
    expect((await diagnose(owner.accessToken, domain.id)).status).toBe("ACTIVE");
  });

  it("stops an admin re-checking faster than the cooldown", async () => {
    const { owner, domain } = await ownerWithDomain("dom-cooldown-owner@zoiko.test");
    const previous = env.DNS_MANUAL_CHECK_COOLDOWN_MS;
    (env as { DNS_MANUAL_CHECK_COOLDOWN_MS: number }).DNS_MANUAL_CHECK_COOLDOWN_MS = 60_000;
    try {
      await diagnose(owner.accessToken, domain.id);
      const again = await request(app).post(`/api/v1/domains/${domain.id}/diagnostics`).set(authHeader(owner.accessToken)).expect(429);
      expect(again.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    } finally {
      (env as { DNS_MANUAL_CHECK_COOLDOWN_MS: number }).DNS_MANUAL_CHECK_COOLDOWN_MS = previous;
    }
  });

  it("upgrades a domain created before records were generated", async () => {
    const owner = await registerUser(app, { email: "dom-legacy-owner@zoiko.test" });
    const legacy = await prisma.mailDomain.create({
      data: { tenantId: owner.tenantId, domainName: "legacy.example.test", verificationToken: "zoiko-mail-verification=deadbeef" },
    });
    const result = await diagnose(owner.accessToken, legacy.id);
    expect(result.records.map((entry: ApiRecord) => entry.purpose)).toEqual(["OWNERSHIP", "MX", "MX", "SPF", "DKIM", "DMARC"]);
    expect(result.dkimKeys).toEqual([expect.objectContaining({ status: "ACTIVE" })]);
    expect(await auditTypes(owner.tenantId)).toContain("DOMAIN_DNS_RECORDS_GENERATED");
  });
});

describe("ongoing synchronization", () => {
  async function activeDomain(email: string) {
    const setup = await ownerWithDomain(email);
    dns.publishAll(setup.domain.records);
    await diagnose(setup.owner.accessToken, setup.domain.id);
    return setup;
  }

  it("suspends sending after repeated definitive failures, and resumes by itself", async () => {
    const { owner, domain } = await activeDomain("dom-suspend-owner@zoiko.test");
    const dkim = record(domain.records, "DKIM");
    dns.set("TXT", dkim.fqdn, []);

    await scheduledSync(domain.id);
    let row = await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id } });
    expect(row).toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 1 });

    await scheduledSync(domain.id);
    await scheduledSync(domain.id);
    row = await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id } });
    expect(row).toMatchObject({ status: "DEGRADED", sendingEnabled: false, dkimStatus: "INVALID" });
    expect(row.suspensionReason).toMatch(/DKIM/);
    expect(row.sendingSuspendedAt).not.toBeNull();

    dns.add("TXT", dkim.fqdn, dkim.value);
    const run = await scheduledSync(domain.id);
    expect(run).toMatchObject({ claimed: 1, synchronized: 1, failed: 0 });
    row = await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id } });
    expect(row).toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 0, sendingSuspendedAt: null });

    const types = await auditTypes(owner.tenantId);
    expect(types.filter((type) => type === "DOMAIN_SENDING_AT_RISK")).toHaveLength(1);
    expect(types).toEqual(expect.arrayContaining(["DOMAIN_DNS_RECORD_CHANGED", "DOMAIN_SENDING_SUSPENDED", "DOMAIN_SENDING_RESUMED"]));
    const titles = (await prisma.notification.findMany({ where: { tenantId: owner.tenantId } })).map((entry) => entry.title);
    expect(titles).toEqual(expect.arrayContaining([expect.stringMatching(/Sending suspended/), expect.stringMatching(/Sending resumed/)]));
  });

  it("does not suspend on resolver failures", async () => {
    const { domain } = await activeDomain("dom-flaky-owner@zoiko.test");
    dns.failures.set(record(domain.records, "DKIM").fqdn, "ESERVFAIL");
    for (let run = 0; run < 4; run += 1) await scheduledSync(domain.id);

    const row = await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id }, include: { records: true } });
    expect(row).toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 0 });
    // The verdict stands; the failure is recorded beside it.
    expect(row.records.find((entry) => entry.purpose === "DKIM")).toMatchObject({ state: "VERIFIED", lastErrorCode: "ESERVFAIL" });
    // Looked at again soon, not in six hours.
    expect(row.nextCheckAt!.getTime() - Date.now()).toBeLessThan(6 * 60_000);
  });

  it("does not suspend inside the grace window", async () => {
    const { domain } = await activeDomain("dom-grace-owner@zoiko.test");
    await prisma.mailDomain.update({ where: { id: domain.id }, data: { graceUntil: new Date(Date.now() + 3_600_000) } });
    dns.set("TXT", record(domain.records, "SPF").fqdn, []);
    for (let run = 0; run < 5; run += 1) await scheduledSync(domain.id);
    expect(await prisma.mailDomain.findUniqueOrThrow({ where: { id: domain.id } })).toMatchObject({ status: "ACTIVE", sendingEnabled: true, consecutiveFailures: 5 });
  });

  it("claims only due custom domains, across workspaces", async () => {
    const due = await ownerWithDomain("dom-due-owner@zoiko.test");
    const later = await ownerWithDomain("dom-later-owner@zoiko.test");
    await prisma.mailDomain.update({ where: { id: later.domain.id }, data: { nextCheckAt: new Date(Date.now() + 3_600_000) } });
    await prisma.mailDomain.create({
      data: { tenantId: later.owner.tenantId, domainName: "platform-owned.test", type: "ZOIKO", verificationToken: "x", nextCheckAt: new Date(0) },
    });

    const result = await scheduledSync(due.domain.id);
    expect(result).toMatchObject({ claimed: 1, synchronized: 1, failed: 0 });
    const checked = await prisma.mailDomain.findUniqueOrThrow({ where: { id: due.domain.id } });
    expect(checked.lastCheckedAt).not.toBeNull();
    expect(checked.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.mailDomain.findUniqueOrThrow({ where: { id: later.domain.id } })).lastCheckedAt).toBeNull();
    expect(await prisma.domainDnsCheck.findFirst({ where: { domainId: due.domain.id, trigger: "SCHEDULED" } })).not.toBeNull();
  });
});

describe("configuration and lifecycle", () => {
  it("regenerates records when the configuration changes", async () => {
    const { owner, domain } = await ownerWithDomain("dom-config-owner@zoiko.test");
    dns.publishAll(domain.records);
    await diagnose(owner.accessToken, domain.id);

    const res = await request(app)
      .patch(`/api/v1/domains/${domain.id}`)
      .set(authHeader(owner.accessToken))
      .send({ receivingEnabled: false, dmarcPolicy: "REJECT", dmarcReportEmail: "Reports@Example.test" })
      .expect(200);
    const updated = res.body.data;
    expect(updated.records.some((entry: ApiRecord) => entry.purpose === "MX")).toBe(false);
    expect(record(updated.records, "DMARC")).toMatchObject({ value: "v=DMARC1; p=reject; rua=mailto:reports@example.test; adkim=r; aspf=r", state: "PENDING" });
    // Unchanged records keep their verdict.
    expect(record(updated.records, "SPF").state).toBe("VERIFIED");
    expect(updated.configVersion).toBeGreaterThan(1);
    expect(new Date(updated.nextCheckAt).getTime()).toBeLessThanOrEqual(Date.now());

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: owner.tenantId, eventType: "DOMAIN_CONFIG_UPDATED" } });
    expect(audit.beforeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.afterHash).not.toBe(audit.beforeHash);

    await request(app).patch(`/api/v1/domains/${domain.id}`).set(authHeader(owner.accessToken)).send({}).expect(400);
  });

  it("stops at VERIFIED when auto-activation is off, and deactivation sticks", async () => {
    const { owner, domain } = await ownerWithDomain("dom-manual-owner@zoiko.test", { autoActivateSending: false });
    dns.publishAll(domain.records);
    expect(await diagnose(owner.accessToken, domain.id)).toMatchObject({ status: "VERIFIED", sendingEnabled: false });

    const activated = await request(app).post(`/api/v1/domains/${domain.id}/activate`).set(authHeader(owner.accessToken)).expect(200);
    expect(activated.body.data).toMatchObject({ sendingEnabled: true, status: "ACTIVE" });

    const off = await request(app).post(`/api/v1/domains/${domain.id}/deactivate`).set(authHeader(owner.accessToken)).expect(200);
    expect(off.body.data).toMatchObject({ sendingEnabled: false, autoActivateSending: false, status: "VERIFIED" });
    // A passing check must not switch it straight back on.
    expect(await diagnose(owner.accessToken, domain.id)).toMatchObject({ sendingEnabled: false, status: "VERIFIED" });
    await request(app).post(`/api/v1/domains/${domain.id}/deactivate`).set(authHeader(owner.accessToken)).expect(409);
  });

  it("rotates DKIM without a moment unsigned", async () => {
    const { owner, domain } = await ownerWithDomain("dom-rotate-owner@zoiko.test");
    dns.publishAll(domain.records);
    await diagnose(owner.accessToken, domain.id);
    const oldKey = domain.dkimKeys[0]!;

    const started = (await request(app).post(`/api/v1/domains/${domain.id}/dkim/rotate`).set(authHeader(owner.accessToken)).expect(200)).body.data;
    const newKey = started.dkimKeys.find((key: { status: string }) => key.status === "PENDING");
    expect(newKey.selector).not.toBe(oldKey.selector);
    const newRecord = started.records.find((entry: ApiRecord) => entry.recordKey === `DKIM:${newKey.selector}`);
    expect(newRecord).toMatchObject({ required: false, state: "PENDING" });
    await request(app).post(`/api/v1/domains/${domain.id}/dkim/rotate`).set(authHeader(owner.accessToken)).expect(409);

    // Not published yet: the old key keeps signing.
    let result = await diagnose(owner.accessToken, domain.id);
    expect(result.dkimKeys.map((key: { status: string }) => key.status)).toEqual(["ACTIVE", "PENDING"]);
    expect(result.sendingEnabled).toBe(true);

    dns.add("TXT", newRecord.fqdn, newRecord.value);
    result = await diagnose(owner.accessToken, domain.id);
    expect(Object.fromEntries(result.dkimKeys.map((key: { selector: string; status: string }) => [key.selector, key.status])))
      .toEqual({ [oldKey.selector]: "RETIRING", [newKey.selector]: "ACTIVE" });
    expect(result.records.find((entry: ApiRecord) => entry.recordKey === `DKIM:${newKey.selector}`).required).toBe(true);
    expect(result.records.find((entry: ApiRecord) => entry.recordKey === `DKIM:${oldKey.selector}`).required).toBe(false);
    expect(result.sendingEnabled).toBe(true);

    // After the grace period the old key and its record go.
    await prisma.domainDkimKey.update({ where: { id: oldKey.id }, data: { retiringAt: new Date(Date.now() - env.DNS_DKIM_RETIRE_GRACE_MS - 1000) } });
    result = await diagnose(owner.accessToken, domain.id);
    expect(result.records.some((entry: ApiRecord) => entry.recordKey === `DKIM:${oldKey.selector}`)).toBe(false);
    const retired = await prisma.domainDkimKey.findUniqueOrThrow({ where: { id: oldKey.id } });
    expect(retired.status).toBe("RETIRED");
    clearSecretCache();
    await expect(getSecret(retired.privateKeySecretRef, { purpose: "test" })).rejects.toThrow(/Secret not available/);
    expect(await auditTypes(owner.tenantId)).toEqual(expect.arrayContaining(["DOMAIN_DKIM_ROTATION_STARTED", "DOMAIN_DKIM_ROTATED", "DOMAIN_DKIM_KEY_RETIRED"]));
  });

  it("hands out the signing key only once the domain is sending, and it produces a real signature", async () => {
    const { owner, domain } = await ownerWithDomain("dom-sign-owner@zoiko.test");
    expect(await dkimService.signingKeyFor(owner.tenantId, domain.domainName)).toBeNull();

    dns.publishAll(domain.records);
    await diagnose(owner.accessToken, domain.id);
    const key = await dkimService.signingKeyFor(owner.tenantId, domain.domainName.toUpperCase());
    expect(key).toMatchObject({ domainName: domain.domainName, keySelector: domain.dkimKeys[0]!.selector });

    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({ from: `a@${domain.domainName}`, to: "b@example.net", subject: "Signed", text: "hello", dkim: key! });
    const signature = /^DKIM-Signature:[\s\S]*?(?=\r\n\S)/m.exec(String(info.message))?.[0] ?? "";
    expect(signature).toContain(`d=${domain.domainName}`);
    expect(signature).toContain(`s=${domain.dkimKeys[0]!.selector}`);

    // Another workspace cannot borrow it.
    const stranger = await registerUser(app, { email: "dom-sign-stranger@zoiko.test" });
    expect(await dkimService.signingKeyFor(stranger.tenantId, domain.domainName)).toBeNull();
  });

  it("serves the records as an importable zone file", async () => {
    const { owner, domain } = await ownerWithDomain("dom-zone-owner@zoiko.test");
    const res = await request(app).get(`/api/v1/domains/${domain.id}/zone-file`).set(authHeader(owner.accessToken)).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.headers["content-disposition"]).toContain(`${domain.domainName}.zone`);
    expect(res.text).toContain(`$ORIGIN ${domain.domainName}.`);
    expect(res.text).toContain("IN\tMX\t10\tmx1.zoikomail.test.");
  });

  it("refuses activation until all checks pass, then enables sending", async () => {
    const { owner, domain } = await ownerWithDomain("dom-activate-owner@zoiko.test");
    await request(app).post(`/api/v1/domains/${domain.id}/activate`).set(authHeader(owner.accessToken)).expect(409);
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { verificationStatus: "VERIFIED", mxStatus: "VALID", spfStatus: "VALID", dkimStatus: "VALID", dmarcStatus: "VALID" },
    });
    const res = await request(app).post(`/api/v1/domains/${domain.id}/activate`).set(authHeader(owner.accessToken)).expect(200);
    expect(res.body.data.sendingEnabled).toBe(true);
    expect(res.body.data.activatedAt).not.toBeNull();
  });

  it("returns check history newest-first", async () => {
    const { owner, domain } = await ownerWithDomain("dom-history-owner@zoiko.test");
    await prisma.domainDnsCheck.createMany({
      data: [
        { tenantId: owner.tenantId, domainId: domain.id, verificationStatus: "FAILED", mxStatus: "INVALID", spfStatus: "INVALID", dkimStatus: "INVALID", dmarcStatus: "INVALID", checkedAt: new Date(Date.now() - 3600_000) },
        { tenantId: owner.tenantId, domainId: domain.id, verificationStatus: "VERIFIED", mxStatus: "VALID", spfStatus: "VALID", dkimStatus: "VALID", dmarcStatus: "VALID", checkedAt: new Date() },
      ],
    });
    const checks = (await request(app).get(`/api/v1/domains/${domain.id}/checks`).set(authHeader(owner.accessToken)).expect(200)).body.data.checks;
    expect(checks).toHaveLength(2);
    expect(checks[0].verificationStatus).toBe("VERIFIED");
    expect(checks[1].verificationStatus).toBe("FAILED");
  });

  it("deletes inactive domains with their records and keys, but blocks active ones", async () => {
    const active = await ownerWithDomain("dom-del-active@zoiko.test");
    await prisma.mailDomain.update({ where: { id: active.domain.id }, data: { sendingEnabled: true } });
    const inactive = await ownerWithDomain("dom-del-inactive@zoiko.test");
    const key = await prisma.domainDkimKey.findFirstOrThrow({ where: { domainId: inactive.domain.id } });

    await request(app).delete(`/api/v1/domains/${active.domain.id}`).set(authHeader(active.owner.accessToken)).set(await stepUpHeader(app, active.owner.accessToken)).expect(409);
    const res = await request(app).delete(`/api/v1/domains/${inactive.domain.id}`).set(authHeader(inactive.owner.accessToken)).set(await stepUpHeader(app, inactive.owner.accessToken)).expect(200);
    expect(res.body.data.domainName).toBe(inactive.domain.domainName);

    expect(await prisma.mailDomain.findUnique({ where: { id: inactive.domain.id } })).toBeNull();
    expect(await prisma.domainDnsRecord.count({ where: { domainId: inactive.domain.id } })).toBe(0);
    expect(await prisma.domainDkimKey.count({ where: { domainId: inactive.domain.id } })).toBe(0);
    clearSecretCache();
    await expect(getSecret(key.privateKeySecretRef, { purpose: "test" })).rejects.toThrow(/Secret not available/);

    await request(app).delete(`/api/v1/domains/${inactive.domain.id}`).set(authHeader(inactive.owner.accessToken)).set(await stepUpHeader(app, inactive.owner.accessToken)).expect(404);
  });

  it("forbids members from managing domains", async () => {
    const owner = await registerUser(app, { email: "dom-rbac-owner@zoiko.test" });
    const member = await registerUser(app, { email: "dom-rbac-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login").send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const token = login.body.data.session.accessToken;

    await request(app).get("/api/v1/domains/").set(authHeader(token)).expect(403);
    await request(app).post("/api/v1/domains/").set(authHeader(token)).send({ domainName: "nope.zoiko.test" }).expect(403);
    await request(app).get("/api/v1/domains/dns-providers").set(authHeader(token)).expect(403);
  });
});
