import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, platformSignIn, loginUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Mints a real staff PLATFORM token (SUPER_ADMIN), same as support-platform.
 */
async function staffPlatformToken(email: string): Promise<string> {
  const staff = await registerUser(app, { email });
  await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPER_ADMIN" } });
  const platformToken = await platformSignIn(app, staff.email, staff.password, staff.mfaSecret);
  expect(platformToken).toBeTruthy();
  return platformToken;
}

async function addSupportMember(owner: { accessToken: string }, email: string) {
  const res = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "SUPPORT" })
    .expect(201);
  return res.body.data as { id: string };
}

describe("Platform support tokens (credential health)", () => {
  it("gates /tokens: unauthenticated 401, tenant SUPPORT membership 403", async () => {
    await request(app).get("/api/v1/support/platform/tokens").expect(401);

    const owner = await registerUser(app, { email: "tok-owner@zoiko.test", tenantName: "Token Gate Tenant" });
    const support = await registerUser(app, { email: "tok-agent@zoiko.test" });
    await addSupportMember(owner, support.email);
    const login = await loginUser(app, support.email, support.password, owner.tenantId);
    const tenantToken = login.accessToken as string;

    // A workspace-scoped SUPPORT seat must never reach the platform console.
    await request(app).get("/api/v1/support/platform/tokens").set(authHeader(tenantToken)).expect(403);
  });

  it("serves safe credential-health metadata to platform staff, never token secrets", async () => {
    const owner = await registerUser(app, { email: "tok-owner2@zoiko.test", tenantName: "Acme Mail" });
    const support = await registerUser(app, { email: "tok-agent2@zoiko.test" });
    const membership = await addSupportMember(owner, support.email);
    const token = await staffPlatformToken("tok-platform2@zoiko.test");

    const account = await prisma.connectedAccount.create({
      data: {
        tenantId: owner.tenantId,
        membershipId: membership.id,
        userId: support.userId,
        provider: "GMAIL",
        providerAccountId: "tok-provider-account-2",
        email: "connect@acme.zoiko.test",
        scopes: ["https://mail.google.com/"],
        status: "ACTIVE",
        tokenSecretRef: "secret://tok-secret-2",
        tokenExpiresAt: new Date(Date.now() - 60_000),
        watchExpiresAt: new Date(Date.now() + 86_400_000),
        lastSyncedAt: new Date(Date.now() - 3_600_000),
      },
    });

    try {
      const res = await request(app).get("/api/v1/support/platform/tokens").set(authHeader(token)).expect(200);
      const rows = res.body.data.tokens as Array<Record<string, unknown>>;
      expect(Array.isArray(rows)).toBe(true);

      const row = rows.find((r) => r.id === account.id);
      expect(row).toBeDefined();
      expect(row).toMatchObject({
        provider: "GMAIL",
        email: "connect@acme.zoiko.test",
        status: "ACTIVE",
        tenantId: owner.tenantId,
        tenantName: "Acme Mail",
        reauthRequired: true,
      });
      expect(row?.tenantStatus).toBe("ACTIVE");
      expect(typeof row?.tokenExpiresAt).toBe("string");
      expect(typeof row?.watchExpiresAt).toBe("string");
      expect(typeof row?.lastSyncedAt).toBe("string");
      // The one thing that must never leave the platform console:
      expect(row?.tokenSecretRef).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain("secret://tok-secret-2");
    } finally {
      await prisma.connectedAccount.delete({ where: { id: account.id } });
    }
  });

  it("filters by provider and status and searches by email or tenant", async () => {
    const owner = await registerUser(app, { email: "tok-owner3@zoiko.test", tenantName: "Filter Corp" });
    const support = await registerUser(app, { email: "tok-agent3@zoiko.test" });
    const membership = await addSupportMember(owner, support.email);
    const token = await staffPlatformToken("tok-platform3@zoiko.test");

    const gmail = await prisma.connectedAccount.create({
      data: {
        tenantId: owner.tenantId, membershipId: membership.id, userId: support.userId,
        provider: "GMAIL", providerAccountId: "tok-g-1", email: "gmail@filter.zoiko.test",
        scopes: [], status: "ACTIVE",
      },
    });
    const m365 = await prisma.connectedAccount.create({
      data: {
        tenantId: owner.tenantId, membershipId: membership.id, userId: support.userId,
        provider: "MICROSOFT_365", providerAccountId: "tok-m-1", email: "m365@filter.zoiko.test",
        scopes: [], status: "REAUTH_REQUIRED",
      },
    });

    try {
      const byProvider = await request(app).get("/api/v1/support/platform/tokens?provider=GMAIL").set(authHeader(token)).expect(200);
      const providerIds = byProvider.body.data.tokens.map((t: { id: string }) => t.id);
      expect(providerIds).toContain(gmail.id);
      expect(providerIds).not.toContain(m365.id);

      const byStatus = await request(app).get("/api/v1/support/platform/tokens?status=REAUTH_REQUIRED").set(authHeader(token)).expect(200);
      const statusIds = byStatus.body.data.tokens.map((t: { id: string }) => t.id);
      expect(statusIds).toContain(m365.id);
      expect(statusIds).not.toContain(gmail.id);

      const byEmail = await request(app).get("/api/v1/support/platform/tokens?q=gmail@").set(authHeader(token)).expect(200);
      expect(byEmail.body.data.tokens.map((t: { id: string }) => t.id)).toContain(gmail.id);

      const byTenant = await request(app).get("/api/v1/support/platform/tokens?q=Filter%20Corp").set(authHeader(token)).expect(200);
      const tenantIds = byTenant.body.data.tokens.map((t: { id: string }) => t.id);
      expect(tenantIds).toEqual(expect.arrayContaining([gmail.id, m365.id]));
    } finally {
      await prisma.connectedAccount.deleteMany({ where: { tenantId: owner.tenantId } });
    }
  });

  it("returns tenants search with provider-connection health summary", async () => {
    const owner = await registerUser(app, { email: "tok-owner4@zoiko.test", tenantName: "Health Corp" });
    const support = await registerUser(app, { email: "tok-agent4@zoiko.test" });
    const membership = await addSupportMember(owner, support.email);
    const token = await staffPlatformToken("tok-platform4@zoiko.test");

    const account = await prisma.connectedAccount.create({
      data: {
        tenantId: owner.tenantId, membershipId: membership.id, userId: support.userId,
        provider: "IMAP_SMTP", providerAccountId: "tok-imp-1", email: "imap@health.zoiko.test",
        scopes: [], status: "DEGRADED", lastErrorCode: "AUTH_FAILED",
      },
    });

    try {
      const res = await request(app).get("/api/v1/support/platform/tenants?q=Health").set(authHeader(token)).expect(200);
      const tenantRow = res.body.data.tenants.find((t: { id: string }) => t.id === owner.tenantId);
      expect(tenantRow).toBeDefined();
      expect(tenantRow.providerConnection).toMatchObject({
        provider: "IMAP_SMTP",
        status: "DEGRADED",
        lastErrorCode: "AUTH_FAILED",
      });
      // The provider connection implies the account count from _count is still intact.
      expect(tenantRow.connectedAccounts).toBe(1);
    } finally {
      await prisma.connectedAccount.delete({ where: { id: account.id } });
    }
  });
});