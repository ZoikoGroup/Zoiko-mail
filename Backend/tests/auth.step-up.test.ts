import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Step-up authentication — Security §5, AC-003, RBAC §2 "fresh step-up
 * authentication required at action time".
 *
 * `requireCapability` hardcoded `stepUpSatisfied: false`, so every STEP_UP
 * capability resolved to a denial nothing could clear. That had a second
 * consequence worth naming: because no route could be gated on such a
 * capability without locking people out, the routes that should have been
 * — data export in particular — gated on the role instead and skipped the
 * re-authentication entirely. The capability layer said "prove yourself"
 * and nobody was asking it.
 */

const stepUp = (token: string, password: string) =>
  request(app).post("/api/v1/auth/step-up").set(authHeader(token)).send({ password });

const requestExport = (token: string, stepUpToken?: string) => {
  const call = request(app)
    .post("/api/v1/lifecycle/exports")
    .set(authHeader(token))
    .send({ idempotencyKey: `export-${Date.now()}-${Math.random().toString(16).slice(2)}` });
  return stepUpToken ? call.set("x-step-up-token", stepUpToken) : call;
};

describe("stepping up", () => {
  it("issues a short-lived token for the right password", async () => {
    const owner = await registerUser(app, { email: `su-ok-${Date.now()}@zoiko.test` });

    const res = await stepUp(owner.accessToken, owner.password).expect(200);

    expect(typeof res.body.data.stepUpToken).toBe("string");
    // Minutes, not hours: the point is freshness, and a long-lived one would
    // just be a second access token.
    expect(res.body.data.expiresIn).toBe("5m");
  });

  it("refuses the wrong password", async () => {
    const owner = await registerUser(app, { email: `su-bad-${Date.now()}@zoiko.test` });
    await stepUp(owner.accessToken, "NotThePassword1!").expect(401);
  });

  it("audits both the success and the failure", async () => {
    const owner = await registerUser(app, { email: `su-audit-${Date.now()}@zoiko.test` });
    await stepUp(owner.accessToken, "WrongOne1!").expect(401);
    await stepUp(owner.accessToken, owner.password).expect(200);

    const types = (
      await prisma.auditEvent.findMany({
        where: { tenantId: owner.tenantId, actorUserId: owner.userId },
        select: { eventType: true },
      })
    ).map((e) => e.eventType);

    // A run of failures against a privileged action is exactly the signal
    // §18's identity category exists to capture.
    expect(types).toContain("STEP_UP_FAILED");
    expect(types).toContain("STEP_UP_SUCCEEDED");
  });

  it("tells a password-less Google account what is wrong", async () => {
    const owner = await registerUser(app, { email: `su-google-${Date.now()}@zoiko.test` });
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { passwordHash: null },
    });

    const refused = await stepUp(owner.accessToken, "anything").expect(409);
    // A generic refusal would leave them with no way to act.
    expect(refused.body.error.details.reason).toBe("NO_PASSWORD_SET");
  });
});

describe("a STEP_UP capability is reachable now, and only with proof", () => {
  it("refuses an export with no step-up", async () => {
    const owner = await registerUser(app, { email: `su-noexp-${Date.now()}@zoiko.test` });

    const refused = await requestExport(owner.accessToken).expect(403);
    expect(refused.body.error.details.capability).toBe("data.export");
    expect(refused.body.error.details.requiresStepUp).toBe(true);
  });

  it("allows the export once the password is re-entered", async () => {
    const owner = await registerUser(app, { email: `su-exp-${Date.now()}@zoiko.test` });
    const proof = (await stepUp(owner.accessToken, owner.password).expect(200)).body.data
      .stepUpToken as string;

    // This is the bypass the change closes: before, the export ran on the
    // role alone and the STEP_UP requirement was never consulted.
    await requestExport(owner.accessToken, proof).expect(202);
  });

  it("refuses a step-up token that belongs to someone else", async () => {
    const suffix = String(Date.now());
    const first = await registerUser(app, { email: `su-a-${suffix}@zoiko.test` });
    const second = await registerUser(app, { email: `su-b-${suffix}@zoiko.test` });

    const theirProof = (await stepUp(second.accessToken, second.password).expect(200)).body.data
      .stepUpToken as string;

    // Bound to the user, so a token cannot be lifted from one session to
    // another.
    await requestExport(first.accessToken, theirProof).expect(403);
  });

  it("refuses a forged or malformed step-up token", async () => {
    const owner = await registerUser(app, { email: `su-forged-${Date.now()}@zoiko.test` });

    await requestExport(owner.accessToken, "not.a.jwt").expect(403);
    // An access token is a valid JWT but the wrong type, and must not pass.
    await requestExport(owner.accessToken, owner.accessToken).expect(403);
  });
});

describe("what step-up does not unlock", () => {
  it("leaves a TWO_PERSON capability closed", async () => {
    const owner = await registerUser(app, { email: `su-two-${Date.now()}@zoiko.test` });
    const proof = (await stepUp(owner.accessToken, owner.password).expect(200)).body.data
      .stepUpToken as string;

    const decision = await request(app)
      .get("/api/v1/users/me/capabilities")
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", proof)
      .expect(200);

    // Tenant deletion and ownership transfer need a second approver, which
    // does not exist yet. Re-entering a password is not that.
    const held: string[] = decision.body.data.capabilities;
    expect(held).not.toContain("tenant.delete");
    expect(held).not.toContain("tenant.ownership.transfer");
  });

  it("does not give a member a capability their role never held", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `su-owner-${suffix}@zoiko.test` });
    const memberEmail = `su-member-${suffix}@zoiko.test`;
    const member = await registerUser(app, { email: memberEmail });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const session = login.body.data.session ?? login.body.data;

    const proof = (await stepUp(session.accessToken, member.password).expect(200)).body.data
      .stepUpToken as string;

    // Step-up is evaluation step 10, not step 5. It confirms who you are; it
    // does not widen what your role may do.
    await requestExport(session.accessToken, proof).expect(403);
  });
});
