import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/common/utils/password.js";
import { sseManager } from "../src/common/sse/sse.manager.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Mail between colleagues with hosted mailbox addresses.
 *
 * The reported case: info@temveris.com and management@temveris.com, in the
 * same workspace, each owned by someone who signs in with a personal address.
 * Delivery matched recipients by sign-in email only, so mail between the two
 * mailboxes was treated as external and failed (EXTERNAL_DELIVERY_NOT_CONFIGURED);
 * and every message was "from" the sender's sign-in email, so replies went to
 * a personal address instead of the mailbox.
 */

const PASSWORD = "Password123!";
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

afterEach(() => vi.restoreAllMocks());

/** A member of the owner's workspace who signs in with one address and owns a mailbox with another. */
async function colleague(owner: Awaited<ReturnType<typeof registerUser>>, mailboxDomain: string) {
  const login = `${unique("login")}@personal.test`;
  await prisma.appUser.create({
    data: { email: login, displayName: login.split("@")[0]!, passwordHash: await hashPassword(PASSWORD), status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: login, role: "MEMBER" })
    .expect(201);
  const address = `${unique("box")}@${mailboxDomain}`;
  const mailbox = await prisma.mailbox.create({
    data: { tenantId: owner.tenantId, membershipId: added.body.data.id, address, workspaces: ["MEMBER"] },
    select: { id: true },
  });
  // The Member login, as these people use it.
  const session = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: address, password: PASSWORD, workspace: "MEMBER" })
    .expect(200);
  const user = await prisma.appUser.findUniqueOrThrow({ where: { email: login }, select: { id: true } });
  return { login, address, mailboxId: mailbox.id, userId: user.id, token: session.body.data.accessToken as string };
}

async function send(token: string, to: string[], subject = "Hello") {
  const draft = await request(app)
    .post("/api/v1/mail/drafts")
    .set(authHeader(token))
    .send({ subject, textBody: "Body", recipients: { to } })
    .expect(201);
  const sent = await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`).set(authHeader(token)).expect(200);
  return { id: draft.body.data.id as string, sent: sent.body.data, draft: draft.body.data };
}

const inboxOf = (mailboxId: string, messageId: string) =>
  prisma.mailboxMessage.findFirst({ where: { mailboxId, messageId, folder: "INBOX" } });

describe("mail between hosted mailboxes", () => {
  it("delivers to a colleague by mailbox address, from the sender's mailbox address, and notifies them live", async () => {
    const owner = await registerUser(app, { email: `${unique("hd-owner")}@zoiko.test` });
    const a = await colleague(owner, "hosted.test");
    const b = await colleague(owner, "hosted.test");
    const notify = vi.spyOn(sseManager, "sendToUser");

    const { id, sent, draft } = await send(a.token, [b.address]);
    expect(draft.fromAddress).toBe(a.address);
    expect(sent.status).toBe("SENT");

    const recipient = await prisma.messageRecipient.findFirstOrThrow({ where: { messageId: id } });
    expect(recipient.deliveryStatus).toBe("DELIVERED");
    expect(await inboxOf(b.mailboxId, id)).not.toBeNull();
    expect(notify).toHaveBeenCalledWith(b.userId, expect.objectContaining({ type: "NEW_MAIL" }));
    // No external-delivery failure was recorded for it.
    expect(await prisma.deliveryEvent.count({ where: { messageId: id, type: "FAILED" } })).toBe(0);
  });

  it("lets the recipient reply to the sender's mailbox address, not their sign-in email", async () => {
    const owner = await registerUser(app, { email: `${unique("hd-reply-owner")}@zoiko.test` });
    const a = await colleague(owner, "hosted.test");
    const b = await colleague(owner, "hosted.test");
    const { id } = await send(a.token, [b.address], "Leave approval");

    const reply = await request(app).post(`/api/v1/mail/${id}/reply`).set(authHeader(b.token)).send({ textBody: "Approved" }).expect(201);
    expect(reply.body.data.fromAddress).toBe(b.address);
    const to = (reply.body.data.recipients as Array<{ email: string; type: string }>).filter((r) => r.type === "TO").map((r) => r.email);
    expect(to).toEqual([a.address]);
    expect(to).not.toContain(a.login);

    await request(app).post(`/api/v1/mail/drafts/${reply.body.data.id}/send`).set(authHeader(b.token)).expect(200);
    expect(await inboxOf(a.mailboxId, reply.body.data.id)).not.toBeNull();
  });

  it("delivers to an alias of a colleague's mailbox", async () => {
    const owner = await registerUser(app, { email: `${unique("hd-alias-owner")}@zoiko.test` });
    const a = await colleague(owner, "hosted.test");
    const b = await colleague(owner, "hosted.test");
    const alias = `${unique("alias")}@hosted.test`;
    await prisma.alias.create({ data: { tenantId: owner.tenantId, mailboxId: b.mailboxId, address: alias } });

    const { id } = await send(a.token, [alias]);
    expect(await inboxOf(b.mailboxId, id)).not.toBeNull();
  });

  it("never delivers into another workspace's mailbox with the same address", async () => {
    const ours = await registerUser(app, { email: `${unique("hd-iso-ours")}@zoiko.test` });
    const theirs = await registerUser(app, { email: `${unique("hd-iso-theirs")}@zoiko.test` });
    const a = await colleague(ours, "hosted.test");
    const outsider = await colleague(theirs, "other.test");

    const { id, sent } = await send(a.token, [outsider.address]);
    // Not a colleague, so it is external — and this workspace has no outbound
    // relay — so it fails honestly instead of landing in another tenant.
    expect(sent.status).toBe("FAILED");
    expect(await inboxOf(outsider.mailboxId, id)).toBeNull();
    const failure = await prisma.deliveryEvent.findFirstOrThrow({ where: { messageId: id, type: "FAILED" } });
    expect(failure.failureCode).toBe("EXTERNAL_DELIVERY_NOT_CONFIGURED");
  });

  it("does not deliver to a removed colleague's mailbox", async () => {
    const owner = await registerUser(app, { email: `${unique("hd-removed-owner")}@zoiko.test` });
    const a = await colleague(owner, "hosted.test");
    const b = await colleague(owner, "hosted.test");
    const membership = await prisma.mailbox.findUniqueOrThrow({ where: { id: b.mailboxId }, select: { membershipId: true } });
    await prisma.tenantMembership.update({ where: { id: membership.membershipId! }, data: { status: "REMOVED" } });

    const { id } = await send(a.token, [b.address]);
    expect(await inboxOf(b.mailboxId, id)).toBeNull();
  });
});
