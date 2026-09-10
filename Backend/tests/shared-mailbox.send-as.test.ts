import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Sending as a shared mailbox — Security §10.
 *
 * Assignment, the four permissions and shared-mailbox reading landed with the
 * shared mailbox itself, but `canSend` was stored, returned and never
 * consulted: the permission was decorative, and a send from a shared mailbox
 * went out from the author's own address with nothing recording which team
 * address it was meant to be. §10 asks for the opposite in as many words —
 * "all shared mailbox sends must capture actor_user_id and mailbox_id".
 *
 * So three things are pinned here: `canSend` actually gates composing,
 * revocation bites between drafting and sending, and the mailbox is recorded
 * on the message and in the audit trail.
 */

/** An owner, a member, and a shared mailbox — assignment left to each test. */
async function workspace(suffix: string) {
  const owner = await registerUser(app, { email: `sa-owner-${suffix}@zoiko.test` });
  const memberEmail = `sa-member-${suffix}@zoiko.test`;
  const member = await registerUser(app, { email: memberEmail });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: memberEmail, role: "MEMBER" })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
    .expect(200);
  const session = login.body.data.session ?? login.body.data;

  const shared = await request(app)
    .post("/api/v1/mail/admin/shared-mailboxes")
    .set(authHeader(owner.accessToken))
    .send({ address: `support-${suffix}@acme.test`, type: "SHARED" })
    .expect(201);

  return {
    owner,
    member: {
      ...member,
      accessToken: session.accessToken as string,
      membershipId: added.body.data.id as string,
    },
    mailboxId: shared.body.data.id as string,
    mailboxAddress: shared.body.data.address as string,
  };
}

const assign = (token: string, mailboxId: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/v1/mail/admin/shared-mailboxes/${mailboxId}/assignees`)
    .set(authHeader(token))
    .send(body);

const sendableMailboxes = (token: string) =>
  request(app).get("/api/v1/mail/send-as").set(authHeader(token));

const draft = (token: string, body: Record<string, unknown>) =>
  request(app).post("/api/v1/mail/drafts").set(authHeader(token)).send(body);

const draftBody = (to: string, extra: Record<string, unknown> = {}) => ({
  subject: "Ticket 4181",
  textBody: "Looking into it now.",
  recipients: { to: [to], cc: [], bcc: [] },
  ...extra,
});

const send = (token: string, messageId: string) =>
  request(app).post(`/api/v1/mail/drafts/${messageId}/send`).set(authHeader(token));

describe("which mailboxes a caller may send as", () => {
  it("offers only their own when nothing is shared with them", async () => {
    const { member } = await workspace(String(Date.now()));

    const res = await sendableMailboxes(member.accessToken).expect(200);

    expect(res.body.data.mailboxes).toHaveLength(1);
    expect(res.body.data.mailboxes[0].shared).toBe(false);
  });

  it("offers a shared mailbox once send is granted", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId, mailboxAddress } = await workspace(suffix);
    await assign(owner.accessToken, mailboxId, {
      membershipId: member.membershipId,
      canRead: true,
      canSend: true,
    }).expect(200);

    const res = await sendableMailboxes(member.accessToken).expect(200);

    const shared = res.body.data.mailboxes.find((m: { shared: boolean }) => m.shared);
    expect(shared.address).toBe(mailboxAddress);
    expect(shared.id).toBe(mailboxId);
  });

  it("withholds a mailbox assigned read-only", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await workspace(suffix);
    await assign(owner.accessToken, mailboxId, {
      membershipId: member.membershipId,
      canRead: true,
      canSend: false,
    }).expect(200);

    const res = await sendableMailboxes(member.accessToken).expect(200);

    // Offering it and refusing the send would be a worse answer than not
    // offering it: the picker is also a list of addresses, and read access is
    // not permission to know the team can send from this one.
    expect(res.body.data.mailboxes.every((m: { shared: boolean }) => !m.shared)).toBe(true);
  });
});

describe("canSend gates composing, and is no longer decorative", () => {
  it("refuses an assignee who holds read but not send", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await workspace(suffix);
    await assign(owner.accessToken, mailboxId, {
      membershipId: member.membershipId,
      canRead: true,
      canSend: false,
    }).expect(200);

    const refused = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(403);

    expect(refused.body.error.details.permission).toBe("canSend");
  });

  it("refuses someone not assigned at all, without confirming the mailbox exists", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await workspace(suffix);

    // 404, not 403: whether a particular shared mailbox exists is itself
    // information an unassigned member has no claim to.
    await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(404);
  });

  it("refuses a mailbox in another workspace", async () => {
    const suffix = String(Date.now());
    const mine = await workspace(`a-${suffix}`);
    const theirs = await workspace(`b-${suffix}`);

    await draft(
      mine.owner.accessToken,
      draftBody(mine.owner.email, { sendAsMailboxId: theirs.mailboxId })
    ).expect(404);
  });

  it("does not let a workspace role stand in for the assignment", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await workspace(suffix);

    // The owner created the mailbox and can administer it. Sending as it is a
    // mailbox-level question, and AC-005 turns on the two being different.
    await draft(
      owner.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(404);
  });
});

describe("a send as a shared mailbox", () => {
  async function assignedSender(suffix: string) {
    const ws = await workspace(suffix);
    await assign(ws.owner.accessToken, ws.mailboxId, {
      membershipId: ws.member.membershipId,
      canRead: true,
      canSend: true,
    }).expect(200);
    return ws;
  }

  it("records the mailbox on the message and puts the draft in it", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId, mailboxAddress } = await assignedSender(suffix);

    const created = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(201);

    const row = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: created.body.data.id },
      select: { sentAsMailboxId: true, fromAddress: true, authorUserId: true },
    });
    // §10's two facts: the actor and the mailbox.
    expect(row.sentAsMailboxId).toBe(mailboxId);
    expect(row.authorUserId).toBe(member.userId);
    expect(row.fromAddress).toBe(mailboxAddress);

    // In the shared mailbox rather than the author's own folder, so the rest
    // of the team can see the reply that is about to go out in their name.
    const drafts = await request(app)
      .get(`/api/v1/mail?folder=DRAFTS&mailboxId=${mailboxId}`)
      .set(authHeader(member.accessToken))
      .expect(200);
    expect(drafts.body.data.items).toHaveLength(1);
  });

  it("sends, lands the sent copy in the shared mailbox, and audits the mailbox", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId, mailboxAddress } = await assignedSender(suffix);
    const created = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(201);

    await send(member.accessToken, created.body.data.id).expect(200);

    const sent = await request(app)
      .get(`/api/v1/mail?folder=SENT&mailboxId=${mailboxId}`)
      .set(authHeader(member.accessToken))
      .expect(200);
    expect(sent.body.data.items).toHaveLength(1);

    const event = await prisma.auditEvent.findFirst({
      where: {
        tenantId: owner.tenantId,
        eventType: "MAIL_SENT",
        targetId: created.body.data.id,
      },
    });
    const metadata = event?.metadata as { sentAsMailboxId?: string; sentAsAddress?: string };
    // "Who sent that as support@?" has to be answerable from the trail alone.
    expect(event?.actorUserId).toBe(member.userId);
    expect(metadata.sentAsMailboxId).toBe(mailboxId);
    expect(metadata.sentAsAddress).toBe(mailboxAddress);
  });

  it("charges the shared mailbox's send window, not the author's", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await assignedSender(suffix);
    const created = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(201);

    await send(member.accessToken, created.body.data.id).expect(200);

    const shared = await prisma.mailbox.findUniqueOrThrow({
      where: { id: mailboxId },
      select: { sendRecipientCount: true },
    });
    const own = await prisma.mailbox.findFirst({
      where: { membershipId: member.membershipId },
      select: { sendRecipientCount: true },
    });
    // Otherwise a team could send through a shared address all day on
    // whichever member's personal cap happened to be free.
    expect(shared.sendRecipientCount).toBeGreaterThan(0);
    expect(own?.sendRecipientCount ?? 0).toBe(0);
  });

  it("leaves an ordinary send untouched", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await assignedSender(suffix);

    const created = await draft(member.accessToken, draftBody(owner.email)).expect(201);
    await send(member.accessToken, created.body.data.id).expect(200);

    const row = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: created.body.data.id },
      select: { sentAsMailboxId: true, fromAddress: true },
    });
    expect(row.sentAsMailboxId).toBeNull();
    expect(row.fromAddress).toBeNull();
  });

  it("refuses the send if access was revoked while the draft sat", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await assignedSender(suffix);
    const created = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(201);

    await request(app)
      .delete(`/api/v1/mail/admin/shared-mailboxes/${mailboxId}/assignees/${member.membershipId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    // §10: "removing user access must invalidate active shared mailbox
    // sessions". A draft already written is exactly the case where a
    // check-once-at-compose-time design would still send.
    await send(member.accessToken, created.body.data.id).expect(404);
  });

  it("refuses the send once send is narrowed to read", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await assignedSender(suffix);
    const created = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(201);

    await assign(owner.accessToken, mailboxId, {
      membershipId: member.membershipId,
      canRead: true,
      canSend: false,
    }).expect(200);

    const refused = await send(member.accessToken, created.body.data.id).expect(403);
    expect(refused.body.error.details.permission).toBe("canSend");
  });

  it("refuses the send while the shared mailbox is suspended", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId } = await assignedSender(suffix);
    const created = await draft(
      member.accessToken,
      draftBody(owner.email, { sendAsMailboxId: mailboxId })
    ).expect(201);

    await request(app)
      .patch(`/api/v1/mail/admin/mailboxes/${mailboxId}/sending`)
      .set(authHeader(owner.accessToken))
      .send({ suspended: true, reason: "Investigating a spam report" })
      .expect(200);

    // The suspension has to follow the mailbox being sent from, not the
    // person doing the sending.
    await send(member.accessToken, created.body.data.id).expect(403);
  });
});

describe("a shared draft stays usable after it is created", () => {
  async function sharedDraft(suffix: string) {
    const ws = await workspace(suffix);
    await assign(ws.owner.accessToken, ws.mailboxId, {
      membershipId: ws.member.membershipId,
      canRead: true,
      canSend: true,
    }).expect(200);
    const created = await draft(
      ws.member.accessToken,
      draftBody(ws.owner.email, { sendAsMailboxId: ws.mailboxId })
    ).expect(201);
    return { ...ws, messageId: created.body.data.id as string };
  }

  it("can be edited, though it lives in a mailbox that is not the author's", async () => {
    const { member, messageId } = await sharedDraft(String(Date.now()));

    // Before, the edit looked for the draft in the author's own mailbox and
    // 404ed on every send-as draft — composed once and then frozen.
    await request(app)
      .patch(`/api/v1/mail/drafts/${messageId}`)
      .set(authHeader(member.accessToken))
      .send({ subject: "Ticket 4181 — resolved" })
      .expect(200);
  });

  it("can be opened, since it can be listed", async () => {
    const { member, mailboxId, messageId } = await sharedDraft(String(Date.now()));

    await request(app)
      .get(`/api/v1/mail/${messageId}?mailboxId=${mailboxId}`)
      .set(authHeader(member.accessToken))
      .expect(200);
  });

  it("cannot be opened out of a mailbox the caller has no access to", async () => {
    const suffix = String(Date.now());
    const mine = await sharedDraft(`a-${suffix}`);
    const theirs = await workspace(`b-${suffix}`);

    await request(app)
      .get(`/api/v1/mail/${mine.messageId}?mailboxId=${theirs.mailboxId}`)
      .set(authHeader(mine.member.accessToken))
      .expect(404);
  });

  it("charges an attachment to the shared mailbox", async () => {
    const { member, mailboxId, messageId } = await sharedDraft(String(Date.now()));

    await request(app)
      .post(`/api/v1/mail/drafts/${messageId}/attachments`)
      .set(authHeader(member.accessToken))
      .attach("file", Buffer.from("case notes"), "notes.txt")
      .expect(201);

    const shared = await prisma.mailbox.findUniqueOrThrow({
      where: { id: mailboxId },
      select: { storageUsed: true },
    });
    const own = await prisma.mailbox.findFirst({
      where: { membershipId: member.membershipId },
      select: { storageUsed: true },
    });
    // The attachment belongs to the team's mailbox, and so does its cost.
    expect(Number(shared.storageUsed)).toBeGreaterThan(0);
    expect(Number(own?.storageUsed ?? 0)).toBe(0);
  });
});

describe("replying as a shared mailbox", () => {
  /**
   * A message sitting in the shared mailbox, seeded directly.
   *
   * Inbound routing to a shared address does not exist yet — delivery resolves
   * recipients through memberships, and a shared mailbox has none — so an
   * arriving support email cannot be produced through the API. The reply path
   * is what is under test here, and it does not care how the message arrived.
   */
  async function messageInSharedMailbox(suffix: string) {
    const ws = await workspace(suffix);
    await assign(ws.owner.accessToken, ws.mailboxId, {
      membershipId: ws.member.membershipId,
      canRead: true,
      canSend: true,
    }).expect(200);

    const now = new Date();
    const thread = await prisma.messageThread.create({
      data: {
        tenantId: ws.owner.tenantId,
        subjectNormalized: `invoice question ${suffix}`,
        participants: [`customer-${suffix}@example.test`, ws.mailboxAddress],
        firstMessageAt: now,
        lastMessageAt: now,
      },
    });
    const message = await prisma.emailMessage.create({
      data: {
        tenantId: ws.owner.tenantId,
        authorUserId: ws.owner.userId,
        threadId: thread.id,
        subject: `Invoice question ${suffix}`,
        textBody: "Could you check invoice 88?",
        status: "SENT",
        sentAt: now,
        fromAddress: `customer-${suffix}@example.test`,
        recipients: {
          create: [
            { tenantId: ws.owner.tenantId, email: ws.mailboxAddress, type: "TO" },
            { tenantId: ws.owner.tenantId, email: `cc-${suffix}@example.test`, type: "CC" },
          ],
        },
        mailboxItems: {
          create: { tenantId: ws.owner.tenantId, mailboxId: ws.mailboxId, folder: "INBOX" },
        },
      },
    });
    return { ...ws, messageId: message.id, threadId: thread.id };
  }

  it("answers from the team address, not the person who picked it up", async () => {
    const { member, mailboxId, mailboxAddress, messageId } = await messageInSharedMailbox(
      String(Date.now())
    );

    const reply = await request(app)
      .post(`/api/v1/mail/${messageId}/reply`)
      .set(authHeader(member.accessToken))
      .send({ textBody: "Checking now.", sendAsMailboxId: mailboxId })
      .expect(201);

    const row = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: reply.body.data.id },
      select: { sentAsMailboxId: true, fromAddress: true, authorUserId: true },
    });
    expect(row.sentAsMailboxId).toBe(mailboxId);
    expect(row.fromAddress).toBe(mailboxAddress);
    // The actor is still the person: §10 wants both, not one instead of the other.
    expect(row.authorUserId).toBe(member.userId);
  });

  it("does not put the team mailbox in its own reply-all", async () => {
    const { member, mailboxId, mailboxAddress, messageId } = await messageInSharedMailbox(
      String(Date.now())
    );

    const reply = await request(app)
      .post(`/api/v1/mail/${messageId}/reply-all`)
      .set(authHeader(member.accessToken))
      .send({ textBody: "Checking now.", sendAsMailboxId: mailboxId })
      .expect(201);

    const recipients = await prisma.messageRecipient.findMany({
      where: { messageId: reply.body.data.id },
      select: { email: true },
    });
    const emails = recipients.map((r) => r.email);
    // Replying to the address you are replying from is a loop, and the
    // original recipient list contains it by definition.
    expect(emails).not.toContain(mailboxAddress);
    expect(emails.length).toBeGreaterThan(0);
  });

  it("refuses to read the message out of a mailbox held send-only", async () => {
    const suffix = String(Date.now());
    const { owner, member, mailboxId, messageId } = await messageInSharedMailbox(suffix);

    await assign(owner.accessToken, mailboxId, {
      membershipId: member.membershipId,
      canRead: false,
      canSend: true,
    }).expect(200);

    // Send and read are separable, so holding one is not holding the other —
    // a send-only grant cannot be used to read the team's mail.
    const refused = await request(app)
      .post(`/api/v1/mail/${messageId}/reply`)
      .set(authHeader(member.accessToken))
      .send({ textBody: "Peeking.", sendAsMailboxId: mailboxId })
      .expect(403);
    expect(refused.body.error.details.permission).toBe("canRead");
  });

  it("forwards from the team address too", async () => {
    const suffix = String(Date.now());
    const { member, mailboxId, mailboxAddress, messageId } = await messageInSharedMailbox(suffix);

    const forwarded = await request(app)
      .post(`/api/v1/mail/${messageId}/forward`)
      .set(authHeader(member.accessToken))
      .send({
        recipients: { to: [`billing-${suffix}@example.test`], cc: [], bcc: [] },
        textBody: "Over to you.",
        sendAsMailboxId: mailboxId,
      })
      .expect(201);

    const row = await prisma.emailMessage.findUniqueOrThrow({
      where: { id: forwarded.body.data.id },
      select: { sentAsMailboxId: true, fromAddress: true },
    });
    expect(row.sentAsMailboxId).toBe(mailboxId);
    expect(row.fromAddress).toBe(mailboxAddress);
  });
});
