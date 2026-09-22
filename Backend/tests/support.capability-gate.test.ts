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
 * These routes used to be `requireRole("OWNER","ADMIN","SUPPORT")`. A role
 * check cannot express what a console read actually depends on, so they moved
 * to capabilities. `support.console.read` is ALLOW for Owner, Admin and — a
 * member the Owner personally invited into this workspace as SUPPORT, whose
 * membership is active. It stays out of a plain MEMBER's reach entirely.
 *
 * The grant system is not bypassed, it is aimed. Reading the workspace you
 * were invited into is open; the paths that must stay time-boxed still are.
 * `support.mailbox.reset` — the one write a seat holds — keeps its GRANT row
 * and its own MAILBOX_ADMIN scope, the cross-tenant platform routes are
 * gated by requireTenantGrant, and the diagnostics endpoint verifies the
 * grant header for itself. These tests pin the one change: an accepted
 * SUPPORT invitation, and not a separate grant, is what opens the
 * tenant-scoped console.
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

describe("an accepted SUPPORT invitation is the authorization for the tenant console", () => {
  it("opens the console for an active invited SUPPORT member with no grant at all", async () => {
    const owner = await registerUser(app, { email: `cg-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-support-${Date.now()}@zoiko.test`);

    // The Owner invited this member as SUPPORT, so the membership row is
    // live. That — not a separate grant, which exists to time-box the
    // platform-side paths — is what authorizes the tenant console.
    await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(seat.token))
      .expect(200);
  });

  it("still works when the owner has approved a grant on top", async () => {
    const owner = await registerUser(app, { email: `cg-ok-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-ok-support-${Date.now()}@zoiko.test`);

    await approve(owner, seat.membershipId);

    await request(app)
      .get("/api/v1/support/overview")
      .set(authHeader(seat.token))
      .expect(200);
  });

  it("stays open after the grant is revoked — the membership is now the control", async () => {
    const owner = await registerUser(app, { email: `cg-rev-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-rev-support-${Date.now()}@zoiko.test`);
    const granted = await approve(owner, seat.membershipId);

    await request(app)
      .delete(`/api/v1/support/access-grants/${granted.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .expect(200);

    // Resolved per request, not cached at sign-in. Revoking the grant no
    // longer cuts a seat the Owner still holds an active membership for.
    await request(app).get("/api/v1/support/overview").set(authHeader(seat.token)).expect(200);
  });

  it("stays open after the grant would have expired", async () => {
    const owner = await registerUser(app, { email: `cg-exp-owner-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cg-exp-support-${Date.now()}@zoiko.test`);
    const granted = await approve(owner, seat.membershipId);

    await prisma.supportAccessGrant.update({
      where: { id: granted.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app).get("/api/v1/support/overview").set(authHeader(seat.token)).expect(200);
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
