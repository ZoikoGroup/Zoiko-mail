import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, type RegisteredUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

async function addSupportMember(owner: RegisteredUser, email: string) {
  const res = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "SUPPORT" })
    .expect(201);
  return res.body.data as { id: string };
}

async function supportAccessToken(support: RegisteredUser, tenantId: string): Promise<string> {
  const login = await request(app).post("/api/v1/auth/login")
    .send({ email: support.email, password: support.password, tenantId })
    .expect(200);
  return login.body.data.session?.accessToken ?? login.body.data.accessToken;
}

async function setupSupport(owner: RegisteredUser, email: string) {
  const support = await registerUser(app, { email });
  const membership = await addSupportMember(owner, email);
  const token = await supportAccessToken(support, owner.tenantId);
  return { support, membership, token };
}

describe("Platform support console", () => {
  it("is gated: unauthenticated -> 401, non-support roles -> 403", async () => {
    const owner = await registerUser(app, { email: "pc-owner@zoiko.test", tenantName: "Gate Tenant" });

    await request(app).get("/api/v1/support/platform/overview").expect(401);
    await request(app).get("/api/v1/support/platform/overview").set(authHeader(owner.accessToken)).expect(403);
  });

  it("allows a SUPPORT membership via a tenant-scoped access token", async () => {
    const owner = await registerUser(app, { email: "pc-owner2@zoiko.test", tenantName: "Overview Tenant" });
    const { token } = await setupSupport(owner, "pc-agent@zoiko.test");

    const res = await request(app).get("/api/v1/support/platform/overview").set(authHeader(token)).expect(200);
    expect(res.body.data.stats).toMatchObject({ activeTenants: expect.any(Number), activeMailboxes: expect.any(Number) });
    expect(res.body.data.providerHealth).toBeDefined();
    expect(Array.isArray(res.body.data.issues)).toBe(true);
  });

  it("allows staff via a platform token (no tenant membership required)", async () => {
    const staff = await registerUser(app, { email: "pc-staff@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPER_ADMIN" } });

    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    expect(login.body.data.state).toBe("STAFF_CONSOLE");
    const platformToken = login.body.data.platformToken as string;
    expect(platformToken).toBeTruthy();

    const res = await request(app).get("/api/v1/support/platform/overview").set(authHeader(platformToken)).expect(200);
    expect(res.body.data.stats).toMatchObject({ activeTenants: expect.any(Number) });
  });

  it("searches and drills into tenants; 404 for unknown tenants", async () => {
    const owner = await registerUser(app, { email: "pc-owner3@zoiko.test", tenantName: "Drilldown Corp" });
    const { token } = await setupSupport(owner, "pc-agent2@zoiko.test");

    const search = await request(app).get("/api/v1/support/platform/tenants?q=Drilldown").set(authHeader(token)).expect(200);
    expect(search.body.data.tenants.some((t: { id: string }) => t.id === owner.tenantId)).toBe(true);

    const detail = await request(app).get(`/api/v1/support/platform/tenants/${owner.tenantId}`).set(authHeader(token)).expect(200);
    expect(detail.body.data.tenant.id).toBe(owner.tenantId);
    expect(Array.isArray(detail.body.data.members)).toBe(true);
    expect(Array.isArray(detail.body.data.mailboxes)).toBe(true);
    expect(Array.isArray(detail.body.data.domains)).toBe(true);
    expect(Array.isArray(detail.body.data.audit)).toBe(true);
    expect(Array.isArray(detail.body.data.grants)).toBe(true);

    await request(app).get("/api/v1/support/platform/tenants/00000000-0000-4000-8000-000000000001")
      .set(authHeader(token)).expect(404);
  });

  it("exposes operational logs to a SUPPORT member", async () => {
    const owner = await registerUser(app, { email: "pc-owner4@zoiko.test", tenantName: "Logs Tenant" });
    const { token } = await setupSupport(owner, "pc-agent3@zoiko.test");

    const expectations: Array<[string, string]> = [
      ["/provider-events", "events"],
      ["/delivery-events", "events"],
      ["/jobs", "jobs"],
      ["/suppressions", "suppressions"],
      ["/audit", "events"],
      ["/grants", "grants"],
    ];
    for (const [path, key] of expectations) {
      const res = await request(app).get(`/api/v1/support/platform${path}`).set(authHeader(token)).expect(200);
      expect(Array.isArray(res.body.data[key])).toBe(true);
    }
  });

  it("lets a SUPER_ADMIN revoke any grant, a SUPPORT member only their own", async () => {
    const owner = await registerUser(app, { email: "pc-owner5@zoiko.test", tenantName: "Grants Tenant" });
    const agentA = await setupSupport(owner, "pc-agentA@zoiko.test");
    const agentB = await setupSupport(owner, "pc-agentB@zoiko.test");

    const grantA = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agentA.membership.id, reason: "Investigate delivery failure A", expiresInMinutes: 30, scopes: ["DELIVERY_DIAGNOSTICS"] }).expect(201);
    const grantB = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agentB.membership.id, reason: "Investigate delivery failure B", expiresInMinutes: 30, scopes: ["DELIVERY_DIAGNOSTICS"] }).expect(201);

    // agentA cannot revoke agentB's grant...
    await request(app).delete(`/api/v1/support/platform/grants/${grantB.body.data.id}`)
      .set(authHeader(agentA.token)).expect(403);
    // ...but can revoke their own.
    await request(app).delete(`/api/v1/support/platform/grants/${grantA.body.data.id}`)
      .set(authHeader(agentA.token)).expect(200);

    // A SUPER_ADMIN platform session can revoke agentB's grant.
    const staff = await registerUser(app, { email: "pc-superadmin@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPER_ADMIN" } });
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: staff.email, password: staff.password }).expect(200);
    await request(app).delete(`/api/v1/support/platform/grants/${grantB.body.data.id}`)
      .set(authHeader(login.body.data.platformToken)).expect(200);
  });

  it("serves grant-scoped diagnostics to the assigned support member", async () => {
    const owner = await registerUser(app, { email: "pc-owner6@zoiko.test", tenantName: "Diag Tenant" });
    const agent = await setupSupport(owner, "pc-agent4@zoiko.test");

    // No grant ID -> 403.
    await request(app).get("/api/v1/support/platform/diagnostics").set(authHeader(agent.token)).expect(403);

    const grant = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agent.membership.id, reason: "Investigate tenant configuration failure", expiresInMinutes: 30, scopes: ["TENANT_DIAGNOSTICS", "AUDIT_READ"] }).expect(201);

    const ok = await request(app).get(`/api/v1/support/platform/diagnostics?grantId=${grant.body.data.id}`)
      .set(authHeader(agent.token)).expect(200);
    expect(ok.body.data.grant.id).toBe(grant.body.data.id);
    expect(ok.body.data.tenant).toMatchObject({ id: owner.tenantId });
    expect(ok.body.data.audit).toBeDefined();
    expect(ok.body.data.domains).toBeUndefined();

    // Expired grants are rejected.
    await prisma.supportAccessGrant.update({ where: { id: grant.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get(`/api/v1/support/platform/diagnostics?grantId=${grant.body.data.id}`)
      .set(authHeader(agent.token)).expect(403);
  });

  it("searches and details mailboxes; 404 for unknown", async () => {
    const owner = await registerUser(app, { email: "pc-mb-owner@zoiko.test", tenantName: "Mailbox Tenant" });
    const { token, membership } = await setupSupport(owner, "pc-mb-agent@zoiko.test");

    const domain = await prisma.mailDomain.create({
      data: { tenantId: owner.tenantId, domainName: "mb-test.zoiko.test", verificationStatus: "VERIFIED", verificationToken: "test-token-mb", sendingEnabled: true },
    });
    const mailbox = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, address: "test@mb-test.zoiko.test", membershipId: membership.id },
    });

    const search = await request(app).get("/api/v1/support/platform/mailboxes?q=mb-test")
      .set(authHeader(token)).expect(200);
    expect(search.body.data.mailboxes.some((m: { id: string }) => m.id === mailbox.id)).toBe(true);

    const detail = await request(app).get(`/api/v1/support/platform/tenants/${owner.tenantId}/mailboxes/${mailbox.id}`)
      .set(authHeader(token)).expect(200);
    expect(detail.body.data.mailbox.id).toBe(mailbox.id);
    expect(detail.body.data.mailbox.address).toBe("test@mb-test.zoiko.test");
    expect(Array.isArray(detail.body.data.syncJobs)).toBe(true);
    expect(Array.isArray(detail.body.data.providerEvents)).toBe(true);
    expect(Array.isArray(detail.body.data.deliveryEvents)).toBe(true);

    // Unknown mailbox -> 404.
    await request(app).get(`/api/v1/support/platform/tenants/${owner.tenantId}/mailboxes/00000000-0000-4000-8000-000000000001`)
      .set(authHeader(token)).expect(404);

    // Cleanup.
    await prisma.mailbox.delete({ where: { id: mailbox.id } });
    await prisma.mailDomain.delete({ where: { id: domain.id } });
  });

  it("searches and details domains; 404 for unknown", async () => {
    const owner = await registerUser(app, { email: "pc-dom-owner@zoiko.test", tenantName: "Domain Tenant" });
    const { token } = await setupSupport(owner, "pc-dom-agent@zoiko.test");

    const domain = await prisma.mailDomain.create({
      data: { tenantId: owner.tenantId, domainName: "dom-test.zoiko.test", verificationStatus: "PENDING", verificationToken: "test-token-dom", sendingEnabled: false },
    });

    const search = await request(app).get("/api/v1/support/platform/domains?q=dom-test")
      .set(authHeader(token)).expect(200);
    expect(search.body.data.domains.some((d: { id: string }) => d.id === domain.id)).toBe(true);

    const detail = await request(app).get(`/api/v1/support/platform/tenants/${owner.tenantId}/domains/${domain.id}`)
      .set(authHeader(token)).expect(200);
    expect(detail.body.data.domain.id).toBe(domain.id);
    expect(detail.body.data.domain.domainName).toBe("dom-test.zoiko.test");
    expect(Array.isArray(detail.body.data.checks)).toBe(true);

    // Unknown domain -> 404.
    await request(app).get(`/api/v1/support/platform/tenants/${owner.tenantId}/domains/00000000-0000-4000-8000-000000000001`)
      .set(authHeader(token)).expect(404);

    // Cleanup.
    await prisma.mailDomain.delete({ where: { id: domain.id } });
  });
});
