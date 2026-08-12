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
    const token = login.body.data.session.accessToken;

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
    const grant = await prisma.supportAccessGrant.create({ data: { tenantId: owner.tenantId, supportMembershipId: added.body.data.id, approvedByUserId: owner.userId, reason: "Expired test access grant", scopes: ["TENANT_DIAGNOSTICS"], expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get("/api/v1/support/diagnostics").set(authHeader(login.body.data.session.accessToken))
      .set("x-support-grant-id", grant.id).expect(403);
  });
});
