import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

describe("Temporary audited SUPPORT access", () => {
  it("requires an active owner-approved grant and denies mailbox access", async () => {
    const owner = await registerUser(app, { email: "support-owner@zoiko.test" });
    const support = await registerUser(app, { email: "support-agent@zoiko.test" });
    const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: support.email, password: support.password, tenantId: owner.tenantId }).expect(200);
    const token = login.body.data.session?.accessToken ?? login.body.data.accessToken;

    await request(app).get("/api/v1/support/diagnostics").set(authHeader(token)).expect(403);
    await request(app).get("/api/v1/messages").set(authHeader(token)).expect(403);

    const grant = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: added.body.data.id, reason: "Investigate tenant configuration failure", expiresInMinutes: 30, scopes: ["TENANT_DIAGNOSTICS", "AUDIT_READ"] }).expect(201);
    const diagnostics = await request(app).get("/api/v1/support/diagnostics").set(authHeader(token))
      .set("x-support-grant-id", grant.body.data.id).expect(200);
    expect(diagnostics.body.data.tenant).toMatchObject({ id: owner.tenantId });
    expect(diagnostics.body.data.audit).toBeDefined();
    expect(diagnostics.body.data.messages).toBeUndefined();

    await request(app).delete(`/api/v1/support/access-grants/${grant.body.data.id}`)
      .set(authHeader(owner.accessToken)).expect(200);
    await request(app).get("/api/v1/support/diagnostics").set(authHeader(token))
      .set("x-support-grant-id", grant.body.data.id).expect(403);
    expect(await prisma.auditEvent.count({ where: { tenantId: owner.tenantId, eventType: "SUPPORT_DIAGNOSTICS_ACCESSED" } })).toBe(1);
  });

  it("rejects expired grants", async () => {
    const owner = await registerUser(app, { email: "expired-owner@zoiko.test" });
    const support = await registerUser(app, { email: "expired-agent@zoiko.test" });
    const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: support.email, password: support.password, tenantId: owner.tenantId }).expect(200);
    const supportToken = login.body.data.session?.accessToken ?? login.body.data.accessToken;
    const grant = await prisma.supportAccessGrant.create({ data: { tenantId: owner.tenantId, supportMembershipId: added.body.data.id, approvedByUserId: owner.userId, reason: "Expired test access grant", scopes: ["TENANT_DIAGNOSTICS"], expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get("/api/v1/support/diagnostics").set(authHeader(supportToken))
      .set("x-support-grant-id", grant.id).expect(403);
  });

  it("exposes the support workspace overview to owner, admin and support roles", async () => {
    const owner = await registerUser(app, { email: "overview-owner@zoiko.test" });
    const admin = await registerUser(app, { email: "overview-admin@zoiko.test" });
    const support = await registerUser(app, { email: "overview-agent@zoiko.test" });

    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" }).expect(201);
    // The 201 assertion is the check; the response body is not needed here.
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);

    const ownerOverview = await request(app).get("/api/v1/support/overview")
      .set(authHeader(owner.accessToken)).expect(200);
    expect(ownerOverview.body.data.stats).toMatchObject({ members: 3, mailboxes: 0, activeGrants: 0 });
    expect(ownerOverview.body.data.members).toHaveLength(3);
    expect(ownerOverview.body.data.team).toHaveLength(1);
    expect(Array.isArray(ownerOverview.body.data.issues)).toBe(true);
    expect(Array.isArray(ownerOverview.body.data.audit)).toBe(true);
    expect(Array.isArray(ownerOverview.body.data.grants)).toBe(true);
    expect(ownerOverview.body.data.team[0]).toMatchObject({ email: support.email });

    const adminLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: admin.email, password: admin.password, tenantId: owner.tenantId }).expect(200);
    const adminToken = adminLogin.body.data.session?.accessToken ?? adminLogin.body.data.accessToken;
    await request(app).get("/api/v1/support/overview").set(authHeader(adminToken)).expect(200);

    const supportLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: support.email, password: support.password, tenantId: owner.tenantId }).expect(200);
    const supportToken = supportLogin.body.data.session?.accessToken ?? supportLogin.body.data.accessToken;
    const supportOverview = await request(app).get("/api/v1/support/overview")
      .set(authHeader(supportToken)).expect(200);
    expect(supportOverview.body.data.stats.members).toBe(3);

    await request(app).get("/api/v1/support/overview").expect(401);
  });

  it("lets an ADMIN revoke a support grant through the capability gate", async () => {
    const owner = await registerUser(app, { email: "adminrevoke-owner@zoiko.test" });
    const admin = await registerUser(app, { email: "adminrevoke-admin@zoiko.test" });
    const support = await registerUser(app, { email: "adminrevoke-agent@zoiko.test" });

    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" }).expect(201);
    const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);

    const grant = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: added.body.data.id, reason: "Investigate admin revoke flow", expiresInMinutes: 30, scopes: ["TENANT_DIAGNOSTICS"] }).expect(201);

    const adminLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: admin.email, password: admin.password, tenantId: owner.tenantId }).expect(200);
    const adminToken = adminLogin.body.data.session?.accessToken ?? adminLogin.body.data.accessToken;

    await request(app).delete(`/api/v1/support/access-grants/${grant.body.data.id}`)
      .set(authHeader(adminToken)).expect(200);
    expect((await prisma.supportAccessGrant.findUnique({ where: { id: grant.body.data.id } }))?.revokedAt).toBeTruthy();
  });

  it("denies a MEMBER from revoking a support grant", async () => {
    const owner = await registerUser(app, { email: "memrevoke-owner@zoiko.test" });
    const member = await registerUser(app, { email: "memrevoke-member@zoiko.test" });
    const support = await registerUser(app, { email: "memrevoke-agent@zoiko.test" });

    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const added = await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);

    const grant = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: added.body.data.id, reason: "Investigate member revoke denial", expiresInMinutes: 30, scopes: ["TENANT_DIAGNOSTICS"] }).expect(201);

    const memberLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const memberToken = memberLogin.body.data.session?.accessToken ?? memberLogin.body.data.accessToken;

    await request(app).delete(`/api/v1/support/access-grants/${grant.body.data.id}`)
      .set(authHeader(memberToken)).expect(403);
    expect((await prisma.supportAccessGrant.findUnique({ where: { id: grant.body.data.id } }))?.revokedAt).toBeNull();
  });
});
