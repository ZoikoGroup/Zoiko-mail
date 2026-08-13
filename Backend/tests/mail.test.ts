import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { mailService } from "../src/modules/mail/mail.service.js";

const app = createApp();

async function activateAllowSendingPolicy(accessToken: string) {
  const created = await request(app)
    .post("/api/v1/policies")
    .set(authHeader(accessToken))
    .send({
      type: "SENDING",
      name: "Allow sending",
      rules: { defaultEffect: "ALLOW", conditions: [] },
    })
    .expect(201);
  await request(app)
    .post(`/api/v1/policies/${created.body.data.id}/activate`)
    .set(authHeader(accessToken))
    .expect(200);
}

describe("Mail module", () => {
  it("creates a draft and fails closed when no sending policy is active", async () => {
    const owner = await registerUser(app, { email: "mail-policy@zoiko.test" });
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({
        subject: "Policy check",
        textBody: "Hello",
        recipients: { to: ["external@example.com"] },
      })
      .expect(201);

    const denied = await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(403);
    expect(denied.body.error.message).toContain("NO_ACTIVE_POLICY");
  });

  it("delivers internal mail to inbox and queues external recipients", async () => {
    const owner = await registerUser(app, { email: "sender@zoiko.test" });
    const member = await registerUser(app, { email: "recipient@zoiko.test" });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const memberLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    await activateAllowSendingPolicy(owner.accessToken);

    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({
        subject: "Welcome",
        textBody: "Internal delivery",
        recipients: { to: [member.email, "outside@example.com"] },
      })
      .expect(201);
    const sent = await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(sent.body.data.status).toBe("SENT");
    expect(sent.body.data.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: member.email, deliveryStatus: "DELIVERED" }),
      expect.objectContaining({ email: "outside@example.com", deliveryStatus: "QUEUED" }),
    ]));
    const deliveryEvents = await request(app)
      .get(`/api/v1/mail/${draft.body.data.id}/delivery-events`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(deliveryEvents.body.data.events.map((event: { type: string }) => event.type)).toEqual(
      expect.arrayContaining(["DELIVERED", "QUEUED"])
    );

    const inbox = await request(app)
      .get("/api/v1/mail?folder=INBOX")
      .set(authHeader(memberLogin.body.data.session.accessToken))
      .expect(200);
    expect(inbox.body.data.items).toHaveLength(1);
    expect(inbox.body.data.items[0].message.subject).toBe("Welcome");

    await request(app)
      .patch(`/api/v1/mail/${draft.body.data.id}`)
      .set(authHeader(memberLogin.body.data.session.accessToken))
      .send({ isRead: true, folder: "TRASH" })
      .expect(200);
    const trash = await request(app)
      .get("/api/v1/mail?folder=TRASH")
      .set(authHeader(memberLogin.body.data.session.accessToken))
      .expect(200);
    expect(trash.body.data.items[0].isRead).toBe(true);
  });

  it("prevents another tenant from reading a message by id", async () => {
    const first = await registerUser(app, { email: "mail-first@zoiko.test" });
    const second = await registerUser(app, { email: "mail-second@zoiko.test" });
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(first.accessToken))
      .send({ subject: "Private", recipients: { to: ["outside@example.com"] } })
      .expect(201);

    await request(app)
      .get(`/api/v1/mail/${draft.body.data.id}`)
      .set(authHeader(second.accessToken))
      .expect(404);
  });

  it("uploads, authorizes, downloads and deletes a draft attachment", async () => {
    const owner = await registerUser(app, { email: "attachment-owner@zoiko.test" });
    const outsider = await registerUser(app, { email: "attachment-outsider@zoiko.test" });
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Attachment", recipients: { to: ["outside@example.com"] } })
      .expect(201);

    const uploaded = await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`)
      .set(authHeader(owner.accessToken))
      .attach("file", Buffer.from("confidential attachment"), {
        filename: "evidence.txt",
        contentType: "text/plain",
      })
      .expect(201);
    expect(uploaded.body.data).toMatchObject({
      fileName: "evidence.txt",
      contentType: "text/plain",
      sizeBytes: 23,
    });
    expect(uploaded.body.data.storageKey).toBeUndefined();

    await request(app)
      .get(`/api/v1/mail/${draft.body.data.id}/attachments/${uploaded.body.data.id}`)
      .set(authHeader(outsider.accessToken))
      .expect(404);

    const downloaded = await request(app)
      .get(`/api/v1/mail/${draft.body.data.id}/attachments/${uploaded.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(downloaded.body.toString()).toBe("confidential attachment");
    expect(downloaded.headers["content-disposition"]).toContain("evidence.txt");

    await request(app)
      .delete(`/api/v1/mail/drafts/${draft.body.data.id}/attachments/${uploaded.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    await request(app)
      .get(`/api/v1/mail/${draft.body.data.id}/attachments/${uploaded.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(404);
  });

  it("rejects unsafe types and enforces mailbox storage quota", async () => {
    const owner = await registerUser(app, { email: "attachment-quota@zoiko.test" });
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Quota", recipients: { to: ["outside@example.com"] } })
      .expect(201);

    await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`)
      .set(authHeader(owner.accessToken))
      .attach("file", Buffer.from("script"), { filename: "bad.exe", contentType: "application/x-msdownload" })
      .expect(415);

    await prisma.mailbox.update({
      where: { membershipId: owner.membershipId },
      data: { storageLimit: 2 },
    });
    await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`)
      .set(authHeader(owner.accessToken))
      .attach("file", Buffer.from("too large for quota"), { filename: "quota.txt", contentType: "text/plain" })
      .expect(413);
  });

  it("enforces persistent send limits and audited mailbox suspension", async () => {
    const owner = await registerUser(app, { email: "send-controls@zoiko.test" });
    await activateAllowSendingPolicy(owner.accessToken);
    const firstDraft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "Rate limited", recipients: { to: ["outside@example.com"] } })
      .expect(201);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({
      where: { membershipId: owner.membershipId },
    });
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        sendRecipientCount: env.MAIL_MAX_RECIPIENTS_PER_WINDOW,
        sendWindowStartedAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect((await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id } })).sendRecipientCount)
      .toBe(env.MAIL_MAX_RECIPIENTS_PER_WINDOW);
    await request(app)
      .post(`/api/v1/mail/drafts/${firstDraft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(429);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailbox.id}/sending`)
      .set(authHeader(owner.accessToken))
      .send({ suspended: true, reason: "Abuse review" })
      .expect(200);
    await request(app)
      .post(`/api/v1/mail/drafts/${firstDraft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(403);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailbox.id}/sending`)
      .set(authHeader(owner.accessToken))
      .send({ suspended: false })
      .expect(200);
    await request(app)
      .post(`/api/v1/mail/drafts/${firstDraft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const auditTypes = (await prisma.auditEvent.findMany({
      where: { tenantId: owner.tenantId },
      select: { eventType: true },
    })).map((event) => event.eventType);
    expect(auditTypes).toEqual(expect.arrayContaining([
      "MAIL_SEND_RATE_LIMITED",
      "MAILBOX_SENDING_SUSPENDED",
      "MAIL_SEND_SUSPENDED_DENIED",
      "MAILBOX_SENDING_RESUMED",
    ]));
  });

  it("creates secure reply, reply-all and forward drafts", async () => {
    const owner = await registerUser(app, { email: "conversation-owner@zoiko.test" });
    const member = await registerUser(app, { email: "conversation-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const memberToken = login.body.data.session.accessToken;
    await activateAllowSendingPolicy(owner.accessToken);
    const original = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
      .send({ subject: "Project update", textBody: "Original body", recipients: { to: [member.email], cc: ["copy@example.com"], bcc: ["hidden@example.com"] } }).expect(201);
    await request(app).post(`/api/v1/mail/drafts/${original.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(200);

    const replyAll = await request(app).post(`/api/v1/mail/${original.body.data.id}/reply-all`)
      .set(authHeader(memberToken)).send({ textBody: "Thanks" }).expect(201);
    expect(replyAll.body.data.threadId).toBe(original.body.data.threadId);
    expect(replyAll.body.data.subject).toBe("Re: Project update");
    expect(replyAll.body.data.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: owner.email, type: "TO" }),
      expect.objectContaining({ email: "copy@example.com", type: "CC" }),
    ]));
    expect(replyAll.body.data.recipients.some((recipient: { email: string }) => recipient.email === "hidden@example.com")).toBe(false);

    const forwarded = await request(app).post(`/api/v1/mail/${original.body.data.id}/forward`)
      .set(authHeader(memberToken)).send({ textBody: "Please review", recipients: { to: ["forward@example.com"] } }).expect(201);
    expect(forwarded.body.data.subject).toBe("Fwd: Project update");
    expect(forwarded.body.data.threadId).not.toBe(original.body.data.threadId);

    const outsider = await registerUser(app, { email: "conversation-outsider@zoiko.test" });
    await request(app).post(`/api/v1/mail/${original.body.data.id}/reply`)
      .set(authHeader(outsider.accessToken)).send({ textBody: "Unauthorized" }).expect(404);
  });

  it("deletes owned drafts and permanently cleans only the current mailbox trash", async () => {
    const owner = await registerUser(app, { email: "cleanup-owner@zoiko.test" });
    const member = await registerUser(app, { email: "cleanup-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const memberLogin = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const memberToken = memberLogin.body.data.session.accessToken;

    const unusedDraft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
      .send({ subject: "Unused", recipients: { to: ["outside@example.com"] } }).expect(201);
    await request(app).delete(`/api/v1/mail/drafts/${unusedDraft.body.data.id}`)
      .set(authHeader(memberToken)).expect(404);
    await request(app).delete(`/api/v1/mail/drafts/${unusedDraft.body.data.id}`)
      .set(authHeader(owner.accessToken)).expect(200);
    await request(app).get(`/api/v1/mail/${unusedDraft.body.data.id}`)
      .set(authHeader(owner.accessToken)).expect(404);

    await activateAllowSendingPolicy(owner.accessToken);
    const sentIds: string[] = [];
    for (const subject of ["Trash one", "Trash two"]) {
      const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
        .send({ subject, recipients: { to: [member.email] } }).expect(201);
      await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
        .set(authHeader(owner.accessToken)).expect(200);
      sentIds.push(draft.body.data.id);
      await request(app).patch(`/api/v1/mail/${draft.body.data.id}`).set(authHeader(memberToken))
        .send({ folder: "TRASH" }).expect(200);
    }

    await request(app).delete(`/api/v1/mail/${sentIds[0]}`).set(authHeader(memberToken)).expect(200);
    await request(app).delete(`/api/v1/mail/${sentIds[0]}`).set(authHeader(memberToken)).expect(404);
    const emptied = await request(app).delete("/api/v1/mail/trash").set(authHeader(memberToken)).expect(200);
    expect(emptied.body.data.deletedCount).toBe(1);
    const trash = await request(app).get("/api/v1/mail?folder=TRASH").set(authHeader(memberToken)).expect(200);
    expect(trash.body.data.items).toHaveLength(0);

    await request(app).get(`/api/v1/mail/${sentIds[0]}`).set(authHeader(owner.accessToken)).expect(200);
  });

  it("supports starred, archived and tenant-safe bulk mailbox actions", async () => {
    const owner = await registerUser(app, { email: "bulk-owner@zoiko.test" });
    const member = await registerUser(app, { email: "bulk-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const memberToken = login.body.data.session.accessToken;
    await activateAllowSendingPolicy(owner.accessToken);

    const messageIds: string[] = [];
    for (const subject of ["Bulk first", "Bulk second"]) {
      const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
        .send({ subject, recipients: { to: [member.email] } }).expect(201);
      await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
        .set(authHeader(owner.accessToken)).expect(200);
      messageIds.push(draft.body.data.id);
    }

    await request(app).patch("/api/v1/mail/bulk").set(authHeader(memberToken))
      .send({ messageIds, action: "MARK_READ" }).expect(200);
    await request(app).patch("/api/v1/mail/bulk").set(authHeader(memberToken))
      .send({ messageIds, action: "STAR" }).expect(200);
    const archived = await request(app).patch("/api/v1/mail/bulk").set(authHeader(memberToken))
      .send({ messageIds, action: "ARCHIVE" }).expect(200);
    expect(archived.body.data.affectedCount).toBe(2);

    const starredArchive = await request(app).get("/api/v1/mail?folder=ARCHIVE&starredOnly=true")
      .set(authHeader(memberToken)).expect(200);
    expect(starredArchive.body.data.items).toHaveLength(2);
    expect(starredArchive.body.data.items.every((item: { isRead: boolean; isStarred: boolean }) =>
      item.isRead && item.isStarred)).toBe(true);

    const outsider = await registerUser(app, { email: "bulk-outsider@zoiko.test" });
    const outsiderDraft = await request(app).post("/api/v1/mail/drafts").set(authHeader(outsider.accessToken))
      .send({ subject: "Other tenant", recipients: { to: ["outside@example.com"] } }).expect(201);
    await request(app).patch("/api/v1/mail/bulk").set(authHeader(memberToken))
      .send({ messageIds: [messageIds[0], outsiderDraft.body.data.id], action: "TRASH" }).expect(404);

    const unchanged = await request(app).get("/api/v1/mail?folder=ARCHIVE")
      .set(authHeader(memberToken)).expect(200);
    expect(unchanged.body.data.items).toHaveLength(2);
    await request(app).patch("/api/v1/mail/bulk").set(authHeader(memberToken))
      .send({ messageIds, action: "RESTORE" }).expect(200);
    const inbox = await request(app).get("/api/v1/mail?folder=INBOX")
      .set(authHeader(memberToken)).expect(200);
    expect(inbox.body.data.items).toHaveLength(2);
  });

  it("manages mailbox-private labels and filters labeled messages", async () => {
    const owner = await registerUser(app, { email: "label-owner@zoiko.test" });
    const member = await registerUser(app, { email: "label-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    const memberToken = login.body.data.session.accessToken;
    await activateAllowSendingPolicy(owner.accessToken);
    const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(owner.accessToken))
      .send({ subject: "Label target", recipients: { to: [member.email] } }).expect(201);
    await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken)).expect(200);

    const created = await request(app).post("/api/v1/mail/labels").set(authHeader(memberToken))
      .send({ name: "Important", color: "#ff8800" }).expect(201);
    expect(created.body.data.color).toBe("#FF8800");
    const labelId = created.body.data.id;
    await request(app).post("/api/v1/mail/labels").set(authHeader(memberToken))
      .send({ name: "important", color: "#000000" }).expect(409);
    await request(app).put(`/api/v1/mail/${draft.body.data.id}/labels/${labelId}`)
      .set(authHeader(memberToken)).expect(200);

    const filtered = await request(app).get(`/api/v1/mail?folder=INBOX&labelId=${labelId}`)
      .set(authHeader(memberToken)).expect(200);
    expect(filtered.body.data.items).toHaveLength(1);
    expect(filtered.body.data.items[0].labels).toEqual([
      expect.objectContaining({ id: labelId, name: "Important" }),
    ]);
    await request(app).patch(`/api/v1/mail/labels/${labelId}`).set(authHeader(owner.accessToken))
      .send({ name: "Unauthorized" }).expect(404);

    await request(app).delete(`/api/v1/mail/${draft.body.data.id}/labels/${labelId}`)
      .set(authHeader(memberToken)).expect(200);
    const noMatches = await request(app).get(`/api/v1/mail?folder=INBOX&labelId=${labelId}`)
      .set(authHeader(memberToken)).expect(200);
    expect(noMatches.body.data.items).toHaveLength(0);
    await request(app).delete(`/api/v1/mail/labels/${labelId}`).set(authHeader(memberToken)).expect(200);
  });

  it("schedules, cancels and safely processes due messages", async () => {
    const owner = await registerUser(app, { email: "schedule-owner@zoiko.test" });
    const member = await registerUser(app, { email: "schedule-member@zoiko.test" });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" }).expect(201);
    const login = await request(app).post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId }).expect(200);
    await activateAllowSendingPolicy(owner.accessToken);

    const create = async (subject: string) => request(app).post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject, recipients: { to: [member.email] } }).expect(201);
    const cancelledDraft = await create("Cancel schedule");
    const future = new Date(Date.now() + 120_000).toISOString();
    await request(app).post(`/api/v1/mail/drafts/${cancelledDraft.body.data.id}/schedule`)
      .set(authHeader(owner.accessToken)).send({ scheduledAt: future }).expect(202);
    await request(app).delete(`/api/v1/mail/drafts/${cancelledDraft.body.data.id}/schedule`)
      .set(authHeader(owner.accessToken)).expect(200);
    expect((await prisma.emailMessage.findUniqueOrThrow({
      where: { id: cancelledDraft.body.data.id },
    })).status).toBe("DRAFT");

    const dueDraft = await create("Due schedule");
    await request(app).post(`/api/v1/mail/drafts/${dueDraft.body.data.id}/schedule`)
      .set(authHeader(owner.accessToken)).send({ scheduledAt: future }).expect(202);
    await prisma.emailMessage.update({
      where: { id: dueDraft.body.data.id },
      data: { scheduledAt: new Date(Date.now() - 1_000) },
    });
    const processed = await mailService.processDueScheduled();
    expect(processed.sent).toBe(1);
    const sent = await prisma.emailMessage.findUniqueOrThrow({ where: { id: dueDraft.body.data.id } });
    expect(sent.status).toBe("SENT");
    expect(sent.sentAt).not.toBeNull();
    const inbox = await request(app).get("/api/v1/mail?folder=INBOX")
      .set(authHeader(login.body.data.session.accessToken)).expect(200);
    expect(inbox.body.data.items).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ subject: "Due schedule" }) }),
    ]);
  });
});
