import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Step-up authentication on the destructive admin actions — AC-003.
 *
 * RBAC §2 marks five Admin actions "Step-up": remove domain, delete mailbox,
 * rotate provider credentials, change AI policy, and enable AI on a restricted
 * mailbox. The machinery existed and the matrix marked only `people.mfa.reset`
 * and `data.export`, so three of those shipped through a gate that was not
 * there — the actions ran against `workspace.domains.manage` and
 * `workspace.mailboxes.manage`, which are plain ALLOW.
 *
 * The other half of each test matters as much as the refusal: the capability
 * was split rather than raised, so *adding* a domain, *suspending* sending and
 * *restricting* a mailbox must still take one click. A gate on the safe
 * direction teaches people to re-authenticate without reading why, which is
 * how step-up stops meaning anything.
 */

const PASSWORD = "Password123!";

/** A fresh step-up token for this session, as the console would obtain one. */
async function stepUpToken(accessToken: string): Promise<string> {
  const response = await request(app)
    .post("/api/v1/auth/step-up")
    .set(authHeader(accessToken))
    .send({ password: PASSWORD })
    .expect(200);
  return response.body.data.stepUpToken as string;
}

async function addDomain(owner: { accessToken: string }, domainName: string) {
  const response = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName });
  return response;
}

async function mailboxFor(owner: { accessToken: string; tenantId: string; membershipId: string }) {
  const mailbox = await prisma.mailbox.create({
    data: {
      tenantId: owner.tenantId,
      membershipId: owner.membershipId,
      address: `step-up-${Date.now()}@zoiko.test`,
    },
    select: { id: true },
  });
  return mailbox.id;
}

describe("removing a domain", () => {
  it("is refused without a fresh step-up, and says so", async () => {
    const owner = await registerUser(app, { email: `su-dom-${Date.now()}@zoiko.test` });
    const created = await addDomain(owner, `su-${Date.now()}.test`);
    expect(created.status).toBe(201);

    const response = await request(app)
      .delete(`/api/v1/domains/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(403);

    // Named, so the console can prompt rather than just grey the button out.
    expect(response.body.error.details?.requiresStepUp).toBe(true);
    expect(response.body.error.details?.capability).toBe("workspace.domains.remove");
  });

  it("succeeds once the caller has re-authenticated", async () => {
    const owner = await registerUser(app, { email: `su-dom-ok-${Date.now()}@zoiko.test` });
    const created = await addDomain(owner, `su-ok-${Date.now()}.test`);
    const token = await stepUpToken(owner.accessToken);

    await request(app)
      .delete(`/api/v1/domains/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", token)
      .expect(200);
  });

  it("does not make adding one require a password again", async () => {
    const owner = await registerUser(app, { email: `su-dom-add-${Date.now()}@zoiko.test` });

    // The capability was split rather than raised precisely so this stays a
    // single click; raising workspace.domains.manage would have caught it.
    const created = await addDomain(owner, `su-add-${Date.now()}.test`);
    expect(created.status).toBe(201);
  });
});

describe("deleting a mailbox", () => {
  it("is refused without a fresh step-up", async () => {
    const owner = await registerUser(app, { email: `su-mbx-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);

    const response = await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .expect(403);

    expect(response.body.error.details?.requiresStepUp).toBe(true);
    expect(response.body.error.details?.capability).toBe("workspace.mailboxes.delete");
  });

  it("succeeds once the caller has re-authenticated", async () => {
    const owner = await registerUser(app, { email: `su-mbx-ok-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);
    const token = await stepUpToken(owner.accessToken);

    const response = await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", token);

    expect(response.status).toBeLessThan(400);
  });

  it("leaves suspending sending as one click, since that is the reversible half", async () => {
    const owner = await registerUser(app, { email: `su-susp-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);

    // RBAC §2 says "suspend-first, offer export" before deletion. Making the
    // safety step harder to reach than the destructive one would invert that.
    const response = await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}/sending`)
      .set(authHeader(owner.accessToken))
      .send({ suspended: true, reason: "Investigating a spike" });

    expect(response.status).toBeLessThan(400);
  });
});

describe("enabling AI on a mailbox", () => {
  it("is refused without a fresh step-up", async () => {
    const owner = await registerUser(app, { email: `su-ai-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);

    const response = await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ aiEnabled: true })
      .expect(403);

    expect(response.body.error.details?.requiresStepUp).toBe(true);
    expect(response.body.error.details?.capability).toBe("mailbox.ai.enable");
  });

  it("is allowed once the caller has re-authenticated", async () => {
    const owner = await registerUser(app, { email: `su-ai-ok-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);
    const token = await stepUpToken(owner.accessToken);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", token)
      .send({ aiEnabled: true })
      .expect(200);
  });

  it("does not gate restricting one, which is the safe direction", async () => {
    const owner = await registerUser(app, { email: `su-ai-off-${Date.now()}@zoiko.test` });
    const mailboxId = await mailboxFor(owner);

    // The control that protects a mailbox must not be harder to reach than
    // the one that exposes it.
    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ aiEnabled: false })
      .expect(200);
  });
});

describe("changing AI policy", () => {
  const rules = { defaultEffect: "DENY" as const, conditions: [] };

  it("is refused without a fresh step-up", async () => {
    const owner = await registerUser(app, { email: `su-pol-${Date.now()}@zoiko.test` });

    const response = await request(app)
      .post("/api/v1/policies")
      .set(authHeader(owner.accessToken))
      .send({ type: "AI", name: "AI governance", rules })
      .expect(403);

    expect(response.body.error.details?.requiresStepUp).toBe(true);
    expect(response.body.error.details?.capability).toBe("policy.ai.write");
  });

  it("succeeds once the caller has re-authenticated", async () => {
    const owner = await registerUser(app, { email: `su-pol-ok-${Date.now()}@zoiko.test` });
    const token = await stepUpToken(owner.accessToken);

    await request(app)
      .post("/api/v1/policies")
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", token)
      .send({ type: "AI", name: "AI governance", rules })
      .expect(201);
  });

  it("leaves a retention policy alone, which the matrix does not mark step-up", async () => {
    const owner = await registerUser(app, { email: `su-pol-ret-${Date.now()}@zoiko.test` });

    // Gating the whole endpoint would have caught this one too, and demanded
    // a password for a policy the spec treats as ordinary.
    await request(app)
      .post("/api/v1/policies")
      .set(authHeader(owner.accessToken))
      .send({ type: "RETENTION", name: "Retention", rules })
      .expect(201);
  });
});

describe("a step-up is bound to who and where it was taken", () => {
  it("does not accept another user's step-up token", async () => {
    const owner = await registerUser(app, { email: `su-bind-a-${Date.now()}@zoiko.test` });
    const other = await registerUser(app, { email: `su-bind-b-${Date.now()}@zoiko.test` });
    const created = await addDomain(owner, `su-bind-${Date.now()}.test`);
    const theirToken = await stepUpToken(other.accessToken);

    await request(app)
      .delete(`/api/v1/domains/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", theirToken)
      .expect(403);
  });

  it("does not accept a forged token", async () => {
    const owner = await registerUser(app, { email: `su-forge-${Date.now()}@zoiko.test` });
    const created = await addDomain(owner, `su-forge-${Date.now()}.test`);
    const forged = jwt.sign(
      { sub: owner.userId, tenantId: owner.tenantId, type: "step-up", jti: "forged" },
      "not-the-signing-secret"
    );

    await request(app)
      .delete(`/api/v1/domains/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set("x-step-up-token", forged)
      .expect(403);
  });
});

describe("a request resolves the session it belongs to — AC-001", () => {
  it("carries a session id on the access token", async () => {
    const owner = await registerUser(app, { email: `sid-${Date.now()}@zoiko.test` });

    const decoded = jwt.decode(owner.accessToken) as Record<string, unknown>;
    expect(decoded.sub).toBeTruthy();
    expect(decoded.tenantId).toBeTruthy();
    expect(decoded.role).toBeTruthy();
    // The fourth thing AC-001 names, and the one that was missing.
    expect(typeof decoded.sid).toBe("string");
  });

  it("keeps the same session across a refresh", async () => {
    const owner = await registerUser(app, { email: `sid-refresh-${Date.now()}@zoiko.test` });
    const before = (jwt.decode(owner.accessToken) as { sid?: string }).sid;

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(200);

    const after = (
      jwt.decode(refreshed.body.data.accessToken) as { sid?: string }
    ).sid;

    // The refresh jti rotates — that is what makes reuse detectable — but the
    // session does not. Otherwise a user who stays signed in all day produces
    // a new "session" every few hours and the trail cannot be followed.
    expect(after).toBe(before);
    expect(after).toBeTruthy();
  });

  it("is a different thing from the token id, which does rotate", async () => {
    const owner = await registerUser(app, { email: `sid-jti-${Date.now()}@zoiko.test` });
    const firstRefresh = jwt.decode(owner.refreshToken) as { jti?: string; sid?: string };

    // Seeded from the first token, so a session has an id from the moment it
    // exists rather than only after its first rotation.
    expect(firstRefresh.sid).toBe(firstRefresh.jti);

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(200);

    const nextRefresh = jwt.decode(refreshed.body.data.refreshToken) as {
      jti?: string;
      sid?: string;
    };

    // The token id changed — that is what makes reuse detectable — and the
    // session id did not.
    expect(nextRefresh.jti).not.toBe(firstRefresh.jti);
    expect(nextRefresh.sid).toBe(firstRefresh.sid);
  });
});
