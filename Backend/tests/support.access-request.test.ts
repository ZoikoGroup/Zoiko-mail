import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  authHeader,
  loginUser,
  registerUser,
  stepUpHeader,
  type RegisteredUser,
} from "./helpers.js";

const app = createApp();

/**
 * Asking for support access, and deciding on it — Runbook §7.
 *
 * The enforcement shipped first: support cannot read a workspace without an
 * approved, unexpired grant. Nothing in the product could create one, so the
 * control was real and unusable — the only way to open access was a direct
 * API call by somebody who already knew the endpoint existed. This is the
 * half that makes it a workflow.
 *
 * The request is deliberately its own record rather than a status on the
 * grant. The middleware treats a grant as live when `revokedAt` is null and
 * `expiresAt` is in the future, so a pending row on that table would have
 * meant that merely asking for access granted it. The first test below is
 * the one that would catch that if anyone ever merges the two.
 */

const SCOPES = ["TENANT_DIAGNOSTICS"] as const;

async function supportSeat(owner: RegisteredUser, email: string) {
  const support = await registerUser(app, { email });
  const member = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "SUPPORT" })
    .expect(201);
  const login = await loginUser(app, support.email, support.password, owner.tenantId);
  return { support, membershipId: member.body.data.id as string, token: login.accessToken as string };
}

const ask = (token: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/v1/support/access-requests")
    .set(authHeader(token))
    .send({
      reason: "INC-8801 investigating reported delivery failures",
      scopes: SCOPES,
      requestedMinutes: 60,
      ...over,
    });

describe("a support seat can ask for access without holding any", () => {
  it("accepts the request from a seat that has no grant at all", async () => {
    const owner = await registerUser(app, { email: `ar-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ar-support-${Date.now()}@zoiko.test`);

    // The console reads answer by invitation now — support.workspace.investigate
    // is ALLOW for this role — so they cannot prove the point of the request
    // endpoint. Diagnostics still wait for an approved grant, and it is the
    // one screen a seat cannot reach without something to run against, so it
    // stands in for "no grant" here.
    await request(app).get("/api/v1/support/diagnostics").set(authHeader(seat.token)).expect(403);

    const asked = await ask(seat.token);
    expect(asked.status).toBe(201);
    expect(asked.body.data.status).toBe("PENDING");
  });

  it("does not grant access merely by asking", async () => {
    const owner = await registerUser(app, { email: `ar-noaccess-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ar-noaccess-s-${Date.now()}@zoiko.test`);
    await ask(seat.token).expect(201);

    // The whole reason the request is a separate table. A pending row on
    // support_access_grants would satisfy a live-grant check, so diagnostics —
    // the one screen a seat still needs a grant for — must stay refused while
    // the request just sits there pending.
    await request(app).get("/api/v1/support/diagnostics").set(authHeader(seat.token)).expect(403);
  });

  it("refuses a second pending request from the same seat", async () => {
    const owner = await registerUser(app, { email: `ar-dupe-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ar-dupe-s-${Date.now()}@zoiko.test`);
    await ask(seat.token).expect(201);
    const again = await ask(seat.token);
    expect(again.status).toBe(409);
  });

  it("requires the same attribution a grant does", async () => {
    const owner = await registerUser(app, { email: `ar-attr-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ar-attr-s-${Date.now()}@zoiko.test`);

    const vague = await ask(seat.token, { reason: "Need to look at something in here today" });
    expect(vague.status).toBe(400);
    expect(vague.body.error.message).toMatch(/ticket|incident/i);
  });

  it("tells the people who can decide", async () => {
    const owner = await registerUser(app, { email: `ar-notify-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ar-notify-s-${Date.now()}@zoiko.test`);
    await ask(seat.token).expect(201);

    // A request nobody is told about is a request that expires unanswered
    // while the support member sits blocked.
    const notes = await prisma.notification.findMany({
      where: { tenantId: owner.tenantId, userId: owner.userId, type: "ACTION_REQUIRED" },
    });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]?.linkPath).toBe("/owner/support-access");
  });
});

describe("approving a request is what opens the access", () => {
  it("turns a pending request into a working grant", async () => {
    const owner = await registerUser(app, { email: `ap-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ap-support-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token).expect(201);

    const approved = await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .send({})
      .expect(200);

    expect(approved.body.data.request.status).toBe("APPROVED");
    expect(approved.body.data.grant.id).toBeTruthy();

    // The point of the whole exercise: diagnostics now answer. Every other
    // screen answered before the approval too, so asserting one of those
    // would prove nothing about what the grant changed.
    await request(app)
      .get("/api/v1/support/diagnostics")
      .set("x-support-grant-id", approved.body.data.grant.id)
      .set(authHeader(seat.token))
      .expect(200);
  });

  it("lets the approver shorten the window but never lengthen it", async () => {
    const owner = await registerUser(app, { email: `ap-short-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ap-short-s-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token, { requestedMinutes: 60 }).expect(201);

    const approved = await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      // Asking for more than was requested must not widen it: an approval
      // that quietly grows the request makes the request a formality.
      .send({ minutes: 240 })
      .expect(200);

    const expires = new Date(approved.body.data.grant.expiresAt).getTime();
    expect(expires - Date.now()).toBeLessThanOrEqual(61 * 60_000);
  });

  it("needs step-up, because RBAC marks approving support access high-risk", async () => {
    const owner = await registerUser(app, { email: `ap-su-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `ap-su-s-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token).expect(201);

    const refused = await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
      .set(authHeader(owner.accessToken))
      .send({})
      .expect(403);
    expect(refused.body.error.details?.requiresStepUp).toBe(true);
  });

  it("refuses an Admin, who may end access but never open it", async () => {
    const owner = await registerUser(app, { email: `ap-adm-o-${Date.now()}@zoiko.test` });
    const admin = await registerUser(app, { email: `ap-adm-a-${Date.now()}@zoiko.test` });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" })
      .expect(201);
    const adminLogin = await loginUser(app, admin.email, admin.password, owner.tenantId);
    const seat = await supportSeat(owner, `ap-adm-s-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token).expect(201);

    // RBAC §2, "Approve support access": Owner Yes, Admin No.
    await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
      .set(authHeader(adminLogin.accessToken as string))
      .set(await stepUpHeader(app, adminLogin.accessToken as string))
      .send({})
      .expect(403);

    // Denying is a different decision, and Admin may make it.
    await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/deny`)
      .set(authHeader(adminLogin.accessToken as string))
      .send({ note: "Not needed, resolved on the call" })
      .expect(200);
  });

  it("leaves a denied request closed, and diagnostics still refused", async () => {
    const owner = await registerUser(app, { email: `dn-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `dn-support-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token).expect(201);

    await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/deny`)
      .set(authHeader(owner.accessToken))
      .send({})
      .expect(200);

    // Denial keeps the grant-gated screen closed: diagnostics is the one
    // thing on this console that still waits for an approved grant.
    await request(app).get("/api/v1/support/diagnostics").set(authHeader(seat.token)).expect(403);

    const listed = await request(app)
      .get("/api/v1/support/access-requests")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(listed.body.data.requests[0].status).toBe("DENIED");
  });

  it("lets the requester withdraw their own, and nobody else's", async () => {
    const owner = await registerUser(app, { email: `wd-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `wd-support-${Date.now()}@zoiko.test`);
    const other = await supportSeat(owner, `wd-other-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token).expect(201);

    await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/withdraw`)
      .set(authHeader(other.token))
      .expect(404);

    await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/withdraw`)
      .set(authHeader(seat.token))
      .expect(200);
  });
});

describe("the decision is on the record", () => {
  it("audits the request and the approval", async () => {
    const owner = await registerUser(app, { email: `au-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `au-support-${Date.now()}@zoiko.test`);
    const asked = await ask(seat.token).expect(201);

    await request(app)
      .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .send({})
      .expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { tenantId: owner.tenantId, eventType: { startsWith: "SUPPORT_ACCESS_REQUEST" } },
      select: { eventType: true },
    });
    const types = events.map((e) => e.eventType);
    // §7 names the grant and the approval among the things that must be
    // recorded; the request is what the approval was of.
    expect(types).toContain("SUPPORT_ACCESS_REQUEST_APPROVED");
  });
});
