import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { domainService } from "../src/modules/domain/domain.service.js";
import { runDueDomainSyncs } from "../src/modules/domain/domain.sync.js";
import { authHeader, registerUser } from "./helpers.js";
import { FakeDns } from "./dns-fakes.js";

const app = createApp();
const dns = new FakeDns();
let restoreLookup: () => void;

beforeEach(() => {
  dns.clear();
  restoreLookup = domainService.setLookupFactory(() => dns.lookup());
});
afterEach(() => restoreLookup());

/**
 * The regression contract for the two verification representations on
 * `MailDomain`: the lifecycle `status` and the legacy `verificationStatus`.
 *
 * Both are written by one `mailDomain.update` inside
 * `DomainService.synchronize`, so this file freezes exactly what that write
 * produces today. Nothing here asks which field should win — a later,
 * deliberate decision has to weigh domain lifecycle, mailbox creation,
 * frontend gating, API serialization, stored data and support tools first.
 * Until then these tests make the current relationship impossible to change
 * by accident, which is what the next phase needs before it can reason about
 * unifying them.
 *
 * What the code actually does (domain.service.ts, `aggregates` and
 * `transition`):
 *
 *   verificationStatus  ← the OWNERSHIP TXT record's state alone
 *                         VERIFIED → VERIFIED, PENDING → PENDING,
 *                         MISSING/MISMATCH/CONFLICT → FAILED
 *   status              ← the lifecycle state machine, which also weighs
 *                         SPF/DKIM/DMARC, whether sending is on, and whether
 *                         verificationDeadlineAt has passed
 *
 * So they are not meant to be equal. They agree at both ends of the journey
 * (verified, and definitively failed once the window has run out) and can
 * legitimately differ in between, because the lifecycle is waiting on a
 * deadline the ownership projection does not know about. The cases below
 * pin both the agreements and the divergence.
 */

interface ApiDomain {
  id: string;
  domainName: string;
  status: string;
  verificationStatus: string;
  sendingEnabled: boolean;
  verificationDeadlineAt: string | null;
  nextCheckAt: string | null;
  records: Array<{
    recordKey: string;
    purpose: string;
    type: "TXT" | "MX" | "CNAME";
    name: string;
    fqdn: string;
    value: string;
    priority: number | null;
    state: string;
    required: boolean;
  }>;
  dkimKeys: Array<{ id: string; selector: string; status: string }>;
  readiness: { sendReady: boolean; fullyReady: boolean; blocking: string[] };
}

async function ownerWithDomain(email: string, body: Record<string, unknown> = {}) {
  const owner = await registerUser(app, { email });
  const created = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName: `${email.split("@")[0]}.example.test`, ...body })
    .expect(201);
  return { owner, domain: created.body.data as ApiDomain };
}

async function diagnose(accessToken: string, domainId: string): Promise<ApiDomain> {
  return (await request(app)
    .post(`/api/v1/domains/${domainId}/diagnostics`)
    .set(authHeader(accessToken))
    .expect(200)).body.data;
}

/** Makes a domain due and lets the scheduler take it, as production does. */
async function scheduledSync(domainId: string) {
  await prisma.mailDomain.update({ where: { id: domainId }, data: { nextCheckAt: new Date(Date.now() - 1000) } });
  return runDueDomainSyncs();
}

const row = (id: string) => prisma.mailDomain.findUniqueOrThrow({ where: { id }, include: { records: true } });

const auditTypes = async (tenantId: string) =>
  (await prisma.auditEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } })).map((event) => event.eventType);

/** The pair as the database holds it — one source, never a partial write. */
async function statuses(id: string) {
  const found = await row(id);
  return { status: found.status, verificationStatus: found.verificationStatus };
}

describe("Case 1 — successful verification keeps both fields in step", () => {
  it("stops at VERIFIED/VERIFIED when auto-activation is off", async () => {
    const { owner, domain } = await ownerWithDomain("si-pass-manual@zoiko.test", { autoActivateSending: false });
    expect(await statuses(domain.id)).toEqual({ status: "PENDING_VERIFICATION", verificationStatus: "PENDING" });

    dns.publishAll(domain.records);
    const checked = await diagnose(owner.accessToken, domain.id);

    expect(checked.status).toBe("VERIFIED");
    expect(checked.verificationStatus).toBe("VERIFIED");
    expect(await statuses(domain.id)).toEqual({ status: "VERIFIED", verificationStatus: "VERIFIED" });

    // A verified domain is send-ready but not yet sending: the flag only
    // decides whether the transition stops here or carries on to ACTIVE.
    expect(checked.sendingEnabled).toBe(false);
    expect(checked.readiness).toMatchObject({ sendReady: true, fullyReady: true, blocking: [] });

    const stored = await row(domain.id);
    expect(stored.lastVerifiedAt).not.toBeNull();
    expect(stored.records.every((entry) => entry.state === "VERIFIED")).toBe(true);

    // `verificationStatus` followed the OWNERSHIP record, and the lifecycle
    // reached the matching end state in the same write.
    expect(stored.verificationStatus).toBe("VERIFIED");
    expect(stored.status).toBe("VERIFIED");

    expect(await auditTypes(owner.tenantId)).toEqual(expect.arrayContaining(["DOMAIN_VERIFIED"]));
  });

  it("carries the default auto-activation on to ACTIVE/VERIFIED", async () => {
    const { owner, domain } = await ownerWithDomain("si-pass-auto@zoiko.test");
    dns.publishAll(domain.records);
    const checked = await diagnose(owner.accessToken, domain.id);

    // The shipped default: sending turns on the moment everything passes.
    // `status` is ACTIVE rather than VERIFIED, but `verificationStatus` is
    // the same VERIFIED it was above — the two fields are not interchangeable.
    expect(checked.status).toBe("ACTIVE");
    expect(checked.verificationStatus).toBe("VERIFIED");
    expect(await statuses(domain.id)).toEqual({ status: "ACTIVE", verificationStatus: "VERIFIED" });
    expect(checked.sendingEnabled).toBe(true);

    expect(await auditTypes(owner.tenantId)).toEqual(
      expect.arrayContaining(["DOMAIN_VERIFIED", "DOMAIN_SENDING_ACTIVATED"])
    );
  });
});

describe("Case 2 — verification failure keeps both fields in step", () => {
  it("reports FAILED/FAILED once the window has run out", async () => {
    const { owner, domain } = await ownerWithDomain("si-fail@zoiko.test");
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });

    // Nothing published: every required record is MISSING, a definitive
    // answer, and the deadline is behind us.
    const checked = await diagnose(owner.accessToken, domain.id);

    expect(checked.status).toBe("FAILED");
    expect(checked.verificationStatus).toBe("FAILED");
    expect(await statuses(domain.id)).toEqual({ status: "FAILED", verificationStatus: "FAILED" });
    expect(checked.sendingEnabled).toBe(false);
    expect(checked.readiness.blocking).toContain("OWNERSHIP");

    const snapshot = await prisma.domainDnsCheck.findFirstOrThrow({
      where: { tenantId: owner.tenantId, domainId: domain.id },
    });
    expect(snapshot).toMatchObject({ resultStatus: "FAILED", verificationStatus: "FAILED" });

    expect(await auditTypes(owner.tenantId)).toContain("DOMAIN_VERIFICATION_FAILED");
  });

  it("keeps the two fields apart while the window is still open", async () => {
    const { owner, domain } = await ownerWithDomain("si-window@zoiko.test");
    // The deadline is in the future, so the lifecycle has nothing definitive
    // to conclude yet — but the ownership lookup has already answered, and
    // `verificationStatus` reports that answer immediately.
    const checked = await diagnose(owner.accessToken, domain.id);

    expect(checked.status).toBe("PENDING_VERIFICATION");
    expect(checked.verificationStatus).toBe("FAILED");
    expect(await statuses(domain.id)).toEqual({
      status: "PENDING_VERIFICATION",
      verificationStatus: "FAILED",
    });
    // Not the failure event: the window has not been missed.
    expect(await auditTypes(owner.tenantId)).not.toContain("DOMAIN_VERIFICATION_FAILED");
  });
});

describe("Case 3 — PR #46 manual re-check of a timed-out domain", () => {
  it("restarts the window and leaves the ownership projection alone", async () => {
    const { owner, domain } = await ownerWithDomain("si-recheck@zoiko.test");
    const originalDeadline = new Date(Date.now() - 3_600_000);
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { status: "FAILED", verificationDeadlineAt: originalDeadline },
    });

    const rechecked = await diagnose(owner.accessToken, domain.id);

    // The intended relationship after PR #46, pinned exactly as implemented:
    //
    //   status                 FAILED → PENDING_VERIFICATION (window restarted)
    //   verificationStatus     FAILED → FAILED (DNS is still wrong, and this
    //                            field only ever reports the ownership record)
    //   verificationDeadlineAt extended by the configured window
    //   nextCheckAt            back on the fast PENDING_VERIFICATION schedule
    //
    // The divergence is the point of the restart: the lifecycle is willing to
    // look again while the ownership projection still says the record is not
    // there. This test exists so that behaviour cannot drift unnoticed.
    expect(rechecked.status).toBe("PENDING_VERIFICATION");
    expect(rechecked.verificationStatus).toBe("FAILED");
    expect(await statuses(domain.id)).toEqual({
      status: "PENDING_VERIFICATION",
      verificationStatus: "FAILED",
    });

    const restarted = new Date(rechecked.verificationDeadlineAt ?? 0).getTime();
    expect(restarted).toBeGreaterThan(Date.now() + 70 * 3_600_000);
    expect(restarted).toBeGreaterThan(originalDeadline.getTime());

    // Fresh window means the fast schedule, not the FAILED daily one: a domain
    // younger than an hour is looked at every couple of minutes.
    const delay = new Date(rechecked.nextCheckAt ?? 0).getTime() - Date.now();
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(2 * 60_000 + 5_000);

    expect(await auditTypes(owner.tenantId)).toContain("DOMAIN_VERIFICATION_RESTARTED");
    // The failure is not re-announced by the re-check itself.
    expect((await auditTypes(owner.tenantId)).filter((type) => type === "DOMAIN_VERIFICATION_FAILED")).toHaveLength(0);
  });
});

describe("Case 4 — successful recovery from FAILED", () => {
  it("returns to VERIFIED/VERIFIED once the records are published", async () => {
    const { owner, domain } = await ownerWithDomain("si-recover@zoiko.test", { autoActivateSending: false });
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { status: "FAILED", verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });
    await diagnose(owner.accessToken, domain.id);
    expect(await statuses(domain.id)).toMatchObject({ status: "PENDING_VERIFICATION", verificationStatus: "FAILED" });

    dns.publishAll(domain.records);
    const recovered = await diagnose(owner.accessToken, domain.id);

    expect(recovered.status).toBe("VERIFIED");
    expect(recovered.verificationStatus).toBe("VERIFIED");
    expect(await statuses(domain.id)).toEqual({ status: "VERIFIED", verificationStatus: "VERIFIED" });

    const stored = await row(domain.id);
    expect(stored.lastVerifiedAt).not.toBeNull();
    expect(await auditTypes(owner.tenantId)).toEqual(
      expect.arrayContaining(["DOMAIN_VERIFICATION_RESTARTED", "DOMAIN_VERIFIED"])
    );
  });

  it("recovers to ACTIVE/VERIFIED with auto-activation on", async () => {
    const { owner, domain } = await ownerWithDomain("si-recover-auto@zoiko.test");
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { status: "FAILED", verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });
    await diagnose(owner.accessToken, domain.id);

    dns.publishAll(domain.records);
    const recovered = await diagnose(owner.accessToken, domain.id);

    expect(recovered.status).toBe("ACTIVE");
    expect(recovered.verificationStatus).toBe("VERIFIED");
    expect(await statuses(domain.id)).toEqual({ status: "ACTIVE", verificationStatus: "VERIFIED" });
  });
});

describe("Case 5 — mailbox creation guard", () => {
  async function workspace(suffix: string) {
    const owner = await registerUser(app, { email: `si-box-${suffix}-owner@zoiko.test` });
    const email = `si-box-${suffix}-member@external-signup.test`;
    await registerUser(app, { email });
    const added = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email, role: "MEMBER" })
      .expect(201);
    return { owner, membershipId: added.body.data.id as string, email };
  }

  const createMailbox = (token: string, body: Record<string, unknown>) =>
    request(app).post("/api/v1/mail/admin/mailboxes").set(authHeader(token)).send(body);

  /** A domain in this workspace — the guard scopes its lookup to the tenant. */
  const addDomain = async (token: string, local: string) => {
    const created = await request(app)
      .post("/api/v1/domains")
      .set(authHeader(token))
      .send({ domainName: `${local}.example.test` })
      .expect(201);
    return created.body.data as ApiDomain;
  };

  it("refuses every unverified lifecycle state and accepts the verified one", async () => {
    const w = await workspace("guard");

    // ── never checked: PENDING / PENDING_VERIFICATION ──────────────────────
    const untouched = await addDomain(w.owner.accessToken, "si-box-untouched");
    expect(await statuses(untouched.id)).toEqual({
      status: "PENDING_VERIFICATION",
      verificationStatus: "PENDING",
    });
    const pending = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId: untouched.id,
      localPart: "dana",
    }).expect(409);
    expect(pending.body.error.code).toBe("CONFLICT");
    expect(pending.body.error.details.reason).toBe("DOMAIN_NOT_VERIFIED");
    expect(pending.body.error.message).toContain("si-box-untouched.example.test");

    // ── window missed: FAILED / FAILED ─────────────────────────────────────
    // The status stays PENDING_VERIFICATION here on purpose: leaving it there
    // is what makes the check conclude FAILED rather than reopen the window.
    const missed = await addDomain(w.owner.accessToken, "si-box-missed");
    await prisma.mailDomain.update({
      where: { id: missed.id },
      data: { verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });
    await diagnose(w.owner.accessToken, missed.id);
    expect(await statuses(missed.id)).toEqual({ status: "FAILED", verificationStatus: "FAILED" });

    const refused = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId: missed.id,
      localPart: "dana",
    }).expect(409);
    expect(refused.body.error.code).toBe("CONFLICT");
    expect(refused.body.error.details.reason).toBe("DOMAIN_NOT_VERIFIED");
    expect(refused.body.error.message).toContain("si-box-missed.example.test");

    // ── restarted window: PENDING_VERIFICATION / FAILED ────────────────────
    // The field the guard reads did not move when PR #46 reopened the window,
    // so the refusal survives the restart. That is the guard holding.
    const restarted = await addDomain(w.owner.accessToken, "si-box-restart");
    await prisma.mailDomain.update({
      where: { id: restarted.id },
      data: { status: "FAILED", verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });
    await diagnose(w.owner.accessToken, restarted.id);
    expect(await statuses(restarted.id)).toEqual({
      status: "PENDING_VERIFICATION",
      verificationStatus: "FAILED",
    });
    const stillRefused = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId: restarted.id,
      localPart: "dana",
    }).expect(409);
    expect(stillRefused.body.error.details.reason).toBe("DOMAIN_NOT_VERIFIED");

    // ── genuinely verified ─────────────────────────────────────────────────
    const good = await addDomain(w.owner.accessToken, "si-box-good");
    dns.publishAll(good.records);
    await diagnose(w.owner.accessToken, good.id);
    expect(await statuses(good.id)).toEqual({
      status: "ACTIVE",
      verificationStatus: "VERIFIED",
    });

    const created = await createMailbox(w.owner.accessToken, {
      membershipId: w.membershipId,
      domainId: good.id,
      localPart: "dana",
    }).expect(201);
    expect(created.body.data.address).toBe("dana@si-box-good.example.test");
  });
});

describe("Phase 1C — scheduled recovery of a FAILED domain", () => {
  it("keeps to the FAILED schedule while DNS is wrong, then verifies it once DNS is right", async () => {
    const { owner, domain } = await ownerWithDomain("si-sched@zoiko.test", { autoActivateSending: false });
    await prisma.mailDomain.update({
      where: { id: domain.id },
      data: { verificationDeadlineAt: new Date(Date.now() - 3_600_000) },
    });

    // 1. The domain reaches FAILED — through the scheduler, not by hand.
    const first = await scheduledSync(domain.id);
    expect(first).toMatchObject({ claimed: 1, synchronized: 1, failed: 0 });
    expect(await statuses(domain.id)).toEqual({ status: "FAILED", verificationStatus: "FAILED" });

    // 2. The FAILED schedule: once a day, not the couple of minutes a pending
    //    domain gets. Unchanged by this phase, and asserted so it stays that
    //    way.
    const firstDelay = (await row(domain.id)).nextCheckAt!.getTime() - Date.now();
    expect(firstDelay).toBeGreaterThan(23 * 3_600_000);
    expect(firstDelay).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);
    expect(new Date((await row(domain.id)).nextCheckAt!).getTime()).toBeGreaterThan(Date.now());

    // 3. DNS stays wrong. The next scheduled pass claims it again and the
    //    failure stands — no recovery, no state churn, no lost schedule.
    const second = await scheduledSync(domain.id);
    expect(second).toMatchObject({ claimed: 1, synchronized: 1, failed: 0 });
    expect(await statuses(domain.id)).toEqual({ status: "FAILED", verificationStatus: "FAILED" });
    const secondDelay = (await row(domain.id)).nextCheckAt!.getTime() - Date.now();
    expect(secondDelay).toBeGreaterThan(23 * 3_600_000);
    expect(secondDelay).toBeLessThanOrEqual(24 * 3_600_000 + 60_000);

    // 4. DNS becomes correct.
    dns.publishAll(domain.records);

    // 5/6. The scheduler verifies it with no manual re-check in sight, and
    //      the domain lands on the correct verified state.
    const third = await scheduledSync(domain.id);
    expect(third).toMatchObject({ claimed: 1, synchronized: 1, failed: 0 });
    const recovered = await statuses(domain.id);
    expect(recovered).toEqual({ status: "VERIFIED", verificationStatus: "VERIFIED" });

    // 7. Both fields stay consistent, and the recovery was the scheduled
    //    path: the check is on record as SCHEDULED.
    const stored = await row(domain.id);
    expect(stored.status).toBe("VERIFIED");
    expect(stored.verificationStatus).toBe("VERIFIED");
    expect(stored.lastVerifiedAt).not.toBeNull();
    expect(stored.nextCheckAt!.getTime()).toBeGreaterThan(Date.now());

    const checks = await prisma.domainDnsCheck.findMany({
      where: { domainId: domain.id },
      orderBy: { checkedAt: "asc" },
    });
    expect(checks.every((check) => check.trigger === "SCHEDULED")).toBe(true);
    expect(checks.map((check) => check.resultStatus)).toEqual(["FAILED", "FAILED", "VERIFIED"]);
    expect(checks.map((check) => check.verificationStatus)).toEqual(["FAILED", "FAILED", "VERIFIED"]);

    expect(await auditTypes(owner.tenantId)).toEqual(
      expect.arrayContaining(["DOMAIN_VERIFICATION_FAILED", "DOMAIN_VERIFIED"])
    );
    expect((await auditTypes(owner.tenantId)).filter((type) => type === "DOMAIN_DNS_CHECKED")).toHaveLength(0);
  });
});
