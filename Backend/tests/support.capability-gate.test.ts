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
 * The tenant support console, gated on what the caller holds rather than on
 * who they are.
 *
 * Nine of these routes were `requireRole("OWNER","ADMIN","SUPPORT")`. A role
 * check cannot express the thing Runbook §7 actually asks for: the same screen
 * is routine for an Owner looking at their own workspace and time-boxed for a
 * Support seat, because Zoiko support has "no default right" and any elevated
 * access "must have an expiry". `support.console.read` is ALLOW for Owner and
 * Admin and GRANT for Support, so one gate says both things.
 *
 * Making that work needed the other half of the mechanism. `requireCapability`
 * hardcoded `hasActiveSupportGrant: false`, so every GRANT capability resolved
 * closed whatever the owner had approved — `support.standing`,
 * `support.workspace.access` and `mail.other.read` were unusable by
 * construction. These tests pin the behaviour that proves it is real: the same
 * request, same person, allowed or refused purely on whether a grant is live.
 */

async function supportSeat(owner: RegisteredUser, email: string) {
  const support = await registerUser(app, { email });
  const member = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "SUPPORT" })
    .expect(201);
  const login = await loginUser(app, support.email, support.password, owner.tenantId);
  return {
    support,
    membershipId: member.body.data.id as string,
    token: login.accessToken as string,
  };
}

async function approve(owner: RegisteredUser, supportMembershipId: string) {
  return request(app)
    .post("/api/v1/support/access-grants")
    .set(authHeader(owner.accessToken))
    .set(await stepUpHeader(app, owner.accessToken))
    .send({
      supportMembershipId,
      reason: "INC-9001 investigating reported delivery failures",
      expiresInMinutes: 60,
      scopes: ["TENANT_DIAGNOSTICS"],
    })
    .expect(201);
}

describe("the tenant console is time-boxed for a Support seat", () => {
  it("refuses the console before any grant exists, and names what is missing", async () => {
    const owner = await registerUser(app, { email: `cg-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-support-${Date.now()}@zoiko.test`);

    const refused = await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(seat.token))
      .expect(403);

    // The denial carries why, so the console can ask for the right thing
    // rather than only greying the screen out.
    expect(refused.body.error.details?.capability).toBe("support.console.read");
    expect(refused.body.error.details?.requiresSupportGrant).toBe(true);
  });

  it("allows it once the owner approves one", async () => {
    const owner = await registerUser(app, { email: `cg-ok-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-ok-support-${Date.now()}@zoiko.test`);

    await approve(owner, seat.membershipId);

    await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(seat.token))
      .expect(200);
  });

  it("closes again the moment the grant is revoked", async () => {
    const owner = await registerUser(app, { email: `cg-rev-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-rev-support-${Date.now()}@zoiko.test`);
    const granted = await approve(owner, seat.membershipId);

    await request(app).get("/api/v1/support/overview").set(authHeader(seat.token)).expect(200);

    await request(app)
      .delete(`/api/v1/support/access-grants/${granted.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .expect(200);

    // Resolved per request, not cached at sign-in — which is what makes a
    // revocation mean anything to a session already open.
    await request(app).get("/api/v1/support/overview").set(authHeader(seat.token)).expect(403);
  });

  it("closes when the grant expires, with nobody revoking it", async () => {
    const owner = await registerUser(app, { email: `cg-exp-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-exp-support-${Date.now()}@zoiko.test`);
    const granted = await approve(owner, seat.membershipId);

    await prisma.supportAccessGrant.update({
      where: { id: granted.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // "Must have an expiry" only means something if the expiry acts by itself.
    await request(app).get("/api/v1/support/overview").set(authHeader(seat.token)).expect(403);
  });
});

describe("the same screens stay routine for the people who own the workspace", () => {
  it("lets an owner read the console with no grant at all", async () => {
    const owner = await registerUser(app, { email: `cg-own-${Date.now()}@zoiko.test` });

    // ALLOW, not GRANT: it is their own workspace, and asking an Owner to
    // approve their own access would make the control meaningless.
    await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(owner.accessToken))
      .expect(200);
  });

  it("lets an admin read it too", async () => {
    const owner = await registerUser(app, { email: `cg-adm-owner-${Date.now()}@zoiko.test` });
    const admin = await registerUser(app, { email: `cg-adm-${Date.now()}@zoiko.test` });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" })
      .expect(201);
    const login = await loginUser(app, admin.email, admin.password, owner.tenantId);

    await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(login.accessToken as string))
      .expect(200);
  });

  it("keeps the access list to Owner and Admin, and off the Support screen", async () => {
    const owner = await registerUser(app, { email: `cg-list-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-list-support-${Date.now()}@zoiko.test`);
    await approve(owner, seat.membershipId);

    await request(app)
      .get("/api/v1/support/access-grants")
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Deliberately a separate capability from support.console.read: replacing
    // a role gate must not widen what it guarded, and this list names who else
    // holds access.
    await request(app)
      .get("/api/v1/support/access-grants")
      .set(authHeader(seat.token))
      .expect(403);
  });

  it("still refuses a plain member, grant or no grant", async () => {
    const owner = await registerUser(app, { email: `cg-mem-owner-${Date.now()}@zoiko.test` });
    const member = await registerUser(app, { email: `cg-mem-${Date.now()}@zoiko.test` });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const login = await loginUser(app, member.email, member.password, owner.tenantId);

    await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(login.accessToken as string))
      .expect(403);
  });
});
