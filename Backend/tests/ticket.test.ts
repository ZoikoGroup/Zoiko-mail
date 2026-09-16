import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

async function staffPlatformToken(email: string): Promise<{ token: string; userId: string }> {
  const staff = await registerUser(app, { email });
  await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPER_ADMIN" } });
  const login = await request(app).post("/api/v1/auth/login")
    .send({ email: staff.email, password: staff.password })
    .expect(200);
  return { token: login.body.data.platformToken as string, userId: staff.userId };
}

describe("Support tickets", () => {
  it("lets a tenant member open a ticket and keeps it private from other members", async () => {
    const owner = await registerUser(app, { email: `tk-owner-${Date.now()}@zoiko.test`, tenantName: "Ticket Tenant" });
    const member = await registerUser(app, { email: `tk-member-${Date.now()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const memberSession = await loginUser(app, member.email, member.password, owner.tenantId);

    const created = await request(app).post("/api/v1/support/tickets")
      .set(authHeader(memberSession.accessToken))
      .send({ subject: "Outbound mail delayed", description: "Messages are stuck in the queue for hours.", category: "DELIVERY", severity: "HIGH" })
      .expect(201);
    const ticketId = created.body.data.id;
    expect(created.body.data.status).toBe("OPEN");
    expect(created.body.data.openedByType).toBe("TENANT");
    expect(created.body.data.slaDueAt).toBeTruthy();

    // The opener sees it.
    const list = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(memberSession.accessToken)).expect(200);
    expect(list.body.data.tickets.map((t: any) => t.id)).toContain(ticketId);

    // A different MEMBER does not.
    const other = await registerUser(app, { email: `tk-other-${Date.now()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: other.email, role: "MEMBER" })
      .expect(201);
    const otherSession = await loginUser(app, other.email, other.password, owner.tenantId);
    const otherList = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(otherSession.accessToken)).expect(200);
    expect(otherList.body.data.tickets.map((t: any) => t.id)).not.toContain(ticketId);
    await request(app).get(`/api/v1/support/tickets/${ticketId}`)
      .set(authHeader(otherSession.accessToken)).expect(403);

    // The opener replies to their own ticket.
    await request(app).post(`/api/v1/support/tickets/${ticketId}/comments`)
      .set(authHeader(memberSession.accessToken))
      .send({ body: "Adding the affected mailbox address." })
      .expect(201);

    // The OWNER sees every tenant ticket.
    const ownerList = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(owner.accessToken)).expect(200);
    expect(ownerList.body.data.tickets.map((t: any) => t.id)).toContain(ticketId);
  });

  it("runs the staff workflow: list, assign, triage, comment internal, resolve", async () => {
    const owner = await registerUser(app, { email: `tk-owner2-${Date.now()}@zoiko.test`, tenantName: "Ticket Staff Tenant" });
    const { token, userId: staffId } = await staffPlatformToken(`tk-staff-${Date.now()}@zoiko.test`);

    const created = await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(token))
      .send({ tenantId: owner.tenantId, subject: "Cannot verify domain", description: "DNS check keeps failing for our primary domain.", category: "DOMAIN", severity: "MEDIUM" })
      .expect(201);
    const ticketId = created.body.data.id;
    expect(created.body.data.openedByType).toBe("STAFF");

    const listed = await request(app).get("/api/v1/support/platform/tickets?q=Cannot verify domain")
      .set(authHeader(token)).expect(200);
    expect(listed.body.data.tickets.map((t: any) => t.id)).toContain(ticketId);

    const staffList = await request(app).get("/api/v1/support/platform/tickets/staff")
      .set(authHeader(token)).expect(200);
    expect(staffList.body.data.staff.some((s: any) => s.id === staffId)).toBe(true);

    const updated = await request(app).patch(`/api/v1/support/platform/tickets/${ticketId}`)
      .set(authHeader(token))
      .send({ status: "IN_PROGRESS", severity: "URGENT", assignedStaffId: staffId })
      .expect(200);
    expect(updated.body.data.status).toBe("IN_PROGRESS");
    expect(updated.body.data.severity).toBe("URGENT");
    expect(updated.body.data.assignedStaff?.id).toBe(staffId);

    await request(app).post(`/api/v1/support/platform/tickets/${ticketId}/comments`)
      .set(authHeader(token))
      .send({ body: "Internal: domain is pending registrar propagation.", internal: true })
      .expect(201);

    const detailStaff = await request(app).get(`/api/v1/support/platform/tickets/${ticketId}`)
      .set(authHeader(token)).expect(200);
    expect(detailStaff.body.data.comments).toHaveLength(1);
    expect(detailStaff.body.data.comments[0].internal).toBe(true);

    const resolved = await request(app).patch(`/api/v1/support/platform/tickets/${ticketId}`)
      .set(authHeader(token))
      .send({ status: "RESOLVED" })
      .expect(200);
    expect(resolved.body.data.status).toBe("RESOLVED");
    expect(resolved.body.data.resolvedAt).toBeTruthy();
  });

  it("hides internal staff notes from the tenant view", async () => {
    const owner = await registerUser(app, { email: `tk-owner3-${Date.now()}@zoiko.test`, tenantName: "Ticket Privacy Tenant" });
    const { token } = await staffPlatformToken(`tk-staff3-${Date.now()}@zoiko.test`);

    const created = await request(app).post("/api/v1/support/tickets")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Question about billing", description: "We were charged twice this month.", category: "BILLING", severity: "LOW" })
      .expect(201);
    const ticketId = created.body.data.id;

    await request(app).post(`/api/v1/support/platform/tickets/${ticketId}/comments`)
      .set(authHeader(token))
      .send({ body: "Internal: refund issued, do not surface the ledger note.", internal: true })
      .expect(201);
    await request(app).post(`/api/v1/support/platform/tickets/${ticketId}/comments`)
      .set(authHeader(token))
      .send({ body: "A refund has been issued.", internal: false })
      .expect(201);

    const tenantView = await request(app).get(`/api/v1/support/tickets/${ticketId}`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect(tenantView.body.data.comments).toHaveLength(1);
    expect(tenantView.body.data.comments[0].internal).toBe(false);
    expect(tenantView.body.data.comments[0].body).toBe("A refund has been issued.");
  });

  it("rejects a tenant-scoped SUPPORT membership from the platform ticket console", async () => {
    const owner = await registerUser(app, { email: `tk-owner4-${Date.now()}@zoiko.test`, tenantName: "Ticket Gate Tenant" });
    const support = await registerUser(app, { email: `tk-support-${Date.now()}@zoiko.test` });
    await request(app).post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" })
      .expect(201);
    const session = await loginUser(app, support.email, support.password, owner.tenantId);

    await request(app).get("/api/v1/support/platform/tickets")
      .set(authHeader(session.accessToken)).expect(403);
  });
});