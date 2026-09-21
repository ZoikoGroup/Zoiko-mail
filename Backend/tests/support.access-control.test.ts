import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  authHeader,
  loginUser,
  platformSignIn,
  registerUser,
  stepUpHeader,
  type RegisteredUser,
} from "./helpers.js";

const app = createApp();

/**
 * Runbook §7, on the platform support console.
 *
 * Two controls, both of which existed on paper and on exactly one endpoint.
 *
 *   "Zoiko support has no default right"; "any elevated support access must
 *   have an expiry" — only /diagnostics asked for a grant. Eleven other
 *   cross-tenant reads were standing access for anyone holding a staff row.
 *
 *   "Every access attempt, grant, use, and expiry must create audit events",
 *   with §8 setting audit completeness at 100% for support events — five of
 *   nineteen support reads recorded anything, so a staff member could page
 *   through every workspace's mailboxes, domains and audit trail and leave no
 *   trace at all.
 *
 * These tests are written against the rule rather than the implementation:
 * what matters is that a workspace-scoped read needs a live grant and that a
 * served read is on the record, not which layer arranges it.
 */

/** A Zoiko staff session at the given platform tier. */
async function staffToken(email: string, platformRole: "SUPPORT" | "SUPER_ADMIN") {
  const staff = await registerUser(app, { email });
  await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole } });
  const token = await platformSignIn(app, staff.email, staff.password, staff.mfaSecret);
  expect(token).toBeTruthy();
  return { staff, token };
}

/** A workspace whose SUPPORT seat is held by `staff`. */
async function workspaceWithSupportSeat(owner: RegisteredUser, staff: RegisteredUser) {
  const member = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: staff.email, role: "SUPPORT" })
    .expect(201);
  return member.body.data as { id: string };
}

/** Approve access the way an Owner does, through the real endpoint. */
async function approveGrant(
  owner: RegisteredUser,
  supportMembershipId: string,
  over: Record<string, unknown> = {}
) {
  return request(app)
    .post("/api/v1/support/access-grants")
    .set(authHeader(owner.accessToken))
    .set(await stepUpHeader(app, owner.accessToken))
    .send({
      supportMembershipId,
      reason: "Investigating INC-4471, delivery failures reported by the customer",
      expiresInMinutes: 60,
      scopes: ["TENANT_DIAGNOSTICS"],
      ...over,
    });
}

const auditRows = (tenantId: string, eventType: string) =>
  prisma.auditEvent.findMany({ where: { tenantId, eventType } });

describe("reading one workspace needs a live grant", () => {
  it("refuses a staff member who holds no grant for it, and records the attempt", async () => {
    const owner = await registerUser(app, { email: `sg-owner-${Date.now()}@zoiko.test` });
    const { staff, token } = await staffToken(`sg-staff-${Date.now()}@zoiko.test`, "SUPPORT");
    await workspaceWithSupportSeat(owner, staff);

    const refused = await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token));

    expect(refused.status).toBe(403);
    // Named, so the console can tell the person what to ask for rather than
    // just greying the workspace out.
    expect(refused.body.error.message).toMatch(/grant/i);

    // §7 counts an attempt as one of the four things worth recording, and it
    // is the one worth seeing.
    await expect
      .poll(async () => (await auditRows(owner.tenantId, "SUPPORT_ACCESS_DENIED")).length)
      .toBeGreaterThan(0);
  });

  it("allows the same read once the workspace owner approves one", async () => {
    const owner = await registerUser(app, { email: `sg-ok-owner-${Date.now()}@zoiko.test` });
    const { staff, token } = await staffToken(`sg-ok-staff-${Date.now()}@zoiko.test`, "SUPPORT");
    const membership = await workspaceWithSupportSeat(owner, staff);

    const granted = await approveGrant(owner, membership.id);
    expect(granted.status).toBe(201);

    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(200);
  });

  it("stops working the moment the grant is revoked", async () => {
    const owner = await registerUser(app, { email: `sg-rev-owner-${Date.now()}@zoiko.test` });
    const { staff, token } = await staffToken(`sg-rev-staff-${Date.now()}@zoiko.test`, "SUPPORT");
    const membership = await workspaceWithSupportSeat(owner, staff);
    const granted = await approveGrant(owner, membership.id);

    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(200);

    await request(app)
      .delete(`/api/v1/support/access-grants/${granted.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .expect(200);

    // No cache to wait out: the gate reads the grant per request, which is
    // what makes "revoke" mean anything.
    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(403);
  });

  it("stops working when the grant expires, without anyone revoking it", async () => {
    const owner = await registerUser(app, { email: `sg-exp-owner-${Date.now()}@zoiko.test` });
    const { staff, token } = await staffToken(`sg-exp-staff-${Date.now()}@zoiko.test`, "SUPPORT");
    const membership = await workspaceWithSupportSeat(owner, staff);
    const granted = await approveGrant(owner, membership.id);

    // Wind the expiry into the past — the expiry is the control §7 asks for,
    // and a grant that outlives it is standing access by another name.
    await prisma.supportAccessGrant.update({
      where: { id: granted.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(403);
  });

  it("leaves platform-wide search open, because narrowing is what needs approval", async () => {
    const { token } = await staffToken(`sg-search-${Date.now()}@zoiko.test`, "SUPPORT");

    // Finding the workspace has to work before anyone can ask for access to
    // it; the grant gates reading one, not looking for one.
    await request(app)
      .get("/api/v1/support/platform/tenants")
      .set(authHeader(token))
      .expect(200);
  });
});

describe("every served support read is on the record", () => {
  it("audits a workspace read against that workspace", async () => {
    const owner = await registerUser(app, { email: `sa-owner-${Date.now()}@zoiko.test` });
    const { staff, token } = await staffToken(`sa-staff-${Date.now()}@zoiko.test`, "SUPPORT");
    const membership = await workspaceWithSupportSeat(owner, staff);
    await approveGrant(owner, membership.id);

    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(200);

    await expect
      .poll(async () => (await auditRows(owner.tenantId, "SUPPORT_ACCESS_USED")).length)
      .toBeGreaterThan(0);

    const [row] = await auditRows(owner.tenantId, "SUPPORT_ACCESS_USED");
    expect(row?.actorType).toBe("SUPPORT");
    expect(row?.actorUserId).toBe(staff.userId);
    // The path is what makes the row answer "looked at what", rather than
    // only "was here".
    expect(JSON.stringify(row?.metadata)).toMatch(/tenants/);
  });

  it("records a super-admin reading without a grant as break-glass", async () => {
    const owner = await registerUser(app, { email: `sb-owner-${Date.now()}@zoiko.test` });
    const { token } = await staffToken(`sb-staff-${Date.now()}@zoiko.test`, "SUPER_ADMIN");

    // §7 permits break-glass and then asks for it to be "reviewed after use".
    // Passing is therefore correct; passing silently is not.
    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(200);

    await expect
      .poll(async () => (await auditRows(owner.tenantId, "SUPPORT_BREAK_GLASS_ACCESS")).length)
      .toBeGreaterThan(0);
  });

  it("does not record a read that was refused as a read that happened", async () => {
    const owner = await registerUser(app, { email: `sn-owner-${Date.now()}@zoiko.test` });
    const { staff, token } = await staffToken(`sn-staff-${Date.now()}@zoiko.test`, "SUPPORT");
    await workspaceWithSupportSeat(owner, staff);

    await request(app)
      .get(`/api/v1/support/platform/tenants/${owner.tenantId}`)
      .set(authHeader(token))
      .expect(403);

    // An access log that counts refusals as accesses cannot answer the
    // question it exists for.
    const used = await auditRows(owner.tenantId, "SUPPORT_ACCESS_USED");
    expect(used).toHaveLength(0);
  });
});

describe("support access is attributable to a case", () => {
  it("refuses a grant that names neither a ticket nor an incident", async () => {
    const owner = await registerUser(app, { email: `sp-owner-${Date.now()}@zoiko.test` });
    const staff = await registerUser(app, { email: `sp-staff-${Date.now()}@zoiko.test` });
    const membership = await workspaceWithSupportSeat(owner, staff);

    const refused = await approveGrant(owner, membership.id, {
      reason: "Customer asked us to take a look at their workspace today",
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/ticket|incident/i);
  });

  it("accepts an incident named in the reason, for access that starts before a ticket exists", async () => {
    const owner = await registerUser(app, { email: `si-owner-${Date.now()}@zoiko.test` });
    const staff = await registerUser(app, { email: `si-staff-${Date.now()}@zoiko.test` });
    const membership = await workspaceWithSupportSeat(owner, staff);

    // A P0 does not wait for anyone to raise a ticket first.
    const granted = await approveGrant(owner, membership.id, {
      reason: "P0 delivery outage, acting before the ticket is raised",
    });
    expect(granted.status).toBe(201);
  });

  it("links a grant to its ticket, and refuses another workspace's ticket", async () => {
    const owner = await registerUser(app, { email: `st-owner-${Date.now()}@zoiko.test` });
    const other = await registerUser(app, { email: `st-other-${Date.now()}@zoiko.test` });
    const staff = await registerUser(app, { email: `st-staff-${Date.now()}@zoiko.test` });
    const membership = await workspaceWithSupportSeat(owner, staff);

    const ticket = await request(app)
      .post("/api/v1/support/tickets")
      .set(authHeader(owner.accessToken))
      .send({
        subject: "Mail is bouncing",
        description: "External recipients are bouncing since this morning.",
        category: "DELIVERY",
        severity: "HIGH",
      })
      .expect(201);
    const ticketId = ticket.body.data.id as string;

    const linked = await approveGrant(owner, membership.id, { ticketId });
    expect(linked.status).toBe(201);
    expect(linked.body.data.ticketId).toBe(ticketId);

    // A grant pointing at somebody else's case is worse than no link: it reads
    // as attributable and is not.
    const foreign = await request(app)
      .post("/api/v1/support/tickets")
      .set(authHeader(other.accessToken))
      .send({
        subject: "Unrelated",
        description: "A different workspace's case entirely.",
        category: "OTHER",
        severity: "LOW",
      })
      .expect(201);

    const crossed = await approveGrant(owner, membership.id, {
      ticketId: foreign.body.data.id,
    });
    expect(crossed.status).toBe(404);
  });
});
