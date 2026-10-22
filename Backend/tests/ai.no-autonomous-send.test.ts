import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { jobService } from "../src/modules/job/job.service.js";
import { relayTransport } from "../src/modules/mail-transport/relay.transport.js";
import { providerMailService } from "../src/modules/provider-mail/provider-mail.service.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * AC-009 / KI-002 — AI cannot send external mail autonomously.
 *
 * The AI pipeline is allowed to *write* a reply: an AI_DRAFT_GENERATION job
 * turns a confirmed REPLY_OWED action into a DRAFT in the member's DRAFTS
 * folder. What it must never do is put that reply on the wire. Sending is a
 * person pressing Send, which goes through MailService.deliver, the sending
 * policy, suppression, warm-up and the SMTP_SEND job; an AI shortcut around
 * any of that would bypass every one of those controls.
 *
 * Pinned two ways:
 *  - behaviourally: the whole pipeline runs with a live (captured) relay
 *    configured, the job queue is drained, and nothing was sent, queued or
 *    recorded as a delivery;
 *  - structurally: no file in src/modules/ai imports the outbound transport
 *    (mail-transport/outbound, mail-transport/relay.transport), the legacy
 *    provider sender (provider-mail), the mail service's send path, the
 *    system mailer or nodemailer, nor names the SMTP_SEND job.
 */

const mutableEnv = env as unknown as Record<string, unknown>;
const RELAY_KEYS = ["RELAY_ENABLED", "RELAY_SMTP_HOST", "RELAY_SMTP_USERNAME", "RELAY_SMTP_PASSWORD"] as const;
const saved: Record<string, unknown> = {};
const wire: unknown[] = [];

beforeEach(() => {
  for (const key of RELAY_KEYS) saved[key] = mutableEnv[key];
  // A relay that is configured and would succeed: if the AI path reached it,
  // the message would really leave. The factory captures instead of
  // connecting, so a send shows up in `wire` rather than on the network.
  Object.assign(mutableEnv, {
    RELAY_ENABLED: true,
    RELAY_SMTP_HOST: "relay.test",
    RELAY_SMTP_USERNAME: "relay-user",
    RELAY_SMTP_PASSWORD: "relay-pass",
  });
  wire.length = 0;
  relayTransport.setTransportFactory(() => ({
    sendMail: (async (options: unknown) => {
      wire.push(options);
      return { accepted: [], rejected: [], response: "250 Ok", messageId: "<captured@relay.test>" };
    }) as never,
  }));
});

afterEach(() => {
  Object.assign(mutableEnv, saved);
  relayTransport.setTransportFactory(null);
  vi.restoreAllMocks();
});

/** Same seeding as ai.pipeline.test.ts: reuse the workspace's AI policy if it has one. */
async function seedActiveAIPolicy(tenantId: string) {
  const existing = await prisma.tenantPolicy.findFirst({ where: { tenantId, type: "AI" } });
  if (existing) return existing;
  return prisma.tenantPolicy.create({
    data: {
      tenantId,
      type: "AI",
      name: "Allow AI processing",
      version: 1,
      status: "ACTIVE",
      rules: { defaultEffect: "ALLOW", conditions: [] },
      createdByUserId: (await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId } })).userId,
    },
  });
}

/** An inbound message from an outside sender, asking for a reply. */
async function seedInboxMessage(tenantId: string, membershipId: string, userId: string) {
  const mailbox = await prisma.mailbox.upsert({
    where: { membershipId },
    update: {},
    create: { tenantId, membershipId, address: `ai-nosend-${Date.now()}@zoiko.test` },
  });
  const thread = await prisma.messageThread.create({
    data: {
      tenantId,
      subjectNormalized: "demo time",
      participants: ["alice@example.com", mailbox.address],
      firstMessageAt: new Date(),
      lastMessageAt: new Date(),
    },
  });
  const message = await prisma.emailMessage.create({
    data: {
      tenantId,
      authorUserId: userId,
      threadId: thread.id,
      subject: "Demo time",
      textBody: "Can you confirm the final meeting time for the demo?",
      status: "RECEIVED",
      sentAt: new Date(),
      providerType: "GMAIL",
      providerMessageId: `pm-nosend-${Date.now()}`,
      fromAddress: "alice@example.com",
      fromName: "Alice",
      mailboxItems: { create: { tenantId, mailboxId: mailbox.id, folder: "INBOX", isRead: false } },
      securityFlags: {},
    },
  });
  return { message, mailbox };
}

/** Run every job the pipeline (or anything it triggered) left behind. */
async function drainQueue(limit = 20) {
  const types: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const result = await jobService.processNext();
    if (!result.processed) break;
    types.push(String(result.type));
  }
  return types;
}

describe("the AI drafts a reply but does not send it", () => {
  it("leaves the generated reply as an unsent DRAFT with nothing queued for delivery", async () => {
    const relaySend = vi.spyOn(relayTransport, "sendMessage");
    const providerSend = vi.spyOn(providerMailService, "sendMessage");

    const owner = await registerUser(app, { email: `ai-nosend-${Date.now()}@zoiko.test` });
    await seedActiveAIPolicy(owner.tenantId);
    const { message, mailbox } = await seedInboxMessage(owner.tenantId, owner.membershipId, owner.userId);

    await jobService.enqueue({
      tenantId: owner.tenantId,
      userId: owner.userId,
      type: "AI_EXTRACTION",
      payload: { messageId: message.id, threadId: message.threadId },
      idempotencyKey: `ai-extract-${message.id}`,
    });
    expect(await drainQueue()).toContain("AI_EXTRACTION");

    const replyAction = await prisma.aIAction.findFirstOrThrow({
      where: { tenantId: owner.tenantId, messageId: message.id, actionType: "REPLY_OWED" },
    });
    await request(app)
      .patch(`/api/v1/ai/actions/${replyAction.id}/review`)
      .set(authHeader(owner.accessToken))
      .send({ status: "CONFIRMED" })
      .expect(200);

    // Everything the confirmation set in motion runs to completion.
    expect(await drainQueue()).toContain("AI_DRAFT_GENERATION");

    const draft = await prisma.emailMessage.findFirstOrThrow({
      where: { tenantId: owner.tenantId, sourceAiActionId: replyAction.id },
      include: { mailboxItems: true, recipients: true },
    });

    // A draft, in DRAFTS, addressed to the outside sender — and nothing more.
    expect(draft.status).toBe("DRAFT");
    expect(draft.sentAt).toBeNull();
    expect(draft.providerMessageId).toBeNull();
    expect(draft.mailboxItems.map((item) => item.folder)).toEqual(["DRAFTS"]);
    expect(draft.mailboxItems[0].mailboxId).toBe(mailbox.id);
    expect(draft.recipients.map((r) => r.email)).toContain("alice@example.com");
    expect(draft.recipients.every((r) => r.deliveryStatus === "PENDING")).toBe(true);

    // Nothing reached a transport, even though one was configured and ready.
    expect(wire).toHaveLength(0);
    expect(relaySend).not.toHaveBeenCalled();
    expect(providerSend).not.toHaveBeenCalled();

    // Nothing was queued to reach one later, and no delivery was recorded.
    expect(
      await prisma.backgroundJob.count({ where: { tenantId: owner.tenantId, type: "SMTP_SEND" } })
    ).toBe(0);
    expect(await prisma.deliveryEvent.count({ where: { tenantId: owner.tenantId, messageId: draft.id } })).toBe(0);
    expect(
      await prisma.auditEvent.count({ where: { tenantId: owner.tenantId, eventType: "MAIL_SENT" } })
    ).toBe(0);

    // The only messages in the workspace are the inbound one and the draft:
    // no sibling copy was sent on the draft's behalf.
    const statuses = await prisma.emailMessage.findMany({
      where: { tenantId: owner.tenantId },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status).sort()).toEqual(["DRAFT", "RECEIVED"]);
  });
});

describe("the AI module has no route to the wire", () => {
  const aiDir = resolve(process.cwd(), "src/modules/ai");
  const sources = readdirSync(aiDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(resolve(aiDir, name), "utf8") }));

  /** Every module specifier a file pulls in, static `from` or dynamic `import()`. */
  const importsOf = (text: string) =>
    [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm)].map((m) => m[1]);

  it("finds the AI sources it is guarding", () => {
    // If the module moves, this guard must move with it rather than pass on
    // an empty directory.
    expect(sources.map((s) => s.name)).toEqual(expect.arrayContaining(["ai.service.ts", "ai.provider.ts"]));
    // And the import scanner actually sees imports — static and dynamic —
    // so an empty result below means "none forbidden", not "none parsed".
    const service = importsOf(sources.find((s) => s.name === "ai.service.ts")!.text);
    expect(service).toContain("../../config/prisma.js");
    expect(service).toContain("../job/job.service.js");
  });

  it("does not import any mail transport, sender or mailer", () => {
    const forbidden = [
      /mail-transport\//, // outbound.ts (sendOutbound) and relay.transport.ts (relayTransport)
      /provider-mail\//, // legacy provider account: providerMailService.sendMessage
      /modules\/mail\/(mail\.service|index)(\.js)?$/, // MailService.send / deliver
      /^\.\.\/mail\/(mail\.service|index)(\.js)?$/,
      /common\/mailer\//, // system mailer (nodemailer to arbitrary addresses)
      /^nodemailer$/,
    ];
    const offending = sources.flatMap(({ name, text }) =>
      importsOf(text)
        .filter((specifier) => forbidden.some((pattern) => pattern.test(specifier)))
        .map((specifier) => `${name} -> ${specifier}`)
    );
    expect(offending).toEqual([]);
  });

  it("does not call a send function or queue an SMTP_SEND job", () => {
    const forbiddenCalls = [
      /\bsendOutbound\s*\(/,
      /\brelayTransport\b/,
      /\bproviderMailService\b/,
      /\bmailService\s*\.\s*send\s*\(/,
      /\.sendMail\s*\(/,
      /\bsystemMailer\b/,
      /["']SMTP_SEND["']/,
    ];
    const offending = sources.flatMap(({ name, text }) =>
      forbiddenCalls.filter((pattern) => pattern.test(text)).map((pattern) => `${name}: ${pattern}`)
    );
    expect(offending).toEqual([]);
  });
});
