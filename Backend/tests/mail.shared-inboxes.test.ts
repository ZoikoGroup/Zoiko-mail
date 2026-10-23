import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

/**
 * The webmail's "Shared inboxes" section: GET /mail/shared-inboxes lists the
 * mailboxes a person can read besides their own, with real unread counts, and
 * PATCH /mail/:id?mailboxId= lets them mark one read there — read access for
 * read and star, manage access to move a message out of the team's inbox.
 */

const app = createApp();
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

async function workspace() {
  const owner = await registerUser(app, { email: `${unique("si-owner")}@zoiko.test` });
  const memberEmail = `${unique("si-member")}@zoiko.test`;
  const member = await registerUser(app, { email: memberEmail });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: memberEmail, role: "MEMBER" })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId, workspace: "MEMBER" })
    .expect(200);
  const session = login.body.data.session ?? login.body.data;
  return { owner, memberToken: session.accessToken as string, membershipId: added.body.data.id as string };
}

async function sharedMailbox(ownerToken: string, membershipId: string, permissions: Record<string, boolean>) {
  const created = await request(app)
    .post("/api/v1/mail/admin/shared-mailboxes")
    .set(authHeader(ownerToken))
    .send({ address: `${unique("support")}@shared.test`, type: "SHARED" })
    .expect(201);
  await request(app)
    .post(`/api/v1/mail/admin/shared-mailboxes/${created.body.data.id}/assignees`)
    .set(authHeader(ownerToken))
    .send({ membershipId, ...permissions })
    .expect(200);
  return created.body.data as { id: string; address: string };
}

/** A received message sitting in a mailbox's Inbox. */
async function received(tenantId: string, authorUserId: string, mailboxId: string, isRead = false) {
  const message = await prisma.emailMessage.create({
    data: {
      tenantId,
      authorUserId,
      subject: unique("Customer question"),
      textBody: "Hello",
      status: "RECEIVED",
      fromAddress: "customer@outside.test",
      sentAt: new Date(),
      mailboxItems: { create: { tenantId, mailboxId, folder: "INBOX", isRead } },
    },
  });
  return message.id;
}

describe("shared inboxes in webmail", () => {
  it("lists the shared inboxes a person can read, with real unread counts, and nothing else", async () => {
    const w = await workspace();
    const readable = await sharedMailbox(w.owner.accessToken, w.membershipId, { canRead: true });
    // One they are not assigned to must not appear.
    await request(app)
      .post("/api/v1/mail/admin/shared-mailboxes")
      .set(authHeader(w.owner.accessToken))
      .send({ address: `${unique("private")}@shared.test`, type: "SHARED" })
      .expect(201);
    await received(w.owner.tenantId, w.owner.userId, readable.id);
    await received(w.owner.tenantId, w.owner.userId, readable.id);
    await received(w.owner.tenantId, w.owner.userId, readable.id, true);

    const res = await request(app).get("/api/v1/mail/shared-inboxes").set(authHeader(w.memberToken)).expect(200);
    expect(res.body.data.mailboxes).toEqual([
      expect.objectContaining({ id: readable.id, address: readable.address, unread: 2, delegated: false, canSend: false }),
    ]);
  });

  it("is empty for someone with no shared inboxes", async () => {
    const w = await workspace();
    const res = await request(app).get("/api/v1/mail/shared-inboxes").set(authHeader(w.memberToken)).expect(200);
    expect(res.body.data.mailboxes).toEqual([]);
  });

  it("marks a shared message read with read access, but needs manage access to move it", async () => {
    const w = await workspace();
    const mailbox = await sharedMailbox(w.owner.accessToken, w.membershipId, { canRead: true });
    const messageId = await received(w.owner.tenantId, w.owner.userId, mailbox.id);

    await request(app)
      .patch(`/api/v1/mail/${messageId}?mailboxId=${mailbox.id}`)
      .set(authHeader(w.memberToken))
      .send({ isRead: true })
      .expect(200);
    const after = await request(app).get("/api/v1/mail/shared-inboxes").set(authHeader(w.memberToken)).expect(200);
    expect(after.body.data.mailboxes[0].unread).toBe(0);

    await request(app)
      .patch(`/api/v1/mail/${messageId}?mailboxId=${mailbox.id}`)
      .set(authHeader(w.memberToken))
      .send({ folder: "ARCHIVE" })
      .expect(403);
    // Without the mailbox, the message is not in their own mailbox at all.
    await request(app).patch(`/api/v1/mail/${messageId}`).set(authHeader(w.memberToken)).send({ isRead: false }).expect(404);
  });
});
