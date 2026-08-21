import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

async function addMember(ownerEmail: string) {
  const owner = await registerUser(app, { email: ownerEmail });
  const member = await registerUser(app, {
    email: ownerEmail.replace("@", `-m@`),
  });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: member.email, role: "MEMBER" })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
    .expect(200);
  return { owner, memberToken: login.body.data.session.accessToken as string };
}

async function seedMessageWithEvents(
  tenantId: string,
  authorUserId: string,
  subject: string,
  events: { type: "DELIVERED" | "BOUNCED"; failureCode?: string; createdAt?: Date }[]
) {
  const message = await prisma.emailMessage.create({
    data: {
      tenantId,
      authorUserId,
      subject,
      status: "SENT",
      sentAt: new Date(),
      fromAddress: `sender@${subject.split(" ")[0].toLowerCase()}.test`,
    },
  });
  await prisma.messageRecipient.create({
    data: {
      tenantId,
      messageId: message.id,
      email: `rcpt-${message.id.slice(0, 8)}@dest.test`,
      type: "TO",
      deliveryStatus: "DELIVERED",
    },
  });
  for (const ev of events) {
    await prisma.deliveryEvent.create({
      data: {
        tenantId,
        messageId: message.id,
        type: ev.type,
        failureCode: ev.failureCode ?? null,
        failureReason: ev.failureCode ? "mailbox unavailable" : null,
        createdAt: ev.createdAt ?? new Date(),
      },
    });
  }
  return message;
}

describe("GET /api/v1/mail/admin/delivery-events", () => {
  it("returns the tenant's delivery events newest-first with joined message info", async () => {
    const owner = await registerUser(app, { email: "devents-owner@zoiko.test" });

    await seedMessageWithEvents(owner.tenantId, owner.userId, "Older message", [
      { type: "DELIVERED", createdAt: new Date(Date.now() - 60_000) },
    ]);
    await seedMessageWithEvents(owner.tenantId, owner.userId, "Newer message", [
      { type: "BOUNCED", failureCode: "550", createdAt: new Date() },
    ]);

    const res = await request(app)
      .get("/api/v1/mail/admin/delivery-events")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const events = res.body.data.events;
    expect(events).toHaveLength(2);
    expect(new Date(events[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(events[1].createdAt).getTime()
    );
    expect(events[0].type).toBe("BOUNCED");
    expect(events[0].failureCode).toBe("550");
    expect(events[0].failureReason).toBe("mailbox unavailable");
    expect(events[0].subject).toBe("Newer message");
    expect(events[0].fromAddress).toContain("newer");
    expect(events[0].recipients).toHaveLength(1);
    expect(events[0].messageId).toEqual(expect.any(String));
  });

  it("filters by event type and respects limit", async () => {
    const owner = await registerUser(app, { email: "devents-filter-owner@zoiko.test" });
    const msg = await seedMessageWithEvents(owner.tenantId, owner.userId, "Filter subject", [
      { type: "DELIVERED" },
      { type: "BOUNCED", failureCode: "550" },
      { type: "DEFERRED" },
    ]);

    const bounced = await request(app)
      .get("/api/v1/mail/admin/delivery-events?type=BOUNCED")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(bounced.body.data.events).toHaveLength(1);
    expect(bounced.body.data.events[0].type).toBe("BOUNCED");

    const limited = await request(app)
      .get("/api/v1/mail/admin/delivery-events?limit=2")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(limited.body.data.events).toHaveLength(2);

    // Sanity: the seeded message id is referenced by its events.
    const byMessage = await prisma.deliveryEvent.count({ where: { messageId: msg.id } });
    expect(byMessage).toBe(3);
  });

  it("is tenant-scoped and rejects other tenants' rows", async () => {
    const ownerA = await registerUser(app, { email: "devents-a-owner@zoiko.test" });
    const ownerB = await registerUser(app, { email: "devents-b-owner@zoiko.test" });

    await seedMessageWithEvents(ownerA.tenantId, ownerA.userId, "Tenant A only", [{ type: "DELIVERED" }]);
    await seedMessageWithEvents(ownerB.tenantId, ownerB.userId, "Tenant B only", [{ type: "FAILED" }]);

    const res = await request(app)
      .get("/api/v1/mail/admin/delivery-events")
      .set(authHeader(ownerA.accessToken))
      .expect(200);

    expect(res.body.data.events).toHaveLength(1);
    expect(res.body.data.events[0].subject).toBe("Tenant A only");
  });

  it("rejects invalid type filters and MEMBER role", async () => {
    const { owner, memberToken } = await addMember("devents-member-owner@zoiko.test");
    await seedMessageWithEvents(owner.tenantId, owner.userId, "Any subject", [{ type: "DELIVERED" }]);

    await request(app)
      .get("/api/v1/mail/admin/delivery-events?type=NOT_A_TYPE")
      .set(authHeader(owner.accessToken))
      .expect(400);

    await request(app)
      .get("/api/v1/mail/admin/delivery-events")
      .set(authHeader(memberToken))
      .expect(403);
  });
});

describe("GET /api/v1/connectors/provider-events", () => {
  async function seedAccountWithEvents(
    tenantId: string,
    membershipId: string,
    userId: string,
    accountSuffix: string,
    events: { eventType: string; status: "PROCESSED" | "FAILED"; errorCode?: string; hash: string }[]
  ) {
    const account = await prisma.connectedAccount.create({
      data: {
        tenantId,
        membershipId,
        userId,
        provider: "GMAIL",
        providerAccountId: `acct-${accountSuffix}`,
        email: `account-${accountSuffix}@gmail.test`,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        status: "ACTIVE",
      },
    });
    for (const ev of events) {
      await prisma.providerEvent.create({
        data: {
          tenantId,
          connectedAccountId: account.id,
          provider: "GMAIL",
          eventType: ev.eventType,
          eventHash: ev.hash,
          sanitizedPayload: { secret: `payload-${ev.hash}` },
          processingStatus: ev.status,
          errorCode: ev.errorCode ?? null,
        },
      });
    }
    return account;
  }

  it("lists metadata-only provider events with account info", async () => {
    const owner = await registerUser(app, { email: "pevents-owner@zoiko.test" });

    await seedAccountWithEvents(
      owner.tenantId, owner.membershipId, owner.userId, "pev-1",
      [
        { eventType: "MESSAGE_NEW", status: "PROCESSED", hash: "h1" },
        { eventType: "WATCH_EXPIRED", status: "FAILED", errorCode: "WATCH_DEADLINE_EXCEEDED", hash: "h2" },
      ]
    );

    const res = await request(app)
      .get("/api/v1/connectors/provider-events")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const events = res.body.data.events;
    expect(events).toHaveLength(2);
    expect(events[0].provider).toBe("GMAIL");
    expect(events[0].accountEmail).toBe("account-pev-1@gmail.test");
    expect(events[0].accountStatus).toBe("ACTIVE");
    expect(typeof events[0].attempts).toBe("number");

    // Payloads must never be exposed to owners.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("sanitizedPayload");
    expect(raw).not.toContain("payload-h1");
    expect(raw).not.toContain("normalizedResourceType");
  });

  it("filters by status and is tenant-scoped", async () => {
    const ownerA = await registerUser(app, { email: "pevents-a-owner@zoiko.test" });
    const ownerB = await registerUser(app, { email: "pevents-b-owner@zoiko.test" });

    await seedAccountWithEvents(
      ownerA.tenantId, ownerA.membershipId, ownerA.userId, "pev-a",
      [
        { eventType: "HISTORY_NEW", status: "PROCESSED", hash: "ha1" },
        { eventType: "SYNC_ERROR", status: "FAILED", errorCode: "E_SYNC", hash: "ha2" },
      ]
    );
    await seedAccountWithEvents(
      ownerB.tenantId, ownerB.membershipId, ownerB.userId, "pev-b",
      [{ eventType: "MESSAGE_NEW", status: "PROCESSED", hash: "hb1" }]
    );

    const failed = await request(app)
      .get("/api/v1/connectors/provider-events?status=FAILED")
      .set(authHeader(ownerA.accessToken))
      .expect(200);
    expect(failed.body.data.events).toHaveLength(1);
    expect(failed.body.data.events[0].eventType).toBe("SYNC_ERROR");
    expect(failed.body.data.events[0].errorCode).toBe("E_SYNC");

    const all = await request(app)
      .get("/api/v1/connectors/provider-events")
      .set(authHeader(ownerA.accessToken))
      .expect(200);
    expect(all.body.data.events).toHaveLength(2);
    all.body.data.events.forEach((e: { accountEmail: string }) => {
      expect(e.accountEmail.startsWith("account-pev-a@")).toBe(true);
    });
  });

  it("rejects invalid query params and MEMBER role", async () => {
    const { owner, memberToken } = await addMember("pevents-member-owner@zoiko.test");
    await seedAccountWithEvents(
      owner.tenantId, owner.membershipId, owner.userId, "pev-m",
      [{ eventType: "MESSAGE_NEW", status: "PROCESSED", hash: "hm1" }]
    );

    await request(app)
      .get("/api/v1/connectors/provider-events?status=NOPE")
      .set(authHeader(owner.accessToken))
      .expect(400);

    await request(app)
      .get("/api/v1/connectors/provider-events?provider=DROPBOX")
      .set(authHeader(owner.accessToken))
      .expect(400);

    await request(app)
      .get("/api/v1/connectors/provider-events")
      .set(authHeader(memberToken))
      .expect(403);
  });
});
