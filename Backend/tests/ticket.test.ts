import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, loginUser, platformSignIn } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

describe("Ticket module (restored)", () => {
  it("tenant member can create, list, view, and comment on tickets; MEMBER sees only own", async () => {
    const owner = await registerUser(app, { email: "ticket-owner@zoiko.test", tenantName: "Ticket Tenant" });
    const admin = await registerUser(app, { email: "ticket-admin@zoiko.test" });
    const support = await registerUser(app, { email: "ticket-support@zoiko.test" });
    const member = await registerUser(app, { email: "ticket-member@zoiko.test" });

    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" }).expect(201);
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);

    const adminLogin = await loginUser(app, admin.email, admin.password, owner.tenantId);
    const supportLogin = await loginUser(app, support.email, support.password, owner.tenantId);
    const memberLogin = await loginUser(app, member.email, member.password, owner.tenantId);

    // MEMBER creates a ticket
    const createRes = await request(app).post("/api/v1/support/tickets")
      .set(authHeader(memberLogin.accessToken))
      .send({ subject: "Delivery failure for order #123", description: "Emails to customer@example.com bouncing with 550.", category: "DELIVERY", severity: "HIGH" })
      .expect(201);
    const ticketId = createRes.body.data.id;
    expect(typeof createRes.body.data.ticketNumber).toBe("number");
    expect(createRes.body.data.ticketNumber).toBeGreaterThan(0);
    expect(createRes.body.data.status).toBe("OPEN");
    expect(createRes.body.data.openedByType).toBe("TENANT");

    // OWNER lists — should see the ticket
    const ownerList = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(ownerList.body.data.tickets.some((t: { id: string }) => t.id === ticketId)).toBe(true);
    expect(ownerList.body.data.ticketCounts.OPEN).toBeGreaterThanOrEqual(1);

    // ADMIN lists — should see the ticket
    const adminList = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(adminLogin.accessToken))
      .expect(200);
    expect(adminList.body.data.tickets.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    // SUPPORT lists — should see the ticket
    const supportList = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(supportLogin.accessToken))
      .expect(200);
    expect(supportList.body.data.tickets.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    // MEMBER lists — should see ONLY their own ticket
    const memberList = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(memberLogin.accessToken))
      .expect(200);
    expect(memberList.body.data.tickets.every((t: { openedBy: { id: string } }) => t.openedBy.id === member.userId)).toBe(true);
  });

  it("MEMBER cannot view another member's ticket (403), but OWNER/ADMIN/SUPPORT can", async () => {
    const owner = await registerUser(app, { email: "ticket-vis-owner@zoiko.test", tenantName: "Vis Tenant" });
    const memberA = await registerUser(app, { email: "ticket-vis-a@zoiko.test" });
    const memberB = await registerUser(app, { email: "ticket-vis-b@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: memberA.email, role: "MEMBER" }).expect(201);
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: memberB.email, role: "MEMBER" }).expect(201);
    const memberALogin = await loginUser(app, memberA.email, memberA.password, owner.tenantId);
    const memberBLogin = await loginUser(app, memberB.email, memberB.password, owner.tenantId);

    // Member A creates ticket
    const createA = await request(app).post("/api/v1/support/tickets")
      .set(authHeader(memberALogin.accessToken))
      .send({ subject: "A's issue", description: "Detailed description for A's ticket", category: "OTHER", severity: "LOW" })
      .expect(201);
    const ticketId = createA.body.data.id;

    // Member B tries to view — 403
    await request(app).get(`/api/v1/support/tickets/${ticketId}`)
      .set(authHeader(memberBLogin.accessToken))
      .expect(403);

    // Owner can view
    const ownerView = await request(app).get(`/api/v1/support/tickets/${ticketId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(ownerView.body.data.id).toBe(ticketId);

    // Member A can view own
    await request(app).get(`/api/v1/support/tickets/${ticketId}`)
      .set(authHeader(memberALogin.accessToken))
      .expect(200);
  });

  it("tenant member can comment on own ticket; MEMBER cannot comment on other's ticket", async () => {
    const owner = await registerUser(app, { email: "ticket-comm-owner@zoiko.test", tenantName: "Comm Tenant" });
    const memberA = await registerUser(app, { email: "ticket-comm-a@zoiko.test" });
    const memberB = await registerUser(app, { email: "ticket-comm-b@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: memberA.email, role: "MEMBER" }).expect(201);
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: memberB.email, role: "MEMBER" }).expect(201);
    const memberALogin = await loginUser(app, memberA.email, memberA.password, owner.tenantId);
    const memberBLogin = await loginUser(app, memberB.email, memberB.password, owner.tenantId);

    const createA = await request(app).post("/api/v1/support/tickets")
      .set(authHeader(memberALogin.accessToken))
      .send({ subject: "Comment test", description: "Desc for comment test", category: "OTHER", severity: "LOW" })
      .expect(201);
    const ticketId = createA.body.data.id;

    // Member B tries to comment — 403
    await request(app).post(`/api/v1/support/tickets/${ticketId}/comments`)
      .set(authHeader(memberBLogin.accessToken))
      .send({ body: "B trying to comment" })
      .expect(403);

    // Member A comments — 201
    const commentRes = await request(app).post(`/api/v1/support/tickets/${ticketId}/comments`)
      .set(authHeader(memberALogin.accessToken))
      .send({ body: "A adding more details" })
      .expect(201);
    expect(commentRes.body.data.body).toBe("A adding more details");
    expect(commentRes.body.data.authorType).toBe("TENANT");

    // Owner can comment
    const ownerComment = await request(app).post(`/api/v1/support/tickets/${ticketId}/comments`)
      .set(authHeader(owner.accessToken))
      .send({ body: "Owner checking in" })
      .expect(201);
    expect(ownerComment.body.data.authorType).toBe("TENANT"); // owner commenting as tenant member
  });

  it("staff platform console can list all tickets, filter by assigned=me, update status/severity/assignee, add internal comments", async () => {
    // Register two tenants
    const ownerA = await registerUser(app, { email: "staff-ticket-ownerA@zoiko.test", tenantName: "Tenant A" });
    const ownerB = await registerUser(app, { email: "staff-ticket-ownerB@zoiko.test", tenantName: "Tenant B" });

    // Create staff SUPPORT
    const staff1 = await registerUser(app, { email: "staff1@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff1.userId }, data: { platformRole: "SUPPORT" } });
    const staff1Token = await platformSignIn(app, staff1.email, staff1.password, staff1.mfaSecret);
    expect(staff1Token).toBeTruthy();

    // Create SUPER_ADMIN staff
    const staff2 = await registerUser(app, { email: "staff2@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff2.userId }, data: { platformRole: "SUPER_ADMIN" } });
    const staff2Token = await platformSignIn(app, staff2.email, staff2.password, staff2.mfaSecret);

    // Staff1 creates a ticket for tenant A
    const create1 = await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(staff1Token))
      .send({ tenantId: ownerA.tenantId, subject: "Staff-created for A", description: "Platform staff opened", category: "SECURITY", severity: "URGENT" })
      .expect(201);
    const ticket1Id = create1.body.data.id;

    // Staff2 creates a ticket for tenant B
    const create2 = await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(staff2Token))
      .send({ tenantId: ownerB.tenantId, subject: "Staff-created for B", description: "Platform staff opened", category: "BILLING", severity: "HIGH" })
      .expect(201);
    const ticket2Id = create2.body.data.id;

    // Platform list all (no filters) — both tickets visible
    const allList = await request(app).get("/api/v1/support/platform/tickets")
      .set(authHeader(staff1Token))
      .expect(200);
    expect(allList.body.data.tickets.length).toBeGreaterThanOrEqual(2);

    // Filter by tenantId
    const filteredA = await request(app).get(`/api/v1/support/platform/tickets?tenantId=${ownerA.tenantId}`)
      .set(authHeader(staff1Token))
      .expect(200);
    expect(filteredA.body.data.tickets.every((t: { tenantId: string }) => t.tenantId === ownerA.tenantId)).toBe(true);

    // Filter assigned=me for staff1
    const myTickets = await request(app).get("/api/v1/support/platform/tickets?assigned=me")
      .set(authHeader(staff1Token))
      .expect(200);
    // ticket1 created by staff1 but not assigned; ticket2 by staff2
    // listPlatformMine should show tickets assigned to staff1
    expect(myTickets.body.data.tickets.every((t: { assignedStaff: { id: string } | null }) => t.assignedStaff?.id === staff1.userId)).toBe(true);

    // Update ticket1: assign to staff1, change status
    const updateRes = await request(app).patch(`/api/v1/support/platform/tickets/${ticket1Id}`)
      .set(authHeader(staff1Token))
      .send({ assignedStaffId: staff1.userId, status: "IN_PROGRESS", severity: "HIGH" })
      .expect(200);
    expect(updateRes.body.data.assignedStaff?.id).toBe(staff1.userId);
    expect(updateRes.body.data.status).toBe("IN_PROGRESS");
    expect(updateRes.body.data.severity).toBe("HIGH");

    // Now assigned=me should include ticket1
    const myTickets2 = await request(app).get("/api/v1/support/platform/tickets?assigned=me")
      .set(authHeader(staff1Token))
      .expect(200);
    expect(myTickets2.body.data.tickets.some((t: { id: string }) => t.id === ticket1Id)).toBe(true);

    // Staff comment (internal)
    const internalComment = await request(app).post(`/api/v1/support/platform/tickets/${ticket1Id}/comments`)
      .set(authHeader(staff1Token))
      .send({ body: "Investigating SPF/DKIM alignment", internal: true })
      .expect(201);
    expect(internalComment.body.data.internal).toBe(true);
    expect(internalComment.body.data.authorType).toBe("STAFF");

    // Staff comment (public)
    const publicComment = await request(app).post(`/api/v1/support/platform/tickets/${ticket1Id}/comments`)
      .set(authHeader(staff1Token))
      .send({ body: "We are looking into this" })
      .expect(201);
    expect(publicComment.body.data.internal).toBe(false);

    // GET /support/platform/tickets/staff returns staff list
    const staffList = await request(app).get("/api/v1/support/platform/tickets/staff")
      .set(authHeader(staff1Token))
      .expect(200);
    expect(Array.isArray(staffList.body.data.staff)).toBe(true);
    expect(staffList.body.data.staff.some((s: { id: string }) => s.id === staff1.userId)).toBe(true);
  });

  it("staff cannot assign to non-staff user (400)", async () => {
    const owner = await registerUser(app, { email: "assign-owner@zoiko.test", tenantName: "Assign Tenant" });
    const member = await registerUser(app, { email: "assign-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const staff = await registerUser(app, { email: "assign-staff@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPPORT" } });
    const staffToken = await platformSignIn(app, staff.email, staff.password, staff.mfaSecret);

    const create = await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(staffToken))
      .send({ tenantId: owner.tenantId, subject: "Assign test", description: "Test assign", category: "OTHER", severity: "LOW" })
      .expect(201);
    const ticketId = create.body.data.id;

    // Try to assign to member (not staff) -> 400
    await request(app).patch(`/api/v1/support/platform/tickets/${ticketId}`)
      .set(authHeader(staffToken))
      .send({ assignedStaffId: member.userId })
      .expect(400);
  });

  it("unauthenticated requests to ticket endpoints return 401", async () => {
    await request(app).get("/api/v1/support/tickets").expect(401);
    await request(app).post("/api/v1/support/tickets").send({ subject: "x", description: "y", category: "OTHER", severity: "LOW" }).expect(401);
    await request(app).get("/api/v1/support/platform/tickets").expect(401);
    await request(app).post("/api/v1/support/platform/tickets").send({ tenantId: "00000000-0000-4000-8000-000000000001", subject: "x", description: "y", category: "OTHER", severity: "LOW" }).expect(401);
  });

  it("tenant member cannot access staff platform ticket endpoints (403)", async () => {
    const owner = await registerUser(app, { email: "cross-owner@zoiko.test", tenantName: "Cross Tenant" });
    const support = await registerUser(app, { email: "cross-support@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: support.email, role: "SUPPORT" }).expect(201);
    const supportLogin = await loginUser(app, support.email, support.password, owner.tenantId);

    // Tenant-scoped SUPPORT membership token cannot reach platform console
    await request(app).get("/api/v1/support/platform/tickets")
      .set(authHeader(supportLogin.accessToken))
      .expect(403);
    await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(supportLogin.accessToken))
      .send({ tenantId: owner.tenantId, subject: "x", description: "y", category: "OTHER", severity: "LOW" })
      .expect(403);
  });

  it("cross-tenant isolation: member of tenant A cannot view tenant B's ticket", async () => {
    const ownerA = await registerUser(app, { email: "cross-ticket-ownerA@zoiko.test", tenantName: "Tenant A" });
    const ownerB = await registerUser(app, { email: "cross-ticket-ownerB@zoiko.test", tenantName: "Tenant B" });
    const memberA = await registerUser(app, { email: "cross-ticket-memberA@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(ownerA.accessToken))
      .send({ email: memberA.email, role: "MEMBER" }).expect(201);
    const memberALogin = await loginUser(app, memberA.email, memberA.password, ownerA.tenantId);

    // Owner B creates a ticket via staff platform (or owner via tenant route)
    const staff = await registerUser(app, { email: "cross-staff@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPPORT" } });
    const staffToken = await platformSignIn(app, staff.email, staff.password, staff.mfaSecret);
    const createB = await request(app).post("/api/v1/support/platform/tickets")
      .set(authHeader(staffToken))
      .send({ tenantId: ownerB.tenantId, subject: "B's ticket", description: "Secret details here", category: "SECURITY", severity: "HIGH" })
      .expect(201);
    const ticketId = createB.body.data.id;

    // Member A tries to list — should see 0 (session is tenant A)
    const listA = await request(app).get("/api/v1/support/tickets")
      .set(authHeader(memberALogin.accessToken))
      .expect(200);
    expect(listA.body.data.tickets.find((t: { id: string }) => t.id === ticketId)).toBeUndefined();

    // Member A tries to GET — 404 (not found in their tenant)
    await request(app).get(`/api/v1/support/tickets/${ticketId}`)
      .set(authHeader(memberALogin.accessToken))
      .expect(404);
  });

  it("commenting on closed ticket returns 409 conflict", async () => {
    const owner = await registerUser(app, { email: "closed-owner@zoiko.test", tenantName: "Closed Tenant" });
    const member = await registerUser(app, { email: "closed-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const memberLogin = await loginUser(app, member.email, member.password, owner.tenantId);

    const create = await request(app).post("/api/v1/support/tickets")
      .set(authHeader(memberLogin.accessToken))
      .send({ subject: "Will close", description: "Then comment", category: "OTHER", severity: "LOW" })
      .expect(201);
    const ticketId = create.body.data.id;

    // Close the ticket via staff platform
    const staff = await registerUser(app, { email: "closed-staff@zoiko.test" });
    await prisma.appUser.update({ where: { id: staff.userId }, data: { platformRole: "SUPPORT" } });
    const staffToken = await platformSignIn(app, staff.email, staff.password, staff.mfaSecret);
    await request(app).patch(`/api/v1/support/platform/tickets/${ticketId}`)
      .set(authHeader(staffToken))
      .send({ status: "CLOSED" })
      .expect(200);

    // Try to comment — 409
    await request(app).post(`/api/v1/support/tickets/${ticketId}/comments`)
      .set(authHeader(memberLogin.accessToken))
      .send({ body: "Too late" })
      .expect(409);
  });
});