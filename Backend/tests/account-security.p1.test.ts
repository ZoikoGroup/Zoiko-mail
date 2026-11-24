import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/common/utils/password.js";
import { IngestService } from "../src/modules/mail-ingest/ingest.service.js";
import { securityAlertService } from "../src/modules/security-alert/security-alert.service.js";
import { authHeader, loginUser, registerUser, stepUpHeader, type RegisteredUser } from "./helpers.js";
import { mimeMessage } from "./fixtures/threat-fixtures.js";

/**
 * P1 acceptance — identity, tenant isolation and account protection (ZM-05).
 *
 * Mapped to the Security Foundation Handoff (ZM-SEC-HO-001 §14) and the
 * Master Architecture (ZS-ZM-ENG-003 §13):
 *   ZMT-17  signup / invite / role change never yields OWNER or crosses tenants
 *   ZMT-18  a revoked grant or session fails on the next request, everywhere
 *   ZMT-19  a dangerous forwarding rule raises an event with a safe remediation
 *   ZMT-21  cross-tenant isolation on every new route
 *   A07/A08 delegation and suspicious-rule changes are scoped events and cases
 *   S05     privileged actions are refused server-side, not just hidden
 */

const app = createApp();
const PASSWORD = "Password123!";
const INBOUND_SECRET = "p1-inbound-secret-0123456789abcdef0123456789";
const mutableEnv = env as unknown as Record<string, unknown>;
let savedSecret: unknown;
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;
const key = () => ({ "Idempotency-Key": `p1-${randomUUID()}` });

beforeEach(() => {
  savedSecret = mutableEnv.INBOUND_WEBHOOK_SECRET;
  mutableEnv.INBOUND_WEBHOOK_SECRET = INBOUND_SECRET;
});
afterEach(() => {
  mutableEnv.INBOUND_WEBHOOK_SECRET = savedSecret;
});

// ── fixtures ────────────────────────────────────────────────────────────────

async function owner(): Promise<RegisteredUser> {
  return registerUser(app, { email: `${unique("p1-owner")}@zoiko.test` });
}

/** A second, independent sign-in for an account: another device. */
async function signInAgain(user: { email: string; tenantId: string }) {
  const session = await loginUser(app, user.email, PASSWORD, user.tenantId);
  return { accessToken: session.accessToken as string, refreshToken: session.refreshToken as string };
}

const sid = (accessToken: string) => (jwt.decode(accessToken) as { sid: string }).sid;

/** A colleague added by the owner; signs in to the console their role opens. */
async function colleague(boss: RegisteredUser, role: "MEMBER" | "ADMIN") {
  const email = `${unique(`p1-${role.toLowerCase()}`)}@personal.test`;
  await prisma.appUser.create({
    data: { email, displayName: `P1 ${role}`, passwordHash: await hashPassword(PASSWORD), status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const added = await request(app).post("/api/v1/membership/members").set(authHeader(boss.accessToken)).send({ email, role }).expect(201);
  const membershipId = added.body.data.id as string;
  const user = await prisma.appUser.findUniqueOrThrow({ where: { email } });
  const mailbox = await prisma.mailbox.create({
    data: { tenantId: boss.tenantId, membershipId, address: `${unique("mb")}@p1.test`, workspaces: ["MEMBER", "ADMIN"] },
  });
  const session = role === "MEMBER"
    ? (await request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD, tenantId: boss.tenantId, workspace: "MEMBER" }).expect(200)).body.data
    : await loginUser(app, email, PASSWORD, boss.tenantId);
  const accessToken = (session.accessToken ?? session.session?.accessToken) as string;
  expect(accessToken).toBeTruthy();
  return { email, membershipId, userId: user.id, mailboxId: mailbox.id, accessToken };
}

async function verifiedDomain(tenantId: string) {
  const domainName = `${unique("p1")}.test`;
  await prisma.mailDomain.create({
    data: {
      tenantId, domainName, type: "CUSTOM", verificationStatus: "VERIFIED", status: "ACTIVE",
      verificationToken: `zoiko-mail-verification=${unique("tok")}`,
    },
  });
  return domainName;
}

async function ownMailbox(user: RegisteredUser, domainName: string) {
  return prisma.mailbox.create({
    data: { tenantId: user.tenantId, membershipId: user.membershipId, address: `${unique("box")}@${domainName}`, workspaces: ["MEMBER", "ADMIN", "OWNER"] },
  });
}

function sessions(token: string) {
  return request(app).get("/api/v1/account-security/sessions").set(authHeader(token));
}

async function alertsOfType(tenantId: string, type: string) {
  return prisma.securityAlert.findMany({ where: { tenantId, type: type as never }, orderBy: { createdAt: "asc" } });
}

function remediate(token: string, alertId: string, action: string, headers = key()) {
  return request(app).post(`/api/v1/security-alerts/${alertId}/remediate`).set(authHeader(token)).set(headers).send({ action });
}

// ── sessions ────────────────────────────────────────────────────────────────

describe("P1 sessions — one device can be signed out (S2 §06/§09, ZMT-18)", () => {
  it("lists each sign-in once and marks the one asking as current", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    const res = await sessions(b.accessToken).expect(200);
    const list = res.body.data.sessions as Array<{ key: string; current: boolean }>;
    expect(list.map((s) => s.key).sort()).toEqual([sid(a.accessToken), sid(b.accessToken)].sort());
    expect(list.filter((s) => s.current).map((s) => s.key)).toEqual([sid(b.accessToken)]);
  });

  it("signing another device out ends it on its next request, without touching this one or crying theft", async () => {
    const a = await owner();
    const b = await signInAgain(a);

    const ended = await request(app).delete(`/api/v1/account-security/sessions/${sid(a.accessToken)}`)
      .set(authHeader(b.accessToken)).set(key()).expect(200);
    expect(ended.body.data).toEqual({ key: sid(a.accessToken), revoked: true, current: false });

    const refused = await sessions(a.accessToken).expect(401);
    expect(refused.body.error.code).toBe("SESSION_REVOKED");
    await sessions(b.accessToken).expect(200);

    // The ended device's tab tries to refresh: refused as signed out, and —
    // unlike a stolen rotated token — not escalated into ending every session.
    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: a.refreshToken }).expect(401);
    expect(refresh.body.error.code).toBe("SESSION_REVOKED");
    expect(await alertsOfType(a.tenantId, "REFRESH_TOKEN_REUSE")).toHaveLength(0);
    await sessions(b.accessToken).expect(200);

    const audit = await prisma.auditEvent.count({ where: { tenantId: a.tenantId, eventType: "SESSION_REVOKED", actorUserId: a.userId } });
    expect(audit).toBe(1);
  });

  it("keeps a session alive across a refresh: one session, and the old access token still belongs to it", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    const rotated = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: b.refreshToken }).expect(200);
    const next = rotated.body.data.accessToken as string;
    expect(sid(next)).toBe(sid(b.accessToken));
    await sessions(next).expect(200);
    await sessions(b.accessToken).expect(200);
    const list = (await sessions(next).expect(200)).body.data.sessions as Array<{ key: string }>;
    expect(list.filter((s) => s.key === sid(b.accessToken))).toHaveLength(1);
  });

  it("still treats a rotated refresh token presented again as theft", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: b.refreshToken }).expect(200);
    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: b.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).not.toBe("SESSION_REVOKED");
    expect((await alertsOfType(a.tenantId, "REFRESH_TOKEN_REUSE")).length).toBeGreaterThanOrEqual(1);
  });

  it("a password change ends every other session but keeps this one, and the others' refresh is not read as theft", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    await request(app).post("/api/v1/auth/change-password").set(authHeader(b.accessToken)).set(key())
      .send({ currentPassword: PASSWORD, newPassword: "Compliant123!" }).expect(200);

    await sessions(b.accessToken).expect(200); // the device that changed it
    const ended = await sessions(a.accessToken).expect(401);
    expect(ended.body.error.code).toBe("SESSION_REVOKED");
    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: a.refreshToken }).expect(401);
    expect(refresh.body.error.code).toBe("SESSION_REVOKED");
    expect(await alertsOfType(a.tenantId, "REFRESH_TOKEN_REUSE")).toHaveLength(0);
    // The surviving session still renews.
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: b.refreshToken }).expect(200);
  });

  it("a token this device signed out of, presented again, is still treated as theft", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    await request(app).post("/api/v1/auth/logout").send({ refreshToken: b.refreshToken }).expect(200);
    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: b.refreshToken }).expect(401);
    expect(replay.body.error.code).not.toBe("SESSION_REVOKED");
    expect((await alertsOfType(a.tenantId, "REFRESH_TOKEN_REUSE")).length).toBeGreaterThanOrEqual(1);
  });

  it("closes the signed-out device's open live-update stream, and only that one", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const open = (token: string) =>
        new Promise<{ ended: Promise<boolean> }>((resolve, reject) => {
          const req = http.get({ port, path: "/api/v1/events/stream", headers: authHeader(token) }, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`stream refused: ${res.statusCode}`));
            const ended = new Promise<boolean>((done) => {
              res.on("end", () => done(true));
              res.on("close", () => done(true));
            });
            res.once("data", () => resolve({ ended })); // CONNECTED event
            res.resume();
          });
          req.on("error", reject);
        });
      const within = (p: Promise<boolean>, ms: number) =>
        Promise.race([p, new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

      const streamA = await open(a.accessToken);
      const streamB = await open(b.accessToken);
      await request(app).delete(`/api/v1/account-security/sessions/${sid(a.accessToken)}`).set(authHeader(b.accessToken)).set(key()).expect(200);

      expect(await within(streamA.ended, 3_000)).toBe(true);
      expect(await within(streamB.ended, 500)).toBe(false);
      // And the ended device cannot open a new one.
      await expect(open(a.accessToken)).rejects.toThrow("stream refused: 401");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("answers an already-ended session as done, and never reveals another account's", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    const target = sid(a.accessToken);
    await request(app).delete(`/api/v1/account-security/sessions/${target}`).set(authHeader(b.accessToken)).set(key()).expect(200);
    const again = await request(app).delete(`/api/v1/account-security/sessions/${target}`).set(authHeader(b.accessToken)).set(key()).expect(200);
    expect(again.body.data.revoked).toBe(false);

    const stranger = await owner(); // another workspace entirely
    await request(app).delete(`/api/v1/account-security/sessions/${sid(stranger.accessToken)}`).set(authHeader(b.accessToken)).set(key()).expect(404);
    await sessions(stranger.accessToken).expect(200); // untouched
    await request(app).delete("/api/v1/account-security/sessions/not-a-session").set(authHeader(b.accessToken)).set(key()).expect(404);
    await request(app).delete(`/api/v1/account-security/sessions/row:${randomUUID()}`).set(authHeader(b.accessToken)).set(key()).expect(404);
  });

  it("needs an Idempotency-Key to end a session", async () => {
    const a = await owner();
    const res = await request(app).delete(`/api/v1/account-security/sessions/${sid(a.accessToken)}`).set(authHeader(a.accessToken))
      .set("X-Test-Omit-Idempotency-Key", "1").expect(400); // setup.ts adds a key unless told not to
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    await sessions(a.accessToken).expect(200);
  });

  it("signing out everywhere ends every token already issued, and their refresh is not read as theft", async () => {
    const a = await owner();
    const b = await signInAgain(a);
    await request(app).post("/api/v1/auth/logout-all").set(authHeader(a.accessToken)).set(key()).expect((res) => expect(res.status).toBeLessThan(300));
    expect((await sessions(a.accessToken)).status).toBe(401);
    expect((await sessions(b.accessToken)).status).toBe(401);
    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: b.refreshToken }).expect(401);
    expect(refresh.body.error.code).toBe("SESSION_REVOKED");
    expect(await alertsOfType(a.tenantId, "REFRESH_TOKEN_REUSE")).toHaveLength(0);
  });

  it("an admin's MFA reset ends the member's existing access tokens at once, not hours later", async () => {
    const boss = await owner();
    const admin = await colleague(boss, "ADMIN");
    await request(app).get("/api/v1/account-security/sessions").set(authHeader(admin.accessToken)).expect(200);
    await request(app).post(`/api/v1/membership/members/${admin.membershipId}/mfa/reset`)
      .set(authHeader(boss.accessToken)).set(await stepUpHeader(app, boss.accessToken)).set(key()).expect(200);
    const refused = await sessions(admin.accessToken).expect(401);
    expect(refused.body.error.code).toBe("TOKEN_INVALID");
  });

  it("refuses an access token that names no session", async () => {
    const a = await owner();
    const forged = jwt.sign(
      { sub: a.userId, tenantId: a.tenantId, membershipId: a.membershipId, role: "OWNER", workspace: "OWNER", type: "access" },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );
    const res = await sessions(forged).expect(401);
    expect(res.body.error.code).toBe("TOKEN_INVALID");
  });

  it("refuses an access token whose session id belongs to a different account", async () => {
    const a = await owner();
    const other = await owner();
    const borrowed = jwt.sign(
      { sub: a.userId, tenantId: a.tenantId, membershipId: a.membershipId, role: "OWNER", workspace: "OWNER", sid: sid(other.accessToken), type: "access" },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );
    expect((await sessions(borrowed)).status).toBe(401);
  });
});

// ── containment ─────────────────────────────────────────────────────────────

describe("P1 containment — an owner or admin signs an account out everywhere", () => {
  it("ends every session of the member and records who did it", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    const res = await request(app).post(`/api/v1/account-security/members/${member.membershipId}/sessions/revoke`)
      .set(authHeader(boss.accessToken)).set(key()).send({ note: "laptop stolen" }).expect(200);
    expect(res.body.data.sessionsRevoked).toBeGreaterThanOrEqual(1);
    const refused = await request(app).get("/api/v1/mail/unread-counts").set(authHeader(member.accessToken)).expect(401);
    expect(refused.body.error.code).toBe("SESSION_REVOKED");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId: boss.tenantId, eventType: "MEMBER_SESSIONS_REVOKED" } });
    expect(audit).toMatchObject({ actorUserId: boss.userId, targetId: member.membershipId });
  });

  it("lists a member's sessions for the owner, with no session marked current", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    const res = await request(app).get(`/api/v1/account-security/members/${member.membershipId}/sessions`).set(authHeader(boss.accessToken)).expect(200);
    expect(res.body.data.sessions.map((s: { key: string }) => s.key)).toEqual([sid(member.accessToken)]);
    expect(res.body.data.sessions[0].current).toBe(false);
  });

  it("does not let an admin sign the owner out", async () => {
    const boss = await owner();
    const admin = await colleague(boss, "ADMIN");
    await request(app).post(`/api/v1/account-security/members/${boss.membershipId}/sessions/revoke`)
      .set(authHeader(admin.accessToken)).set(key()).send({}).expect(403);
    await request(app).get(`/api/v1/account-security/members/${boss.membershipId}/sessions`).set(authHeader(admin.accessToken)).expect(403);
    await sessions(boss.accessToken).expect(200);
  });

  it("refuses a member using the containment routes, and hides other workspaces' memberships", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    await request(app).post(`/api/v1/account-security/members/${boss.membershipId}/sessions/revoke`)
      .set(authHeader(member.accessToken)).set(key()).send({}).expect(403);
    const elsewhere = await owner();
    await request(app).post(`/api/v1/account-security/members/${elsewhere.membershipId}/sessions/revoke`)
      .set(authHeader(boss.accessToken)).set(key()).send({}).expect(404);
    await sessions(elsewhere.accessToken).expect(200);
  });

  it("rejects fields it does not understand", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    await request(app).post(`/api/v1/account-security/members/${member.membershipId}/sessions/revoke`)
      .set(authHeader(boss.accessToken)).set(key()).send({ everywhere: true }).expect(400);
  });
});

// ── high-risk changes → alerts → remediation ────────────────────────────────

describe("ZMT-19 / A08 — forwarding outside the organisation is reported and can be contained", () => {
  it("raises a HIGH alert for an outside destination, and none for one inside the workspace", async () => {
    const boss = await owner();
    const domain = await verifiedDomain(boss.tenantId);
    const box = await ownMailbox(boss, domain);

    await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: `colleague@${domain}` }).expect(201);
    expect(await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL")).toHaveLength(0);

    const created = await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: "Collector@Elsewhere.test" }).expect(201);
    const [alert] = await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL");
    expect(alert).toMatchObject({ severity: "HIGH", status: "OPEN", actorUserId: boss.userId });
    expect(alert!.metadata).toMatchObject({ ruleId: created.body.data.id, destination: "collector@elsewhere.test", mailboxId: box.id });
  });

  it("does not treat a domain the workspace only added, but never verified, as inside", async () => {
    const boss = await owner();
    const box = await ownMailbox(boss, await verifiedDomain(boss.tenantId));
    const unverified = `${unique("added")}.test`;
    await prisma.mailDomain.create({
      data: { tenantId: boss.tenantId, domainName: unverified, type: "CUSTOM", verificationStatus: "PENDING", status: "PENDING_VERIFICATION", verificationToken: unique("t") },
    });
    await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: `x@${unverified}` }).expect(201);
    expect(await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL")).toHaveLength(1);
  });

  it("suspends the rule from the alert, closes the alert, audits it, and refuses a second remediation", async () => {
    const boss = await owner();
    const box = await ownMailbox(boss, await verifiedDomain(boss.tenantId));
    const rule = (await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: "exfil@outside.test" }).expect(201)).body.data;
    const [alert] = await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL");

    const listed = await request(app).get(`/api/v1/security-alerts/${alert!.id}`).set(authHeader(boss.accessToken)).expect(200);
    expect(listed.body.data.remediations).toEqual(["SUSPEND_FORWARDING", "REVOKE_SESSIONS"]);

    const done = await remediate(boss.accessToken, alert!.id, "SUSPEND_FORWARDING").expect(200);
    expect(done.body.data.outcome).toMatchObject({ result: "SUSPENDED", ruleId: rule.id });
    expect(done.body.data.alert).toMatchObject({ status: "RESOLVED", remediations: [] });
    expect((await prisma.forwardingRule.findUniqueOrThrow({ where: { id: rule.id } })).status).toBe("SUSPENDED");
    expect(await prisma.auditEvent.count({ where: { tenantId: boss.tenantId, eventType: "SECURITY_ALERT_REMEDIATED", targetId: alert!.id } })).toBe(1);

    const twice = await remediate(boss.accessToken, alert!.id, "SUSPEND_FORWARDING").expect(409);
    expect(twice.body.error.details.reason).toBe("ALERT_CLOSED");
  });

  it("applies a remediation once when responders act at the same moment", async () => {
    const boss = await owner();
    const box = await ownMailbox(boss, await verifiedDomain(boss.tenantId));
    await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: "race@outside.test" }).expect(201);
    const [alert] = await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL");
    const results = await Promise.all(Array.from({ length: 5 }, () => remediate(boss.accessToken, alert!.id, "SUSPEND_FORWARDING")));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await prisma.auditEvent.count({ where: { tenantId: boss.tenantId, eventType: "SECURITY_ALERT_REMEDIATED", targetId: alert!.id } })).toBe(1);
  });

  it("refuses a remediation that does not fit the alert, an unknown one, another workspace's alert, and a member", async () => {
    const boss = await owner();
    const box = await ownMailbox(boss, await verifiedDomain(boss.tenantId));
    await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: "nope@outside.test" }).expect(201);
    const [alert] = await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL");

    await remediate(boss.accessToken, alert!.id, "REVOKE_MAILBOX_ACCESS").expect(400);
    await remediate(boss.accessToken, alert!.id, "DELETE_EVERYTHING").expect(400);
    const stranger = await owner();
    await remediate(stranger.accessToken, alert!.id, "SUSPEND_FORWARDING").expect(404);
    const member = await colleague(boss, "MEMBER");
    await remediate(member.accessToken, alert!.id, "SUSPEND_FORWARDING").expect(403);
    await request(app).post(`/api/v1/security-alerts/${alert!.id}/remediate`).set(authHeader(boss.accessToken))
      .set("X-Test-Omit-Idempotency-Key", "1").send({ action: "SUSPEND_FORWARDING" }).expect(400);
    expect((await prisma.securityAlert.findUniqueOrThrow({ where: { id: alert!.id } })).status).toBe("OPEN");
  });

  it("signs out the account that created the rule, and holds an admin to the owner ceiling — rolling the claim back", async () => {
    const boss = await owner();
    const box = await ownMailbox(boss, await verifiedDomain(boss.tenantId));
    await request(app).post(`/api/v1/mail/admin/mailboxes/${box.id}/forwarding`).set(authHeader(boss.accessToken)).set(key())
      .send({ forwardToAddress: "owner-made@outside.test" }).expect(201);
    const [alert] = await alertsOfType(boss.tenantId, "FORWARDING_EXTERNAL");

    const admin = await colleague(boss, "ADMIN");
    await remediate(admin.accessToken, alert!.id, "REVOKE_SESSIONS").expect(403);
    expect((await prisma.securityAlert.findUniqueOrThrow({ where: { id: alert!.id } })).status).toBe("OPEN");
    await sessions(boss.accessToken).expect(200);

    // The owner contains their own account: allowed, and it takes effect.
    const done = await remediate(boss.accessToken, alert!.id, "REVOKE_SESSIONS").expect(200);
    expect(done.body.data.outcome).toMatchObject({ result: "SESSIONS_REVOKED", subjectUserId: boss.userId });
    expect((await sessions(boss.accessToken)).status).toBe(401);
  });
});

describe("A07 / ZMT-18 — widened mailbox access is reported, and revoking it closes every read path", () => {
  async function deliverTo(address: string, subject: string) {
    const raw = mimeMessage({ from: "sender@outside.test", to: address, subject, messageId: `<${unique("p1")}@outside.test>`, text: "quarterly numbers" });
    const timestamp = String(Date.now());
    await request(app).post("/api/v1/internal/inbound/messages")
      .set("Content-Type", "message/rfc822").set("X-Zoiko-Timestamp", timestamp).set("X-Zoiko-Recipients", address)
      .set("X-Zoiko-Signature", IngestService.sign(INBOUND_SECRET, timestamp, address, raw)).send(raw).expect(200);
  }

  it("reports send access to a shared mailbox but not read-only access, and the revoked grantee loses list, search and read", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    const reader = await colleague(boss, "MEMBER");
    const shared = await prisma.mailbox.create({
      data: { tenantId: boss.tenantId, address: `${unique("team")}@p1.test`, type: "SHARED", workspaces: ["MEMBER", "ADMIN", "OWNER"] },
    });
    await deliverTo(shared.address, "Board pack");
    const stored = await prisma.mailboxMessage.findFirstOrThrow({ where: { mailboxId: shared.id } });

    await request(app).post(`/api/v1/mail/admin/shared-mailboxes/${shared.id}/assignees`).set(authHeader(boss.accessToken)).set(key())
      .send({ membershipId: reader.membershipId, canRead: true }).expect((res) => expect(res.status).toBeLessThan(300));
    expect(await alertsOfType(boss.tenantId, "MAILBOX_ACCESS_GRANTED")).toHaveLength(0);

    await request(app).post(`/api/v1/mail/admin/shared-mailboxes/${shared.id}/assignees`).set(authHeader(boss.accessToken)).set(key())
      .send({ membershipId: member.membershipId, canRead: true, canSend: true }).expect((res) => expect(res.status).toBeLessThan(300));
    const [alert] = await alertsOfType(boss.tenantId, "MAILBOX_ACCESS_GRANTED");
    // A brand-new grant: read is new to this person too, so it is listed.
    expect(alert!.metadata).toMatchObject({ kind: "SHARED_MAILBOX", granteeMembershipId: member.membershipId, added: ["canRead", "canSend"] });

    // Before: the grantee reads, searches and opens the message.
    const list = (path: string) => request(app).get(path).set(authHeader(member.accessToken));
    await list(`/api/v1/mail?mailboxId=${shared.id}`).expect(200);
    await list(`/api/v1/mail?mailboxId=${shared.id}&q=Board`).expect(200);
    await list(`/api/v1/mail/${stored.messageId}?mailboxId=${shared.id}`).expect(200);

    const done = await remediate(boss.accessToken, alert!.id, "REVOKE_MAILBOX_ACCESS").expect(200);
    expect(done.body.data.outcome.result).toBe("REVOKED");

    // After: the same token, the next request, every path.
    await list(`/api/v1/mail?mailboxId=${shared.id}`).expect(404);
    await list(`/api/v1/mail?mailboxId=${shared.id}&q=Board`).expect(404);
    await list(`/api/v1/mail/${stored.messageId}?mailboxId=${shared.id}`).expect((res) => expect([403, 404]).toContain(res.status));
    // The read-only colleague is unaffected.
    await request(app).get(`/api/v1/mail?mailboxId=${shared.id}`).set(authHeader(reader.accessToken)).expect(200);
  });

  it("reports a delegation of someone's own mailbox", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    const cover = await colleague(boss, "MEMBER");
    await request(app).post(`/api/v1/mail/admin/mailboxes/${member.mailboxId}/delegates`).set(authHeader(boss.accessToken)).set(key())
      .send({ membershipId: cover.membershipId }).expect((res) => expect(res.status).toBeLessThan(300));
    const [alert] = await alertsOfType(boss.tenantId, "MAILBOX_ACCESS_GRANTED");
    expect(alert!.metadata).toMatchObject({ kind: "DELEGATION", granteeMembershipId: cover.membershipId, mailboxId: member.mailboxId });
  });

  it("signs an account out from a sign-in alert", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    await securityAlertService.recordPasswordChanged(boss.tenantId, member.userId, member.email, { ipAddress: null, userAgent: null });
    const [alert] = await alertsOfType(boss.tenantId, "PASSWORD_CHANGED");
    const done = await remediate(boss.accessToken, alert!.id, "REVOKE_SESSIONS").expect(200);
    expect(done.body.data.outcome).toMatchObject({ result: "SESSIONS_REVOKED", subjectUserId: member.userId });
    expect((await request(app).get("/api/v1/mail/unread-counts").set(authHeader(member.accessToken))).status).toBe(401);
  });
});

// ── ZMT-17 ──────────────────────────────────────────────────────────────────

describe("ZMT-17 — no path to OWNER except an Owner's own decision", () => {
  it("makes a self-service creator an ADMIN", async () => {
    const creator = await registerUser(app, { email: `${unique("p1-self")}@zoiko.test`, creatorRole: "ADMIN" });
    const membership = await prisma.tenantMembership.findUniqueOrThrow({ where: { id: creator.membershipId } });
    expect(membership.role).toBe("ADMIN");
  });

  it("refuses an admin adding, inviting or promoting anyone — themselves included — to OWNER", async () => {
    const boss = await owner();
    const admin = await colleague(boss, "ADMIN");
    const outsider = `${unique("p1-out")}@personal.test`;
    await prisma.appUser.create({ data: { email: outsider, displayName: "Out", passwordHash: await hashPassword(PASSWORD), status: "ACTIVE", emailVerifiedAt: new Date() } });

    await request(app).post("/api/v1/membership/members").set(authHeader(admin.accessToken)).send({ email: outsider, role: "OWNER" }).expect(403);
    await request(app).post("/api/v1/membership/invitations").set(authHeader(admin.accessToken)).send({ email: `${unique("inv")}@personal.test`, role: "OWNER" }).expect(403);
    await request(app).patch(`/api/v1/membership/members/${admin.membershipId}`).set(authHeader(admin.accessToken)).send({ role: "OWNER" })
      .expect((res) => expect([403, 409]).toContain(res.status));
    expect((await prisma.tenantMembership.findUniqueOrThrow({ where: { id: admin.membershipId } })).role).toBe("ADMIN");
  });

  it("refuses a member adding anyone, and an unknown role outright", async () => {
    const boss = await owner();
    const member = await colleague(boss, "MEMBER");
    await request(app).post("/api/v1/membership/members").set(authHeader(member.accessToken)).send({ email: `${unique("x")}@personal.test`, role: "MEMBER" }).expect(403);
    await request(app).post("/api/v1/membership/members").set(authHeader(boss.accessToken)).send({ email: `${unique("x")}@personal.test`, role: "SUPERUSER" }).expect(400);
  });
});
