import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { connectorService } from "../src/modules/connector/connector.service.js";
import { recipientHash } from "../src/modules/delivery-protection/delivery-protection.service.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Complaint suppression — a recipient who marks our mail as spam is never
 * mailed again by that workspace.
 *
 * DeliveryProtectionService.processProviderSignal treats COMPLAINED the same
 * way as BOUNCED (a suppression entry, a counter on the sending mailbox, and a
 * suspension past the threshold), but only the bounce branch had a test. This
 * drives a COMPLAINED provider event through the same entry point the bounce
 * test uses — connectorService.receiveEvent then processNextEvent — and pins
 * the outcome, including that the suppression belongs to the workspace that
 * received the complaint and nobody else.
 */

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

async function sendTo(accessToken: string, to: string, expected: number) {
  const draft = await request(app).post("/api/v1/mail/drafts")
    .set(authHeader(accessToken))
    .send({ subject: "Complaint test", recipients: { to: [to] } }).expect(201);
  const sent = await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
    .set(authHeader(accessToken)).expect(expected);
  return { draftId: draft.body.data.id as string, response: sent };
}

/** Send once, then have the provider report that the recipient complained. */
async function complaintFrom(owner: Awaited<ReturnType<typeof registerUser>>, address: string, accountId: string) {
  await allowSending(owner.accessToken);
  await providerAccount(owner, accountId);
  const { draftId } = await sendTo(owner.accessToken, address, 200);
  const recipient = await prisma.messageRecipient.findFirstOrThrow({
    where: { tenantId: owner.tenantId, messageId: draftId },
  });
  await connectorService.receiveEvent("GMAIL", {
    providerEventId: `complaint-${accountId}`,
    providerAccountId: accountId,
    eventType: "COMPLAINED",
    resourceType: "RECIPIENT",
    resourceId: recipient.id,
    occurredAt: new Date().toISOString(),
  });
  expect(await connectorService.processNextEvent()).toMatchObject({ status: "PROCESSED" });
  return { draftId, recipient };
}

describe("a spam complaint suppresses the recipient", () => {
  it("records the complaint and adds a hashed COMPLAINT suppression for the workspace", async () => {
    const owner = await registerUser(app, { email: `complaint-owner-${Date.now()}@zoiko.test` });
    const address = "Complainer@Example.test";
    const { draftId, recipient } = await complaintFrom(owner, address, "complaint-account-1");

    const entries = await prisma.suppressionEntry.findMany({ where: { tenantId: owner.tenantId, active: true } });
    expect(entries).toHaveLength(1);
    expect(entries[0].reason).toBe("COMPLAINT");
    // Stored as a hash of the normalised address, never the address itself.
    expect(entries[0].emailHash).toBe(recipientHash(address));
    expect(JSON.stringify(entries[0])).not.toContain("omplainer");

    expect(await prisma.deliveryEvent.count({
      where: { tenantId: owner.tenantId, messageId: draftId, type: "COMPLAINED" },
    })).toBe(1);
    const after = await prisma.messageRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(after.deliveryStatus).toBe("FAILED");
  });

  it("counts the complaint against the sending mailbox and suspends it at warm-up stage zero", async () => {
    const owner = await registerUser(app, { email: `complaint-suspend-${Date.now()}@zoiko.test` });
    await complaintFrom(owner, "spam-button@example.test", "complaint-account-2");

    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { membershipId: owner.membershipId } });
    expect(mailbox.complaintCount).toBe(1);
    expect(mailbox.bounceCount).toBe(0);
    expect(mailbox.sendSuspendedAt).not.toBeNull();
    expect(mailbox.sendSuspensionReason).toBe("Complaint threshold exceeded");
  });

  it("refuses a later send to the complainant the same way it refuses a bounced address", async () => {
    const owner = await registerUser(app, { email: `complaint-resend-${Date.now()}@zoiko.test` });
    await complaintFrom(owner, "no-more@example.test", "complaint-account-3");

    // Suppression is checked before the mailbox's suspension, so the refusal
    // is the suppression one (409), whatever the casing of the address.
    const { response } = await sendTo(owner.accessToken, "NO-MORE@example.test", 409);
    expect(response.body.error.message).toContain("COMPLAINT");
  });

  it("is scoped to the workspace that received the complaint", async () => {
    const owner = await registerUser(app, { email: `complaint-scope-a-${Date.now()}@zoiko.test` });
    await complaintFrom(owner, "shared-contact@example.test", "complaint-account-4");

    const other = await registerUser(app, { email: `complaint-scope-b-${Date.now()}@zoiko.test` });
    await allowSending(other.accessToken);
    await providerAccount(other, "complaint-account-5");

    expect(await prisma.suppressionEntry.count({ where: { tenantId: other.tenantId } })).toBe(0);
    // Another workspace may still write to the same person: the complaint was
    // about the first workspace's mail.
    await sendTo(other.accessToken, "shared-contact@example.test", 200);
  });
});
