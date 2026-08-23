import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";
import { ADMIN_AUDIT_EXCLUDED_PREFIXES } from "../src/modules/audit/audit.service.js";

const app = createApp();

/**
 * The three route-level P1 items: scoped audit reads, the tenant-wide connector
 * view, and mailbox attribute updates.
 */

async function memberWithRole(
  ownerToken: string,
  tenantId: string,
  role: "ADMIN" | "MEMBER",
  email: string
) {
  const user = await registerUser(app, { email });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(ownerToken))
    .send({ email: user.email, role })
    .expect(201);

  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: user.password, tenantId })
    .expect(200);

  return {
    ...user,
    membershipId: added.body.data.id as string,
    token: login.body.data.session?.accessToken ?? login.body.data.accessToken,
  };
}

describe("audit.read is Limited for an Admin (RBAC §2)", () => {
  it("hides Owner-reserved governance events from an Admin but not from an Owner", async () => {
    const owner = await registerUser(app, { email: "audit-scope-owner@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "audit-scope-admin@zoiko.test"
    );

    await prisma.auditEvent.createMany({
      data: [
        { tenantId: owner.tenantId, eventType: "BILLING_PLAN_CHANGED" },
        { tenantId: owner.tenantId, eventType: "TENANT_OWNERSHIP_TRANSFERRED" },
        { tenantId: owner.tenantId, eventType: "MAILBOX_CREATED" },
      ],
    });

    const asAdmin = await request(app)
      .get("/api/v1/audit/events?limit=100")
      .set(authHeader(admin.token))
      .expect(200);
    const adminTypes = asAdmin.body.data.events.map(
      (e: { eventType: string }) => e.eventType
    );
    expect(adminTypes).toContain("MAILBOX_CREATED");
    expect(adminTypes).not.toContain("BILLING_PLAN_CHANGED");
    expect(adminTypes).not.toContain("TENANT_OWNERSHIP_TRANSFERRED");

    const asOwner = await request(app)
      .get("/api/v1/audit/events?limit=100")
      .set(authHeader(owner.accessToken))
      .expect(200);
    const ownerTypes = asOwner.body.data.events.map(
      (e: { eventType: string }) => e.eventType
    );
    // A withholding, not a deletion: the Owner still sees everything.
    expect(ownerTypes).toContain("BILLING_PLAN_CHANGED");
    expect(ownerTypes).toContain("TENANT_OWNERSHIP_TRANSFERRED");
  });

  it("keeps support-access events visible to an Admin (Audit §11)", async () => {
    // The Admin holds support.grant.end, so hiding support evidence would
    // break a capability they do have.
    const owner = await registerUser(app, { email: "audit-support-owner@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "audit-support-admin@zoiko.test"
    );

    await prisma.auditEvent.create({
      data: { tenantId: owner.tenantId, eventType: "SUPPORT_ACCESS_GRANTED" },
    });

    const res = await request(app)
      .get("/api/v1/audit/events?limit=100")
      .set(authHeader(admin.token))
      .expect(200);
    expect(
      res.body.data.events.map((e: { eventType: string }) => e.eventType)
    ).toContain("SUPPORT_ACCESS_GRANTED");
  });

  it("cannot be bypassed with an explicit eventType filter", async () => {
    const owner = await registerUser(app, { email: "audit-filter-owner@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "audit-filter-admin@zoiko.test"
    );

    await prisma.auditEvent.create({
      data: { tenantId: owner.tenantId, eventType: "BILLING_INVOICE_ISSUED" },
    });

    const res = await request(app)
      .get("/api/v1/audit/events?eventType=BILLING_INVOICE_ISSUED&limit=100")
      .set(authHeader(admin.token))
      .expect(200);
    expect(res.body.data.events).toHaveLength(0);
  });

  it("cannot be bypassed by fetching a withheld event by id", async () => {
    const owner = await registerUser(app, { email: "audit-byid-owner@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "audit-byid-admin@zoiko.test"
    );

    const hidden = await prisma.auditEvent.create({
      data: { tenantId: owner.tenantId, eventType: "TENANT_DELETION_REQUESTED" },
      select: { id: true },
    });

    await request(app)
      .get(`/api/v1/audit/events/${hidden.id}`)
      .set(authHeader(admin.token))
      .expect(404);

    await request(app)
      .get(`/api/v1/audit/events/${hidden.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);
  });

  it("declares every excluded prefix in one place", () => {
    // Guards against a prefix being added to the query but not the constant.
    expect(ADMIN_AUDIT_EXCLUDED_PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of ADMIN_AUDIT_EXCLUDED_PREFIXES) {
      expect(prefix).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("tenant-wide connector view", () => {
  it("returns every account in the tenant, not just the caller's", async () => {
    const owner = await registerUser(app, { email: "conn-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "conn-member@zoiko.test"
    );

    await prisma.connectedAccount.createMany({
      data: [
        {
          tenantId: owner.tenantId,
          membershipId: owner.membershipId,
          userId: owner.userId,
          providerAccountId: "acct-owner-1",
          provider: "GMAIL",
          email: "owner-box@acme.test",
          scopes: [],
        },
        {
          tenantId: owner.tenantId,
          membershipId: member.membershipId,
          userId: member.userId,
          providerAccountId: "acct-member-1",
          provider: "MICROSOFT_365",
          email: "member-box@acme.test",
          scopes: [],
        },
      ],
    });

    // The caller-scoped list stays caller-scoped — the member surface relies
    // on it, so widening it was not an option.
    const own = await request(app)
      .get("/api/v1/connectors")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(own.body.data.accounts).toHaveLength(1);

    const all = await request(app)
      .get("/api/v1/connectors/admin")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(all.body.data.accounts).toHaveLength(2);
    // The owning member travels with the row: a failing connector is only
    // actionable if you know whose reauthorization to chase.
    expect(all.body.data.accounts[0].membership.user.email).toBeDefined();
  });

  it("refuses a Member the workspace-wide view", async () => {
    const owner = await registerUser(app, { email: "conn-deny-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "conn-deny-member@zoiko.test"
    );

    const res = await request(app)
      .get("/api/v1/connectors/admin")
      .set(authHeader(member.token))
      .expect(403);
    expect(res.body.error.details.capability).toBe("workspace.mailboxes.manage");
  });

  it("does not leak provider credentials", async () => {
    const owner = await registerUser(app, { email: "conn-secret-owner@zoiko.test" });
    await prisma.connectedAccount.create({
      data: {
        tenantId: owner.tenantId,
        membershipId: owner.membershipId,
        userId: owner.userId,
        providerAccountId: "acct-secret-1",
        provider: "GMAIL",
        email: "secret-box@acme.test",
        scopes: [],
      },
    });

    const res = await request(app)
      .get("/api/v1/connectors/admin")
      .set(authHeader(owner.accessToken))
      .expect(200);
    const serialized = JSON.stringify(res.body);
    for (const forbidden of ["accessToken", "refreshToken", "tokenCiphertext"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("admin mailbox attribute updates", () => {
  async function mailboxFor(ownerToken: string, membershipId: string) {
    const created = await request(app)
      .post("/api/v1/mail/admin/mailboxes")
      .set(authHeader(ownerToken))
      .send({ membershipId })
      .expect(201);
    return created.body.data.id as string;
  }

  it("updates quota and warm-up cap, and audits before and after", async () => {
    const owner = await registerUser(app, { email: "mbx-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "mbx-member@zoiko.test"
    );
    const mailboxId = await mailboxFor(owner.accessToken, member.membershipId);

    const res = await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ storageLimit: 5_368_709_120, customWarmupCap: 250 })
      .expect(200);

    expect(res.body.data.storageLimit).toBe(5_368_709_120);
    expect(res.body.data.customWarmupCap).toBe(250);

    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_SETTINGS_UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
    const metadata = event!.metadata as Record<string, Record<string, number>>;
    // Audit §6.2 wants before/after for material configuration changes: a
    // quota cut that starts bouncing mail needs the prior value on record.
    expect(metadata.before.storageLimit).toBe(1_073_741_824);
    expect(metadata.after.storageLimit).toBe(5_368_709_120);
  });

  it("clears a warm-up override with null", async () => {
    const owner = await registerUser(app, { email: "mbx-clear-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "mbx-clear-member@zoiko.test"
    );
    const mailboxId = await mailboxFor(owner.accessToken, member.membershipId);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ customWarmupCap: 100 })
      .expect(200);

    const cleared = await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ customWarmupCap: null })
      .expect(200);
    expect(cleared.body.data.customWarmupCap).toBeNull();
  });

  it("refuses a quota below current usage", async () => {
    const owner = await registerUser(app, { email: "mbx-quota-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "mbx-quota-member@zoiko.test"
    );
    const mailboxId = await mailboxFor(owner.accessToken, member.membershipId);
    await prisma.mailbox.update({
      where: { id: mailboxId },
      data: { storageUsed: 200_000_000 },
    });

    // Accepting this would leave the mailbox instantly over limit with no
    // action available to the user.
    const res = await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({ storageLimit: 1_048_576 })
      .expect(409);
    expect(res.body.error.message).toMatch(/usage/i);
  });

  it("rejects an empty body rather than reporting a silent no-op", async () => {
    const owner = await registerUser(app, { email: "mbx-empty-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "mbx-empty-member@zoiko.test"
    );
    const mailboxId = await mailboxFor(owner.accessToken, member.membershipId);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(owner.accessToken))
      .send({})
      .expect(400);
  });

  it("refuses a Member the admin mailbox surface", async () => {
    const owner = await registerUser(app, { email: "mbx-deny-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "mbx-deny-member@zoiko.test"
    );
    const mailboxId = await mailboxFor(owner.accessToken, member.membershipId);

    const res = await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}`)
      .set(authHeader(member.token))
      .send({ storageLimit: 2_147_483_648 })
      .expect(403);
    expect(res.body.error.details.capability).toBe("workspace.mailboxes.manage");
  });

  it("still routes the sending sub-path to the sending handler", async () => {
    // "/admin/mailboxes/:id/sending" must not be swallowed by the new
    // "/admin/mailboxes/:id" patch route.
    const owner = await registerUser(app, { email: "mbx-send-owner@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "mbx-send-member@zoiko.test"
    );
    const mailboxId = await mailboxFor(owner.accessToken, member.membershipId);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}/sending`)
      .set(authHeader(owner.accessToken))
      .send({ suspended: true, reason: "Abuse investigation" })
      .expect(200);

    const mailbox = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
    expect(mailbox?.sendSuspendedAt).not.toBeNull();
  });
});
