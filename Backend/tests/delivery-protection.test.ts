import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { connectorService } from "../src/modules/connector/connector.service.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

async function allowSending(accessToken: string) {
  const policy = await request(app).post("/api/v1/policies")
    .set(authHeader(accessToken))
    .send({ type: "SENDING", name: "Allow sending", rules: { defaultEffect: "ALLOW", conditions: [] } })
    .expect(201);
  await request(app).post(`/api/v1/policies/${policy.body.data.id}/activate`)
    .set(authHeader(accessToken)).expect(200);
}

async function providerAccount(user: Awaited<ReturnType<typeof registerUser>>, id: string) {
  return prisma.connectedAccount.create({
    data: {
      tenantId: user.tenantId,
      membershipId: user.membershipId,
      userId: user.userId,
      provider: "GMAIL",
      providerAccountId: id,
      email: user.email,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      status: "ACTIVE",
    },
  });
}

describe("Delivery protection", () => {
  it("enforces stage-zero daily warm-up limits and promotes only eligible mailboxes", async () => {
    const owner = await registerUser(app, { email: "warmup-owner@zoiko.test" });
    await allowSending(owner.accessToken);
    const recipients = Array.from({ length: 11 }, (_, index) => `external-${index}@example.test`);
    const draft = await request(app).post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Warm-up", recipients: { to: recipients } }).expect(201);
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(429);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { membershipId: owner.membershipId } });
    expect(mailbox.warmupDailyCount).toBe(0);

    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { warmupStageStartedAt: new Date(Date.now() - 4 * 86_400_000) },
    });
    const promoted = await request(app)
      .post(`/api/v1/delivery-protection/mailboxes/${mailbox.id}/warmup/evaluate`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect(promoted.body.data.warmupStage).toBe(1);
  });

  it("blocks hashed suppression-list recipients without storing their address", async () => {
    const owner = await registerUser(app, { email: "suppression-owner@zoiko.test" });
    await allowSending(owner.accessToken);
    const suppression = await request(app).post("/api/v1/delivery-protection/suppressions")
      .set(authHeader(owner.accessToken))
      .send({ email: "blocked@example.test", reason: "ADMIN" }).expect(201);
    expect(suppression.body.data.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(suppression.body.data)).not.toContain("blocked@example.test");
    const draft = await request(app).post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Suppressed", recipients: { to: ["blocked@example.test"] } }).expect(201);
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(409);
  });

  it("normalizes bounces, suppresses recipients and suspends abusive sending", async () => {
    const owner = await registerUser(app, { email: "bounce-owner@zoiko.test" });
    await allowSending(owner.accessToken);
    await providerAccount(owner, "bounce-provider-account");
    const draft = await request(app).post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Bounce", recipients: { to: ["bounce@example.test"] } }).expect(201);
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(200);
    const recipient = await prisma.messageRecipient.findFirstOrThrow({
      where: { tenantId: owner.tenantId, messageId: draft.body.data.id },
    });
    await connectorService.receiveEvent("GMAIL", {
      providerEventId: "bounce-event-1",
      providerAccountId: "bounce-provider-account",
      eventType: "BOUNCED",
      resourceType: "RECIPIENT",
      resourceId: recipient.id,
      occurredAt: new Date().toISOString(),
    });
    expect(await connectorService.processNextEvent()).toMatchObject({ status: "PROCESSED" });
    expect(await prisma.suppressionEntry.count({ where: { tenantId: owner.tenantId, active: true } })).toBe(1);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { membershipId: owner.membershipId } });
    expect(mailbox.sendSuspendedAt).not.toBeNull();
    expect(await prisma.deliveryEvent.count({
      where: { tenantId: owner.tenantId, messageId: draft.body.data.id, type: "BOUNCED" },
    })).toBe(1);
  });

  it("normalizes malware verdicts, quarantines mail and blocks attachments", async () => {
    const owner = await registerUser(app, { email: "security-owner@zoiko.test" });
    const member = await registerUser(app, { email: "security-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    await allowSending(owner.accessToken);
    await providerAccount(owner, "security-provider-account");
    const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
      .send({ subject: "Security", recipients: { to: [member.email] } }).expect(201);
    const attachment = await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`)
      .set(authHeader(owner.accessToken))
      .attach("file", Buffer.from("unsafe"), { filename: "unsafe.txt", contentType: "text/plain" })
      .expect(201);
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(200);
    await connectorService.receiveEvent("GMAIL", {
      providerEventId: "malware-event-1",
      providerAccountId: "security-provider-account",
      eventType: "MALWARE_DETECTED",
      resourceType: "MESSAGE",
      resourceId: draft.body.data.id,
      occurredAt: new Date().toISOString(),
    });
    expect(await connectorService.processNextEvent()).toMatchObject({ status: "PROCESSED" });
    const quarantined = await request(app).get("/api/v1/mail?folder=QUARANTINE")
      .set(authHeader(login.body.data.session.accessToken)).expect(200);
    expect(quarantined.body.data.items).toHaveLength(1);
    await request(app).get(`/api/v1/mail/${draft.body.data.id}/attachments/${attachment.body.data.id}`)
      .set(authHeader(login.body.data.session.accessToken)).expect(403);
  });
});
