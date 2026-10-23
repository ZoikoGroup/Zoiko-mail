import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import nodemailer from "nodemailer";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/common/utils/password.js";
import { sseManager } from "../src/common/sse/sse.manager.js";
import { relayTransport } from "../src/modules/mail-transport/relay.transport.js";
import { sendOutbound, outboundAvailable } from "../src/modules/mail-transport/outbound.js";
import { IngestService } from "../src/modules/mail-ingest/ingest.service.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Mail with the outside world: sending through the relay as the mailbox's own
 * address, and receiving through the signed ingest endpoint the inbound edge
 * calls — including a conversation that goes out, gets a reply, and threads.
 *
 * The relay is nodemailer's real MIME builder writing to memory instead of a
 * socket, so what is asserted is the exact message an outside server would
 * receive. The inbound side is a raw RFC 5322 message, signed the way the
 * Cloudflare Email Worker signs it.
 */

const SECRET = "test-inbound-secret-0123456789abcdef0123456789";
const PASSWORD = "Password123!";
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

const mutableEnv = env as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const sent: string[] = [];

beforeEach(() => {
  for (const key of ["RELAY_ENABLED", "RELAY_SMTP_HOST", "RELAY_SMTP_USERNAME", "RELAY_SMTP_PASSWORD", "INBOUND_WEBHOOK_SECRET"]) {
    saved[key] = mutableEnv[key];
  }
  Object.assign(mutableEnv, {
    RELAY_ENABLED: true,
    RELAY_SMTP_HOST: "relay.test",
    RELAY_SMTP_USERNAME: "relay-user",
    RELAY_SMTP_PASSWORD: "relay-pass",
    INBOUND_WEBHOOK_SECRET: SECRET,
  });
  sent.length = 0;
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  relayTransport.setTransportFactory(() => ({
    sendMail: (async (options: Parameters<typeof stream.sendMail>[0]) => {
      const info = await stream.sendMail(options);
      sent.push((info.message as Buffer).toString("utf8"));
      return { ...info, accepted: info.envelope.to, rejected: [], response: "250 Ok queued" };
    }) as never,
  }));
});

afterEach(() => {
  Object.assign(mutableEnv, saved);
  relayTransport.setTransportFactory(null);
  vi.restoreAllMocks();
});

/** A workspace with a domain cleared for sending, and members with mailboxes on it. */
async function workspace() {
  const owner = await registerUser(app, { email: `${unique("ext-owner")}@zoiko.test` });
  const domainName = `${unique("ext")}.test`;
  const domain = await prisma.mailDomain.create({
    data: {
      tenantId: owner.tenantId,
      domainName,
      type: "CUSTOM",
      verificationToken: `zoiko-mail-verification=${unique("tok")}`,
      verificationStatus: "VERIFIED",
      status: "ACTIVE",
      sendingEnabled: true,
    },
  });
  return { owner, domainName, domainId: domain.id };
}

async function mailboxOwner(w: Awaited<ReturnType<typeof workspace>>, localPart: string) {
  const login = `${unique("login")}@personal.test`;
  await prisma.appUser.create({
    data: { email: login, displayName: `Person ${localPart}`, passwordHash: await hashPassword(PASSWORD), status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  const added = await request(app).post("/api/v1/membership/members").set(authHeader(w.owner.accessToken)).send({ email: login, role: "MEMBER" }).expect(201);
  const address = `${localPart}@${w.domainName}`;
  const mailbox = await prisma.mailbox.create({
    data: { tenantId: w.owner.tenantId, membershipId: added.body.data.id, domainId: w.domainId, address, workspaces: ["MEMBER"] },
  });
  const user = await prisma.appUser.findUniqueOrThrow({ where: { email: login } });
  const token = (await request(app).post("/api/v1/auth/login").send({ email: address, password: PASSWORD, workspace: "MEMBER" }).expect(200)).body.data.accessToken as string;
  return { address, mailboxId: mailbox.id, userId: user.id, token };
}

function rawMessage(input: { from: string; to: string; subject: string; body: string; messageId: string; inReplyTo?: string; attachment?: boolean }) {
  const boundary = "zoiko-test-boundary";
  const headers = [
    `From: Outside Person <${input.from}>`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${input.messageId}`,
    "Date: Tue, 14 Oct 2026 10:00:00 +0000",
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : []),
    "MIME-Version: 1.0",
  ];
  if (!input.attachment) {
    return Buffer.from([...headers, "Content-Type: text/plain; charset=utf-8", "", input.body, ""].join("\r\n"));
  }
  return Buffer.from([
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
    `--${boundary}`,
    "Content-Type: text/plain; name=\"notes.txt\"",
    "Content-Disposition: attachment; filename=\"notes.txt\"",
    "",
    "attached notes",
    `--${boundary}--`,
    "",
  ].join("\r\n"));
}

function deliver(raw: Buffer, recipients: string, options: { secret?: string; timestamp?: number } = {}) {
  const timestamp = String(options.timestamp ?? Date.now());
  return request(app)
    .post("/api/v1/internal/inbound/messages")
    .set("Content-Type", "message/rfc822")
    .set("X-Zoiko-Timestamp", timestamp)
    .set("X-Zoiko-Recipients", recipients)
    .set("X-Zoiko-Sender", "sender@outside.test")
    .set("X-Zoiko-Signature", IngestService.sign(options.secret ?? SECRET, timestamp, recipients, raw))
    .send(raw);
}

async function compose(token: string, to: string, subject: string) {
  const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(token)).send({ subject, textBody: "Hello from Zoiko", recipients: { to: [to] } }).expect(201);
  return draft.body.data.id as string;
}

describe("sending to outside addresses through the relay", () => {
  it("sends as the mailbox's own address with a real Message-ID, and records the relay's acceptance", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "info");
    expect(outboundAvailable({ tenantId: w.owner.tenantId, membershipId: "any" })).toBe(true);

    const id = await compose(a.token, "friend@gmail.test", "Hello outside");
    const queued = await request(app).post(`/api/v1/mail/drafts/${id}/send`).set(authHeader(a.token)).expect(200);
    expect(queued.body.data.status).toBe("SENDING");
    const job = await prisma.backgroundJob.findFirstOrThrow({ where: { tenantId: w.owner.tenantId, type: "SMTP_SEND" } });
    expect((job.payload as { messageId: string }).messageId).toBe(id);

    // What the SMTP_SEND job runs.
    await sendOutbound(id, w.owner.tenantId);

    expect(sent).toHaveLength(1);
    const mime = sent[0]!;
    expect(mime).toMatch(new RegExp(`^From: .*<${a.address.replace(/\./g, "\\.")}>`, "m"));
    expect(mime).toMatch(/^To: friend@gmail\.test/m);
    expect(mime).toMatch(new RegExp(`^Message-ID: <[^>]+@${w.domainName.replace(/\./g, "\\.")}>`, "m"));
    expect(mime).toContain("Hello from Zoiko");

    const message = await prisma.emailMessage.findUniqueOrThrow({ where: { id }, include: { recipients: true, deliveryEvents: true } });
    expect(message.status).toBe("SENT");
    expect(message.providerType).toBe("RELAY_SMTP");
    expect(message.recipients[0]!.deliveryStatus).toBe("QUEUED");
    expect(message.deliveryEvents.some((event) => event.type === "ACCEPTED")).toBe(true);
  });

  it("refuses outside sending from a domain that is not cleared for it", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "info");
    await prisma.mailDomain.update({ where: { id: w.domainId }, data: { sendingEnabled: false } });
    const id = await compose(a.token, "friend@gmail.test", "Blocked");
    await request(app).post(`/api/v1/mail/drafts/${id}/send`).set(authHeader(a.token)).expect(403);
    expect(sent).toHaveLength(0);
  });
});

describe("receiving from outside addresses", () => {
  it("stores a message in the recipient's inbox with its body and attachment, and notifies them", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "info");
    const notify = vi.spyOn(sseManager, "sendToUser");
    const messageId = `<${unique("in")}@gmail.test>`;

    const res = await deliver(
      rawMessage({ from: "friend@gmail.test", to: a.address, subject: "Hi from Gmail", body: "Hello Zoiko", messageId, attachment: true }),
      a.address
    ).expect(200);
    expect(res.body.data.outcomes).toEqual([{ address: a.address, status: "DELIVERED" }]);

    const stored = await prisma.emailMessage.findFirstOrThrow({
      where: { tenantId: w.owner.tenantId, providerMessageId: messageId },
      include: { attachments: true, mailboxItems: true },
    });
    expect(stored).toMatchObject({ status: "RECEIVED", fromAddress: "friend@gmail.test", subject: "Hi from Gmail", textBody: "Hello Zoiko" });
    expect(stored.mailboxItems).toEqual([expect.objectContaining({ mailboxId: a.mailboxId, folder: "INBOX" })]);
    expect(stored.attachments).toEqual([expect.objectContaining({ fileName: "notes.txt", contentType: "text/plain" })]);
    expect(notify).toHaveBeenCalledWith(a.userId, expect.objectContaining({ type: "NEW_MAIL" }));

    // The member can read it through the normal mail API.
    const read = await request(app).get(`/api/v1/mail/${stored.id}`).set(authHeader(a.token)).expect(200);
    expect(read.body.data.textBody ?? read.body.data.message?.textBody).toBe("Hello Zoiko");
  });

  it("threads an outside reply onto the conversation it answers, and Zoiko's reply carries In-Reply-To", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "sales");
    const id = await compose(a.token, "client@gmail.test", "Quote");
    await request(app).post(`/api/v1/mail/drafts/${id}/send`).set(authHeader(a.token)).expect(200);
    const out = await sendOutbound(id, w.owner.tenantId);

    // The client replies from Gmail.
    const replyId = `<${unique("reply")}@gmail.test>`;
    await deliver(
      // rawMessage({ from: "client@gmail.test", to: a.address, subject: "Re: Quote", body: "Looks good", messageId: replyId, inReplyTo: out.messageId }),
      // rawMessage({ from: "client@gmail.test", to: a.address, subject: "Re: Quote", body: "Looks good", messageId: replyId, inReplyTo: (out as { internetMessageId: string }).internetMessageId }),
      rawMessage({ from: "client@gmail.test", to: a.address, subject: "Re: Quote", body: "Looks good", messageId: replyId, inReplyTo: (out as unknown as { internetMessageId: string }).internetMessageId }),
      a.address
    ).expect(200);
    const original = await prisma.emailMessage.findUniqueOrThrow({ where: { id } });
    const reply = await prisma.emailMessage.findFirstOrThrow({ where: { tenantId: w.owner.tenantId, providerMessageId: replyId } });
    expect(reply.threadId).toBe(original.threadId);

    // And Zoiko's answer to that reply goes back with threading headers.
    const answer = await request(app).post(`/api/v1/mail/${reply.id}/reply`).set(authHeader(a.token)).send({ textBody: "Thanks" }).expect(201);
    await request(app).post(`/api/v1/mail/drafts/${answer.body.data.id}/send`).set(authHeader(a.token)).expect(200);
    sent.length = 0;
    await sendOutbound(answer.body.data.id, w.owner.tenantId);
    expect(sent[0]).toMatch(/^To: client@gmail\.test/m);
    expect(sent[0]).toContain(`In-Reply-To: ${replyId}`);
  });

  it("delivers to an alias, and stores a re-delivered message only once", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "support");
    const alias = `help@${w.domainName}`;
    await prisma.alias.create({ data: { tenantId: w.owner.tenantId, mailboxId: a.mailboxId, address: alias } });
    const raw = rawMessage({ from: "x@gmail.test", to: alias, subject: "Help", body: "Please", messageId: `<${unique("dup")}@gmail.test>` });

    expect((await deliver(raw, alias).expect(200)).body.data.outcomes[0].status).toBe("DELIVERED");
    expect((await deliver(raw, alias).expect(200)).body.data.outcomes[0].status).toBe("DUPLICATE");
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: a.mailboxId } })).toBe(1);
  });

  it("rejects unknown recipients, and accepts the known ones in a mixed delivery", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "info");
    const unknown = `nobody@${w.domainName}`;
    const refused = await deliver(rawMessage({ from: "x@gmail.test", to: unknown, subject: "?", body: "?", messageId: `<${unique("u")}@g.test>` }), unknown).expect(404);
    expect(refused.body.error.code).toBe("INBOUND_RECIPIENT_UNKNOWN");

    const mixed = await deliver(
      rawMessage({ from: "x@gmail.test", to: a.address, subject: "Both", body: "b", messageId: `<${unique("m")}@g.test>` }),
      `${a.address},${unknown}`
    ).expect(200);
    expect(mixed.body.data.outcomes).toEqual([
      { address: a.address, status: "DELIVERED" },
      { address: unknown, status: "UNKNOWN" },
    ]);
  });

  it("refuses requests that are unsigned, wrongly signed or replayed", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "info");
    const raw = rawMessage({ from: "x@gmail.test", to: a.address, subject: "s", body: "b", messageId: `<${unique("sig")}@g.test>` });
    expect((await deliver(raw, a.address, { secret: "wrong-secret-0123456789abcdef0123456789" }).expect(401)).body.error.code).toBe("INBOUND_SIGNATURE_INVALID");
    await deliver(raw, a.address, { timestamp: Date.now() - 60 * 60 * 1000 }).expect(401);
    await request(app).post("/api/v1/internal/inbound/messages").set("Content-Type", "message/rfc822").send(raw).expect(401);
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: a.mailboxId } })).toBe(0);
  });

  it("keeps workspaces apart: an address held by two workspaces goes to the one that verified the domain", async () => {
    const verified = await workspace();
    const holder = await mailboxOwner(verified, "shared-name");
    const other = await registerUser(app, { email: `${unique("ext-other")}@zoiko.test` });
    const squatter = await prisma.mailbox.create({ data: { tenantId: other.tenantId, address: holder.address, type: "SHARED" } });

    await deliver(rawMessage({ from: "x@gmail.test", to: holder.address, subject: "s", body: "b", messageId: `<${unique("iso")}@g.test>` }), holder.address).expect(200);
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: holder.mailboxId } })).toBe(1);
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: squatter.id } })).toBe(0);
  });

  it("refuses everything when no inbound secret is configured", async () => {
    mutableEnv.INBOUND_WEBHOOK_SECRET = undefined;
    const raw = Buffer.from("Subject: x\r\n\r\nx");
    const res = await deliver(raw, "a@b.test", { secret: SECRET }).expect(503);
    expect(res.body.error.code).toBe("INBOUND_NOT_CONFIGURED");
  });
});

describe("attachments, sender to recipient", () => {
  const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  const attach = (token: string, draftId: string, file: { name: string; type: string; body: Buffer }, key?: string) => {
    const req = request(app).post(`/api/v1/mail/drafts/${draftId}/attachments`).set(authHeader(token));
    if (key) req.set("Idempotency-Key", key);
    return req.attach("file", file.body, { filename: file.name, contentType: file.type });
  };

  it("accepts real documents whatever the browser calls them, stored as what they are", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "sender");
    const id = await compose(a.token, "friend@gmail.test", "Files");
    // Windows without Office reports a .docx as octet-stream; some browsers send no type at all.
    const docx = await attach(a.token, id, { name: "Proposal.docx", type: "application/octet-stream", body: Buffer.from("PK docx") }).expect(201);
    expect(docx.body.data).toMatchObject({ fileName: "Proposal.docx", contentType: DOCX });
    const pptx = await attach(a.token, id, { name: "Deck.pptx", type: "application/zip", body: Buffer.from("PK pptx") }).expect(201);
    expect(pptx.body.data.contentType).toBe(PPTX);
    // A name that isn't ASCII arrives intact.
    const named = await attach(a.token, id, { name: "Résumé – 2026.pdf", type: "application/pdf", body: Buffer.from("%PDF-1.4") }).expect(201);
    expect(named.body.data.fileName).toBe("Résumé – 2026.pdf");
    const csv = await attach(a.token, id, { name: "data.csv", type: "application/vnd.ms-excel", body: Buffer.from("a,b\n1,2\n") }).expect(201);
    expect(csv.body.data.contentType).toBe("text/csv");
  });

  it("refuses programs, scripts and web pages, however they are named", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "sender");
    const id = await compose(a.token, "friend@gmail.test", "Bad files");
    const disguised = await attach(a.token, id, { name: "invoice.pdf", type: "application/x-msdownload", body: Buffer.from("MZ") }).expect(415);
    expect(disguised.body.error.message).toMatch(/can run code/);
    await attach(a.token, id, { name: "page.html", type: "text/html", body: Buffer.from("<script>") }).expect(415);
    await attach(a.token, id, { name: "logo.svg", type: "image/svg+xml", body: Buffer.from("<svg/>") }).expect(415);
    const unknown = await attach(a.token, id, { name: "tool.exe", type: "application/octet-stream", body: Buffer.from("MZ") }).expect(415);
    expect(unknown.body.error.message).toMatch(/\.exe files can't be attached/);
    expect(await prisma.messageAttachment.count({ where: { messageId: id } })).toBe(0);
  });

  it("needs an Idempotency-Key to upload, and a retried upload is stored once", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "sender");
    const id = await compose(a.token, "friend@gmail.test", "Retry");
    // The header the web app was not sending — the reported error.
    const missing = await request(app)
      .post(`/api/v1/mail/drafts/${id}/attachments`)
      .set(authHeader(a.token))
      .set("x-test-omit-idempotency-key", "1")
      .attach("file", Buffer.from("x"), { filename: "a.txt", contentType: "text/plain" })
      .expect(400);
    expect(missing.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const file = { name: "notes.txt", type: "text/plain", body: Buffer.from("notes") };
    const first = await attach(a.token, id, file, "upload-notes-0001").expect(201);
    // The response was lost and the browser tries again with the same key.
    const again = await attach(a.token, id, file, "upload-notes-0001").expect(201);
    expect(again.headers["idempotent-replay"]).toBe("true");
    expect(again.body.data.id).toBe(first.body.data.id);
    // A different file has its own key, and is its own attachment.
    await attach(a.token, id, { ...file, name: "more.txt" }, "upload-more-0002").expect(201);
    expect(await prisma.messageAttachment.count({ where: { messageId: id } })).toBe(2);
  });

  it("delivers every attachment to a colleague and to the outside, and a retried send sends once", async () => {
    const w = await workspace();
    const a = await mailboxOwner(w, "sender");
    const b = await mailboxOwner(w, "colleague");
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(a.token))
      .send({ subject: "Q4 pack", textBody: "Attached.", recipients: { to: [b.address, "client@gmail.test"] } })
      .expect(201);
    const id = draft.body.data.id as string;
    const files = [
      { name: "Q4 Roadmap.pptx", type: "", body: Buffer.from("roadmap-bytes") },
      { name: "Budget v2.xlsx", type: "application/octet-stream", body: Buffer.from("budget-bytes") },
      { name: "Milestones.pdf", type: "application/pdf", body: Buffer.from("%PDF-milestones") },
      { name: "photo.png", type: "image/png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ];
    for (const [i, file] of files.entries()) await attach(a.token, id, file, `upload-${id}-${i}`).expect(201);

    // Sent, then sent again with the same key after a lost response: one send.
    const sendKey = `send-${id}`;
    const first = await request(app).post(`/api/v1/mail/drafts/${id}/send`).set(authHeader(a.token)).set("Idempotency-Key", sendKey).expect(200);
    const retry = await request(app).post(`/api/v1/mail/drafts/${id}/send`).set(authHeader(a.token)).set("Idempotency-Key", sendKey).expect(200);
    expect(retry.headers["idempotent-replay"]).toBe("true");
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.backgroundJob.count({ where: { tenantId: w.owner.tenantId, type: "SMTP_SEND" } })).toBe(1);

    // The colleague has it, and every file opens with its exact bytes.
    const received = await request(app).get(`/api/v1/mail/${id}`).set(authHeader(b.token)).expect(200);
    const attachments = received.body.data.message.attachments as Array<{ id: string; fileName: string; contentType: string }>;
    expect(attachments.map((x) => x.fileName).sort()).toEqual(files.map((f) => f.name).sort());
    for (const file of files) {
      const meta = attachments.find((x) => x.fileName === file.name)!;
      const download = await request(app)
        .get(`/api/v1/mail/${id}/attachments/${meta.id}`)
        .set(authHeader(b.token))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(download.body as Buffer, file.body)).toBe(0);
      expect(download.headers["content-disposition"]).toContain(encodeURIComponent(file.name));
    }

    // The outside recipient gets them through the relay, once.
    await sendOutbound(id, w.owner.tenantId);
    expect(sent).toHaveLength(1);
    for (const file of files) {
      expect(sent[0]).toContain(file.name);
      expect(sent[0]).toContain(file.body.toString("base64").slice(0, 12));
    }
    // The stored type travels with it (nodemailer folds the long header onto the next line).
    expect(sent[0]!.replace(/\n\s+/g, " ")).toContain(`Content-Type: ${PPTX};`);
  });
});
