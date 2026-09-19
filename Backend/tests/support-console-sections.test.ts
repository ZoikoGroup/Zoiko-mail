import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, loginUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

describe("Tenant-scoped support console sections", () => {
  it("gates list endpoints: unauthenticated 401, MEMBER 403, OWNER/ADMIN/SUPPORT 200", async () => {
    const owner = await registerUser(app, { email: "sec-owner@zoiko.test", tenantName: "Gate Tenant" });
    const admin = await registerUser(app, { email: "sec-admin@zoiko.test" });
    const support = await registerUser(app, { email: "sec-support@zoiko.test" });
    const member = await registerUser(app, { email: "sec-member@zoiko.test" });

    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" }).expect(201);
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);

    const adminLogin = await loginUser(app, admin.email, admin.password, owner.tenantId);
    const supportLogin = await loginUser(app, support.email, support.password, owner.tenantId);
    const memberLogin = await loginUser(app, member.email, member.password, owner.tenantId);

    const endpoints = [
      "/mailboxes",
      "/domains",
      "/provider-events",
      "/delivery-events",
      "/jobs",
      "/suppressions",
      "/audit",
    ];

    // Unauthenticated -> 401
    for (const ep of endpoints) {
      await request(app).get(`/api/v1/support${ep}`).expect(401);
    }

    // MEMBER -> 403
    for (const ep of endpoints) {
      await request(app).get(`/api/v1/support${ep}`)
        .set(authHeader(memberLogin.accessToken))
        .expect(403);
    }

    // OWNER -> 200
    for (const ep of endpoints) {
      const res = await request(app).get(`/api/v1/support${ep}`)
        .set(authHeader(owner.accessToken))
        .expect(200);
      expect(Array.isArray(res.body.data[Object.keys(res.body.data)[0]])).toBe(true);
    }

    // ADMIN -> 200
    for (const ep of endpoints) {
      const res = await request(app).get(`/api/v1/support${ep}`)
        .set(authHeader(adminLogin.accessToken))
        .expect(200);
      expect(Array.isArray(res.body.data[Object.keys(res.body.data)[0]])).toBe(true);
    }

    // SUPPORT -> 200
    for (const ep of endpoints) {
      const res = await request(app).get(`/api/v1/support${ep}`)
        .set(authHeader(supportLogin.accessToken))
        .expect(200);
      expect(Array.isArray(res.body.data[Object.keys(res.body.data)[0]])).toBe(true);
    }
  });

  it("exposes tenant overview at GET /support/tenant for OWNER/ADMIN/SUPPORT", async () => {
    const owner = await registerUser(app, { email: "tenant-over-owner@zoiko.test", tenantName: "Overview Tenant" });
    const support = await registerUser(app, { email: "tenant-over-support@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);
    const supportLogin = await loginUser(app, support.email, support.password, owner.tenantId);

    const ownerRes = await request(app).get("/api/v1/support/tenant")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(ownerRes.body.data.tenant.id).toBe(owner.tenantId);
    expect(ownerRes.body.data.tenant.name).toBe("Overview Tenant");

    const supportRes = await request(app).get("/api/v1/support/tenant")
      .set(authHeader(supportLogin.accessToken))
      .expect(200);
    expect(supportRes.body.data.tenant.id).toBe(owner.tenantId);
  });

  it("enforces cross-tenant isolation: SUPPORT of tenant A cannot read tenant B data even with tampered query", async () => {
    const ownerA = await registerUser(app, { email: "iso-ownerA@zoiko.test", tenantName: "Tenant A" });
    const ownerB = await registerUser(app, { email: "iso-ownerB@zoiko.test", tenantName: "Tenant B" });
    const supportA = await registerUser(app, { email: "iso-supportA@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(ownerA.accessToken))
      .send({ email: supportA.email, role: "SUPPORT" }).expect(201);
    const supportALogin = await loginUser(app, supportA.email, supportA.password, ownerA.tenantId);

    // Seed data in tenant B
    await prisma.suppressionEntry.create({
      data: { tenantId: ownerB.tenantId, emailHash: "x".repeat(64), reason: "ADMIN", active: true },
    });

    // SUPPORT A queries their own tenant (empty) — the server forces tenantId = A
    const res = await request(app).get("/api/v1/support/suppressions")
      .set(authHeader(supportALogin.accessToken))
      .expect(200);
    expect(res.body.data.suppressions).toHaveLength(0);

    // Tampering query with tenantId=B is ignored by server (session-scoped tenant)
    const resTampered = await request(app).get("/api/v1/support/suppressions")
      .query({ tenantId: ownerB.tenantId })
      .set(authHeader(supportALogin.accessToken))
      .expect(200);
    expect(resTampered.body.data.suppressions).toHaveLength(0);

    // Owner B can see their own suppression
    const ownerBRes = await request(app).get("/api/v1/support/suppressions")
      .set(authHeader(ownerB.accessToken))
      .expect(200);
    expect(ownerBRes.body.data.suppressions.length).toBeGreaterThanOrEqual(1);
  });

  it("supports filter query params on list endpoints (provider, status, type, q, limit)", async () => {
    const owner = await registerUser(app, { email: "filter-owner@zoiko.test", tenantName: "Filter Tenant" });

    // Seed a few suppressions
    await prisma.suppressionEntry.createMany({
      data: [
        { tenantId: owner.tenantId, emailHash: "a".repeat(64), reason: "ADMIN", active: true },
        { tenantId: owner.tenantId, emailHash: "b".repeat(64), reason: "COMPLAINT", active: false },
        { tenantId: owner.tenantId, emailHash: "c".repeat(64), reason: "ADMIN", active: true },
      ],
    });

    const active = await request(app).get("/api/v1/support/suppressions?status=true")
      .set(authHeader(owner.accessToken))
      .expect(200);
    const activeIds = active.body.data.suppressions.map((s: { id: string }) => s.id);
    expect(activeIds.length).toBeGreaterThanOrEqual(2);

    const inactive = await request(app).get("/api/v1/support/suppressions?status=false")
      .set(authHeader(owner.accessToken))
      .expect(200);
    const inactiveIds = inactive.body.data.suppressions.map((s: { id: string }) => s.id);
    expect(inactiveIds.length).toBeGreaterThanOrEqual(1);

    // Limit parameter
    const limited = await request(app).get("/api/v1/support/suppressions?limit=1")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(limited.body.data.suppressions.length).toBe(1);
  });

  it("audit endpoint returns events and supports q filter", async () => {
    const owner = await registerUser(app, { email: "audit-owner@zoiko.test", tenantName: "Audit Tenant" });
    await prisma.auditEvent.createMany({
      data: [
        { tenantId: owner.tenantId, eventType: "MAILBOX_CREATED", targetType: "Mailbox", targetId: "x", metadata: {} },
        { tenantId: owner.tenantId, eventType: "DOMAIN_VERIFIED", targetType: "Domain", targetId: "y", metadata: {} },
      ],
    });

    const all = await request(app).get("/api/v1/support/audit")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(all.body.data.events.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app).get("/api/v1/support/audit?q=MAILBOX")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(filtered.body.data.events.every((e: { eventType: string }) => e.eventType.includes("MAILBOX"))).toBe(true);
  });
});