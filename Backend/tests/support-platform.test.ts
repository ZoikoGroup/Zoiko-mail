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

/**
 * Mints a real staff PLATFORM token by promoting a registered account to
 * SUPER_ADMIN and logging in — the STAFF_CONSOLE login issues a platform
 * token carrying platformRole. The global /support/platform console accepts
 * platform staff (platform token or platformRole SUPPORT/SUPER_ADMIN on an
 * access token) and tenant-scoped SUPPORT members alike, so both shapes are
 * exercised across these tests.
 */
async function staffPlatformToken(email: string): Promise<string> {
  const staff = await registerUser(app, { email });
  await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPER_ADMIN" } });
  const login = await request(app).post("/api/v1/auth/login")
    .send({ email: staff.email, password: staff.password })
    .expect(200);
  expect(login.body.data.state).toBe("STAFF_CONSOLE");
  const platformToken = login.body.data.platformToken as string;
  expect(platformToken).toBeTruthy();
  return platformToken;
}

describe("Platform support console", () => {
  it("is gated: unauthenticated -> 401, non-support roles -> 403", async () => {
    const owner = await registerUser(app, { email: "pc-owner@zoiko.test", tenantName: "Gate Tenant" });

    await request(app).get("/api/v1/support/platform/overview").expect(401);
    await request(app).get("/api/v1/support/platform/overview").set(authHeader(owner.accessToken)).expect(403);
  });

  it("allows a tenant-scoped SUPPORT membership on the platform console", async () => {
    const owner = await registerUser(app, { email: "pc-owner2@zoiko.test", tenantName: "Overview Tenant" });
    const { token } = await setupSupport(owner, "pc-agent@zoiko.test");

    // A SUPPORT membership is the support dashboard seat: the console is open
    // to it (like an invited support agent), and the overview stays readable.
    const res = await request(app).get("/api/v1/support/platform/overview").set(authHeader(token)).expect(200);
    expect(res.body.data.stats).toMatchObject({ activeTenants: expect.any(Number) });
  });

  it("returns ticket stats and recent tickets on the platform overview", async () => {
    const owner = await registerUser(app, { email: `pc-tk-${Date.now()}@zoiko.test`, tenantName: "Ticket Overview Tenant" });
    const token = await staffPlatformToken(`pc-tk-staff-${Date.now()}@zoiko.test`);

    await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(token))
      .send({ tenantId: owner.tenantId, subject: "Recent ticket for overview", description: "A recently updated ticket instance for the overview panel.", category: "OTHER", severity: "MEDIUM" })
      .expect(201);

    const res = await request(app).get("/api/v1/support/platform/overview")
      .set(authHeader(token)).expect(200);
    expect(res.body.data.ticketStats).toMatchObject({ open: expect.any(Number), overdue: expect.any(Number), urgent: expect.any(Number) });
    expect(res.body.data.ticketStats.byStatus).toBeDefined();
    expect(Array.isArray(res.body.data.recentTickets)).toBe(true);
    expect(res.body.data.recentTickets[0]).toMatchObject({ ticketNumber: expect.any(Number), subject: expect.any(String), tenantName: expect.any(String) });
  });

  it("still allows staff via a platform token (no tenant membership required)", async () => {
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
    const token = await staffPlatformToken("pc-platform3@zoiko.test");

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

  it("exposes operational logs to platform staff", async () => {
    const token = await staffPlatformToken("pc-platform4@zoiko.test");

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

  it("lets a SUPER_ADMIN revoke any grant; a SUPPORT member only its own", async () => {
    const owner = await registerUser(app, { email: "pc-owner5@zoiko.test", tenantName: "Grants Tenant" });
    const agentA = await setupSupport(owner, "pc-agentA@zoiko.test");
    const agentB = await setupSupport(owner, "pc-agentB@zoiko.test");

    const grantA = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agentA.membership.id, reason: "Investigate delivery failure A", expiresInMinutes: 30, scopes: ["DELIVERY_DIAGNOSTICS"] }).expect(201);
    const grantB = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agentB.membership.id, reason: "Investigate delivery failure B", expiresInMinutes: 30, scopes: ["DELIVERY_DIAGNOSTICS"] }).expect(201);

    // A SUPPORT seat reaches the console but must not revoke another member's
    // grant (membershipId mismatch -> 403 from revokeGrant).
    await request(app).delete(`/api/v1/support/platform/grants/${grantB.body.data.id}`)
      .set(authHeader(agentA.token)).expect(403);
    await request(app).delete(`/api/v1/support/platform/grants/${grantA.body.data.id}`)
      .set(authHeader(agentB.token)).expect(403);

    // A SUPER_ADMIN platform session can revoke either grant.
    const superToken = await staffPlatformToken("pc-superadmin@zoiko.test");
    await request(app).delete(`/api/v1/support/platform/grants/${grantA.body.data.id}`)
      .set(authHeader(superToken)).expect(200);
    await request(app).delete(`/api/v1/support/platform/grants/${grantB.body.data.id}`)
      .set(authHeader(superToken)).expect(200);
  });

  it("serves grant-scoped diagnostics to the grant owner or a SUPER_ADMIN", async () => {
    const owner = await registerUser(app, { email: "pc-owner6@zoiko.test", tenantName: "Diag Tenant" });
    const agent = await setupSupport(owner, "pc-agent4@zoiko.test");
    const staffToken = await staffPlatformToken("pc-platform-diag@zoiko.test");

    // A support seat reaches the console, but diagnostics still require a
    // grant ID (no grant -> 403), just like staff.
    await request(app).get("/api/v1/support/platform/diagnostics").set(authHeader(agent.token)).expect(403);
    await request(app).get("/api/v1/support/platform/diagnostics").set(authHeader(staffToken)).expect(403);

    const grant = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agent.membership.id, reason: "Investigate tenant configuration failure", expiresInMinutes: 30, scopes: ["TENANT_DIAGNOSTICS", "AUDIT_READ"] }).expect(201);

    // The grant owner (the SUPPORT seat) reads its own diagnostics.
    const ownerOk = await request(app).get(`/api/v1/support/platform/diagnostics?grantId=${grant.body.data.id}`)
      .set(authHeader(agent.token)).expect(200);
    expect(ownerOk.body.data.grant.id).toBe(grant.body.data.id);
    expect(ownerOk.body.data.tenant).toMatchObject({ id: owner.tenantId });
    expect(ownerOk.body.data.audit).toBeDefined();
    expect(ownerOk.body.data.domains).toBeUndefined();

    const ok = await request(app).get(`/api/v1/support/platform/diagnostics?grantId=${grant.body.data.id}`)
      .set(authHeader(staffToken)).expect(200);
    expect(ok.body.data.grant.id).toBe(grant.body.data.id);
    expect(ok.body.data.tenant).toMatchObject({ id: owner.tenantId });
    expect(ok.body.data.audit).toBeDefined();
    expect(ok.body.data.domains).toBeUndefined();

    // Expired grants are rejected.
    await prisma.supportAccessGrant.update({ where: { id: grant.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).get(`/api/v1/support/platform/diagnostics?grantId=${grant.body.data.id}`)
      .set(authHeader(agent.token)).expect(403);
    await request(app).get(`/api/v1/support/platform/diagnostics?grantId=${grant.body.data.id}`)
      .set(authHeader(staffToken)).expect(403);
  });

  it("filters suppressions by active status for platform staff", async () => {
    const owner = await registerUser(app, { email: "pc-sup-owner@zoiko.test", tenantName: "Suppression Tenant" });
    const token = await staffPlatformToken("pc-sup-platform@zoiko.test");

    const activeEntry = await prisma.suppressionEntry.create({
      data: { tenantId: owner.tenantId, emailHash: "a".repeat(64), reason: "ADMIN", active: true },
    });
    const inactiveEntry = await prisma.suppressionEntry.create({
      data: { tenantId: owner.tenantId, emailHash: "b".repeat(64), reason: "COMPLAINT", active: false },
    });

    try {
      const active = await request(app).get("/api/v1/support/platform/suppressions?status=true")
        .set(authHeader(token)).expect(200);
      const activeIds = active.body.data.suppressions.map((s: { id: string }) => s.id);
      expect(activeIds).toContain(activeEntry.id);
      expect(activeIds).not.toContain(inactiveEntry.id);

      const inactive = await request(app).get("/api/v1/support/platform/suppressions?status=false")
        .set(authHeader(token)).expect(200);
      const inactiveIds = inactive.body.data.suppressions.map((s: { id: string }) => s.id);
      expect(inactiveIds).toContain(inactiveEntry.id);
      expect(inactiveIds).not.toContain(activeEntry.id);

      // No filter -> both returned.
      const all = await request(app).get("/api/v1/support/platform/suppressions")
        .set(authHeader(token)).expect(200);
      expect(all.body.data.suppressions.map((s: { id: string }) => s.id))
        .toEqual(expect.arrayContaining([activeEntry.id, inactiveEntry.id]));
    } finally {
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: owner.tenantId } });
    }
  });

  it("denies a non-SUPER_ADMIN staff platform session from revoking grants", async () => {
    const owner = await registerUser(app, { email: "pc-staff-owner@zoiko.test", tenantName: "Staff Grants Tenant" });
    const agent = await setupSupport(owner, "pc-staff-agent@zoiko.test");
    const grant = await request(app).post("/api/v1/support/access-grants").set(authHeader(owner.accessToken))
      .send({ supportMembershipId: agent.membership.id, reason: "Investigate staff revoke denial", expiresInMinutes: 30, scopes: ["DELIVERY_DIAGNOSTICS"] }).expect(201);

    const staff = await registerUser(app, { email: "pc-staff-support@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPPORT" } });
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: staff.email, password: staff.password }).expect(200);
    expect(login.body.data.state).toBe("STAFF_CONSOLE");
    const platformToken = login.body.data.platformToken as string;
    expect(platformToken).toBeTruthy();

    // A staff SUPPORT session has no tenant membershipId, so it can never match
    // a grant's supportMembershipId — only SUPER_ADMIN may revoke here.
    await request(app).delete(`/api/v1/support/platform/grants/${grant.body.data.id}`)
      .set(authHeader(platformToken)).expect(403);
    expect((await prisma.supportAccessGrant.findUnique({ where: { id: grant.body.data.id } }))?.revokedAt).toBeNull();
  });

  it("searches and details mailboxes; 404 for unknown", async () => {
    const owner = await registerUser(app, { email: "pc-mb-owner@zoiko.test", tenantName: "Mailbox Tenant" });
    const { membership } = await setupSupport(owner, "pc-mb-agent@zoiko.test");
    const token = await staffPlatformToken("pc-mb-platform@zoiko.test");

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
    const token = await staffPlatformToken("pc-dom-platform@zoiko.test");

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
