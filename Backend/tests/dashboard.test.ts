import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { auditService } from "../src/modules/audit/audit.service.js";

const app = createApp();

/**
 * The admin console's one-read dashboard.
 *
 * This endpoint replaced a seven-call client-side fan-out. The fan-out existed
 * for a reason — an aggregate that fails as a unit turns one broken subsystem
 * into a blank page — so the tests that matter most here are not the counts.
 * They are that a failing section degrades instead of throwing, and that the
 * route is closed to a Member despite the capability that would most naturally
 * have gated it being one a Member holds.
 */

const dashboard = (token: string, query = "") =>
  request(app).get(`/api/v1/admin/dashboard${query}`).set(authHeader(token));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin dashboard aggregate", () => {
  it("returns the workspace in one read, with counts already counted", async () => {
    const owner = await registerUser(app, {
      email: `dash-counts-${Date.now()}@zoiko.test`,
      tenantName: "Dashboard Workspace",
    });

    const response = await dashboard(owner.accessToken).expect(200);
    const body = response.body.data;

    expect(body.tenant).toMatchObject({
      name: "Dashboard Workspace",
      status: "ACTIVE",
    });
    expect(body.counts.people).toBe(1);
    expect(body.counts.pendingInvitations).toBe(0);
    // Creating a workspace does not provision a mailbox — those are created
    // deliberately through POST /mail/admin/mailboxes — so a fresh workspace
    // shows none rather than one for the owner.
    expect(body.counts.mailboxes).toBe(0);
    expect(body.counts.suspendedMailboxes).toBe(0);
    expect(body.counts.domainsTotal).toBe(0);
    expect(body.counts.connectedAccounts).toBe(0);
    expect(body.counts.storageUsedGb).toBe(0);
  });

  it("counts a provisioned mailbox and sums its storage", async () => {
    const owner = await registerUser(app, {
      email: `dash-mailbox-${Date.now()}@zoiko.test`,
    });

    await request(app)
      .post("/api/v1/mail/admin/mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ membershipId: owner.membershipId })
      .expect(201);

    const body = (await dashboard(owner.accessToken).expect(200)).body.data;

    expect(body.counts.mailboxes).toBe(1);
    expect(body.counts.suspendedMailboxes).toBe(0);
    // The storage limit is a BigInt column; it has to survive JSON as a
    // number rather than throwing on serialization.
    expect(typeof body.counts.storageLimitGb).toBe("number");
    expect(body.counts.storageLimitGb).toBeGreaterThan(0);
  });

  it("counts an invitation as pending rather than as a person who joined", async () => {
    const owner = await registerUser(app, {
      email: `dash-invite-${Date.now()}@zoiko.test`,
    });

    await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: `dash-invitee-${Date.now()}@zoiko.test`, role: "MEMBER" })
      .expect(201);

    const body = (await dashboard(owner.accessToken).expect(200)).body.data;

    expect(body.counts.pendingInvitations).toBe(1);
    // Two membership rows, one of them not yet accepted.
    expect(body.counts.people).toBe(2);
  });

  it("reports MFA as unsupported, not as zero coverage", async () => {
    const owner = await registerUser(app, {
      email: `dash-mfa-${Date.now()}@zoiko.test`,
    });

    const body = (await dashboard(owner.accessToken).expect(200)).body.data;

    // AC-002 is unimplemented. "Nobody has enrolled" would invite an admin to
    // go and fix something the platform does not offer.
    expect(body.mfa.supported).toBe(false);
    expect(body.mfa.total).toBe(1);
  });

  it("carries the real delivery-failure count and honours the window", async () => {
    const owner = await registerUser(app, {
      email: `dash-failures-${Date.now()}@zoiko.test`,
    });
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "s", textBody: "b", recipients: { to: ["x@example.test"] } })
      .expect(201);

    await prisma.deliveryEvent.createMany({
      data: [
        { tenantId: owner.tenantId, messageId: draft.body.data.id, type: "BOUNCED" },
        { tenantId: owner.tenantId, messageId: draft.body.data.id, type: "FAILED" },
        {
          tenantId: owner.tenantId,
          messageId: draft.body.data.id,
          type: "FAILED",
          createdAt: new Date(Date.now() - 40 * 3_600_000),
        },
      ],
    });

    const recent = (await dashboard(owner.accessToken).expect(200)).body.data;
    expect(recent.deliveryFailures.failed).toBe(2);
    expect(recent.deliveryFailures.windowHours).toBe(24);

    const wider = (await dashboard(owner.accessToken, "?windowHours=48").expect(200))
      .body.data;
    expect(wider.deliveryFailures.failed).toBe(3);
  });

  it("reports nothing degraded on a healthy request", async () => {
    const owner = await registerUser(app, {
      email: `dash-healthy-${Date.now()}@zoiko.test`,
    });

    const body = (await dashboard(owner.accessToken).expect(200)).body.data;

    expect(body.degraded).toEqual([]);
    expect(body.auditWithheld).toBe(false);
  });

  it("degrades a failing section instead of failing the whole read", async () => {
    const owner = await registerUser(app, {
      email: `dash-degraded-${Date.now()}@zoiko.test`,
    });

    // This is the property the seven-call fan-out was protecting, and the
    // reason it was safe to replace it. One subsystem down must cost the
    // caller one tile, not the page.
    //
    // Spied on the audit service rather than on a Prisma model: the model
    // accessors are proxies, and a spy there both escapes restoreAllMocks —
    // poisoning every later test in the file — and hands $transaction a plain
    // rejected promise it cannot treat as a PrismaPromise.
    vi.spyOn(auditService, "list").mockRejectedValue(new Error("audit down"));

    const response = await dashboard(owner.accessToken).expect(200);
    const body = response.body.data;

    expect(body.degraded).toEqual(["audit"]);
    // Everything else still arrived.
    expect(body.tenant.name).toBeTruthy();
    expect(body.counts.people).toBe(1);
    expect(body.deliveryFailures).not.toBeNull();
    // The failed section reads as empty rather than as wrong content.
    expect(body.recentAudit).toEqual([]);
    // And a section that merely failed is not reported as withheld, which
    // would tell the caller they lack a permission they actually hold.
    expect(body.auditWithheld).toBe(false);
  });

  it("refuses a member, whose read-only settings hold must not open this", async () => {
    const owner = await registerUser(app, {
      email: `dash-owner-${Date.now()}@zoiko.test`,
    });
    const memberEmail = `dash-member-${Date.now()}@zoiko.test`;
    const member = await registerUser(app, { email: memberEmail });

    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);

    const asMember = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const session = asMember.body.data.session ?? asMember.body.data;

    // A Member holds `workspace.settings.read` as READ_ONLY and the resolver
    // allows a read-only hold, so gating this route on that capability would
    // have exposed workspace-wide counts, connector status and the audit tail
    // to every member. The gate is `people.read`.
    const refused = await dashboard(session.accessToken);
    expect(refused.status).toBe(403);
    expect(refused.body.error.details.capability).toBe("people.read");
  });

  it("shows an admin the dashboard but withholds owner-reserved audit events", async () => {
    const owner = await registerUser(app, {
      email: `dash-audit-owner-${Date.now()}@zoiko.test`,
    });
    const adminEmail = `dash-audit-admin-${Date.now()}@zoiko.test`;
    const admin = await registerUser(app, { email: adminEmail });

    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: adminEmail, role: "ADMIN" })
      .expect(201);

    await prisma.auditEvent.create({
      data: {
        tenantId: owner.tenantId,
        eventType: "BILLING_PLAN_CHANGED",
        targetType: "Subscription",
        requestId: "test-request",
      },
    });

    const asAdmin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminEmail, password: admin.password, tenantId: owner.tenantId })
      .expect(200);
    const session = asAdmin.body.data.session ?? asAdmin.body.data;

    const adminBody = (await dashboard(session.accessToken).expect(200)).body.data;
    const ownerBody = (await dashboard(owner.accessToken).expect(200)).body.data;

    const types = (rows: Array<{ eventType: string }>) => rows.map((e) => e.eventType);
    // The aggregate reads audit through the audit service, so the Admin
    // withholding applies here exactly as it does on GET /audit/events.
    expect(types(adminBody.recentAudit)).not.toContain("BILLING_PLAN_CHANGED");
    expect(types(ownerBody.recentAudit)).toContain("BILLING_PLAN_CHANGED");
    expect(adminBody.auditWithheld).toBe(false);
  });

  it("does not report another workspace's numbers", async () => {
    const first = await registerUser(app, {
      email: `dash-tenant-a-${Date.now()}@zoiko.test`,
    });
    const second = await registerUser(app, {
      email: `dash-tenant-b-${Date.now()}@zoiko.test`,
    });

    await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(first.accessToken))
      .send({ email: `dash-x-${Date.now()}@zoiko.test`, role: "MEMBER" })
      .expect(201);

    const body = (await dashboard(second.accessToken).expect(200)).body.data;

    expect(body.counts.people).toBe(1);
    expect(body.counts.pendingInvitations).toBe(0);
  });

  it("rejects a window outside the allowed range", async () => {
    const owner = await registerUser(app, {
      email: `dash-window-${Date.now()}@zoiko.test`,
    });

    await dashboard(owner.accessToken, "?windowHours=0").expect(400);
    await dashboard(owner.accessToken, "?windowHours=500").expect(400);
  });
});
