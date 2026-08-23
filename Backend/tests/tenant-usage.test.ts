import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

async function addMember(ownerEmail: string, role: "MEMBER" | "ADMIN") {
  const owner = await registerUser(app, { email: ownerEmail });
  const member = await registerUser(app, {
    email: ownerEmail.replace("@", `-m@`),
  });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: member.email, role })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
    .expect(200);
  return { owner, memberToken: login.body.data.session.accessToken as string };
}

describe("GET /api/v1/tenants/usage", () => {
  it("returns zeroed usage for a fresh workspace", async () => {
    const owner = await registerUser(app, { email: "usage-fresh-owner@zoiko.test", planCode: "pro" });

    const res = await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const u = res.body.data;
    expect(u.period.days).toBe(30);
    expect(typeof u.period.since).toBe("string");
    expect(u.planCode).toBe("pro");
    expect(u.storage.used).toBe(0);
    expect(u.storage.limit).toBe(0);
    expect(u.storage.attachmentsBytes).toBe(0);
    expect(u.storage.mailboxes).toEqual([]);
    expect(u.mailboxes.count).toBe(0);
    expect(u.emails).toEqual({ sent: 0, received: 0, failed: 0, draft: 0, scheduled: 0 });
    expect(Array.isArray(u.emailVolume)).toBe(true);
    expect(Array.isArray(u.emailVolumeByStatus)).toBe(true);
    expect(Array.isArray(u.apiUsage)).toBe(true);
    expect(u.delivery.delivered).toBe(0);
    expect(u.delivery.successRate).toBeNull();
    expect(u.topMailboxes).toEqual([]);
    expect(u.activeMembers).toBe(1);
    expect(u.totalDomains).toBe(0);
    expect(u.connectedAccounts.total).toBe(0);
  });

  it("honors the days query parameter", async () => {
    const owner = await registerUser(app, { email: "usage-days-owner@zoiko.test" });

    const res = await request(app)
      .get("/api/v1/tenants/usage?days=7")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.period.days).toBe(7);
  });

  it("counts email statuses and per-status daily volume", async () => {
    const owner = await registerUser(app, { email: "usage-emails-owner@zoiko.test" });
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await prisma.emailMessage.createMany({
      data: [
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "s1", status: "SENT", createdAt: now },
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "s2", status: "SENT", createdAt: now },
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "r1", status: "RECEIVED", createdAt: now },
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "f1", status: "FAILED", createdAt: yesterday },
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "d1", status: "DRAFT", createdAt: now },
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "sc1", status: "SCHEDULED", createdAt: now },
        { tenantId: owner.tenantId, authorUserId: owner.userId, subject: "sn1", status: "SENDING", createdAt: now },
      ],
    });

    const res = await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.emails).toEqual({
      sent: 2,
      received: 1,
      failed: 1,
      draft: 1,
      scheduled: 2,
    });

    const byStatus = res.body.data.emailVolumeByStatus as Array<{
      date: string;
      sent: number;
      received: number;
      failed: number;
    }>;
    const todayEntry = byStatus.find((e) => e.sent + e.received > 0);
    expect(todayEntry).toMatchObject({ sent: 2, received: 1, failed: 0 });
    const yesterdayEntry = byStatus.find((e) => e.failed > 0);
    expect(yesterdayEntry).toMatchObject({ sent: 0, received: 0, failed: 1 });
  });

  it("aggregates storage across mailboxes and attachment bytes", async () => {
    const owner = await registerUser(app, { email: "usage-storage-owner@zoiko.test" });

    const domain = await prisma.mailDomain.create({
      data: {
        tenantId: owner.tenantId,
        domainName: "storage-test.zoiko.test",
        verificationStatus: "VERIFIED",
        verificationToken: "tok-storage",
        sendingEnabled: true,
      },
    });
    const mailbox = await prisma.mailbox.create({
      data: {
        tenantId: owner.tenantId,
        address: "owner@storage-test.zoiko.test",
        membershipId: owner.membershipId,
        storageUsed: 500n,
        storageLimit: 2000n,
      },
    });
    const message = await prisma.emailMessage.create({
      data: {
        tenantId: owner.tenantId,
        authorUserId: owner.userId,
        subject: "with attachment",
        status: "SENT",
      },
    });
    await prisma.messageAttachment.create({
      data: {
        tenantId: owner.tenantId,
        messageId: message.id,
        fileName: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 120,
        storageKey: "keys/a.pdf",
      },
    });

    const res = await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.storage.used).toBe(500);
    expect(res.body.data.storage.limit).toBe(2000);
    expect(res.body.data.storage.attachmentsBytes).toBe(120);
    expect(res.body.data.storage.mailboxes).toEqual([
      { address: "owner@storage-test.zoiko.test", used: 500, limit: 2000 },
    ]);
    expect(res.body.data.mailboxes.count).toBe(1);

    await prisma.mailbox.delete({ where: { id: mailbox.id } });
    await prisma.mailDomain.delete({ where: { id: domain.id } });
  });

  it("computes delivery stats and success rate", async () => {
    const owner = await registerUser(app, { email: "usage-delivery-owner@zoiko.test" });

    const message = await prisma.emailMessage.create({
      data: {
        tenantId: owner.tenantId,
        authorUserId: owner.userId,
        subject: "delivery probe",
        status: "SENT",
      },
    });
    await prisma.deliveryEvent.createMany({
      data: [
        { tenantId: owner.tenantId, messageId: message.id, type: "DELIVERED" },
        { tenantId: owner.tenantId, messageId: message.id, type: "DELIVERED" },
        { tenantId: owner.tenantId, messageId: message.id, type: "DELIVERED" },
        { tenantId: owner.tenantId, messageId: message.id, type: "BOUNCED" },
        { tenantId: owner.tenantId, messageId: message.id, type: "COMPLAINED" },
      ],
    });

    const res = await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.delivery.delivered).toBe(3);
    expect(res.body.data.delivery.bounced).toBe(1);
    expect(res.body.data.delivery.complained).toBe(1);
    expect(res.body.data.delivery.successRate).toBeCloseTo(0.75, 5);
  });

  it("ranks top mailboxes by message activity", async () => {
    const owner = await registerUser(app, { email: "usage-top-owner@zoiko.test" });

    const domain = await prisma.mailDomain.create({
      data: {
        tenantId: owner.tenantId,
        domainName: "top-test.zoiko.test",
        verificationStatus: "VERIFIED",
        verificationToken: "tok-top",
        sendingEnabled: true,
      },
    });
    const busy = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, address: "busy@top-test.zoiko.test", membershipId: owner.membershipId },
    });
    await prisma.mailDomain.create({
      data: {
        tenantId: owner.tenantId,
        domainName: "top-test2.zoiko.test",
        verificationStatus: "VERIFIED",
        verificationToken: "tok-top2",
        sendingEnabled: true,
      },
    });

    const member = await registerUser(app, {
      email: "usage-top-member@zoiko.test",
    });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const membership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: owner.tenantId, userId: member.userId },
    });
    const idle = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, address: "idle@top-test2.zoiko.test", membershipId: membership.id },
    });

    const mkMessage = (subject: string) =>
      prisma.emailMessage.create({
        data: { tenantId: owner.tenantId, authorUserId: owner.userId, subject, status: "SENT" },
      });

    const m1 = await mkMessage("t1");
    const m2 = await mkMessage("t2");
    const m3 = await mkMessage("t3");
    const m4 = await mkMessage("t4");

    await prisma.mailboxMessage.createMany({
      data: [
        { tenantId: owner.tenantId, mailboxId: busy.id, messageId: m1.id, folder: "INBOX" },
        { tenantId: owner.tenantId, mailboxId: busy.id, messageId: m2.id, folder: "INBOX" },
        { tenantId: owner.tenantId, mailboxId: busy.id, messageId: m3.id, folder: "SENT" },
        { tenantId: owner.tenantId, mailboxId: idle.id, messageId: m4.id, folder: "INBOX" },
      ],
    });

    const res = await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const top = res.body.data.topMailboxes as Array<{ address: string; messageCount: number }>;
    expect(top).toHaveLength(2);
    expect(top[0]).toEqual({ address: "busy@top-test.zoiko.test", messageCount: 3 });
    expect(top[1]).toEqual({ address: "idle@top-test2.zoiko.test", messageCount: 1 });

    await prisma.mailbox.delete({ where: { id: busy.id } });
    await prisma.mailbox.delete({ where: { id: idle.id } });
    await prisma.mailDomain.delete({ where: { id: domain.id } });
    await prisma.mailDomain.delete({
      where: { tenantId_domainName: { tenantId: owner.tenantId, domainName: "top-test2.zoiko.test" } },
    });
  });

  it("forbids members but allows admins", async () => {
    const { owner, memberToken } = await addMember("usage-rbac-owner@zoiko.test", "MEMBER");

    await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(memberToken))
      .expect(403);

    const admin = await registerUser(app, {
      email: "usage-rbac-admin@zoiko.test",
    });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" })
      .expect(201);
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: admin.password, tenantId: owner.tenantId })
      .expect(200);

    await request(app)
      .get("/api/v1/tenants/usage")
      .set(authHeader(adminLogin.body.data.session.accessToken))
      .expect(200);
  });

  it("requires authentication", async () => {
    await request(app).get("/api/v1/tenants/usage").expect(401);
  });
});
