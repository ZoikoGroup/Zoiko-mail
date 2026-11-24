import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { IngestService } from "../src/modules/mail-ingest/ingest.service.js";
import { attachmentStorage } from "../src/modules/mail/attachment.storage.js";
import { registerUser } from "./helpers.js";
import {
  FORGED_VERDICT_HEADERS,
  eicar,
  mimeMessage,
  nestedMessage,
  passwordProtectedZip,
  zipBomb,
} from "./fixtures/threat-fixtures.js";

/**
 * P0 security baseline: the inbound path measured against the acceptance
 * tests of the Security Foundation Handoff (ZM-SEC-HO-001 §14, ZMT-01..09).
 *
 * G0 asks for an evidence-backed inventory of what exists before anything is
 * built. These tests are that inventory in executable form, in two kinds:
 *
 *  - Requirement tests assert behaviour the handoff requires and the code
 *    already has. They must keep passing through every later priority.
 *
 *  - "[GAP …]" tests pin down today's behaviour where it falls short, and name
 *    the priority and decision that close the gap. They are written to fail
 *    the moment that behaviour changes, so whoever closes a gap has to turn
 *    the test into a requirement test rather than leave a stale record.
 *
 * `it.todo` marks acceptance tests that cannot be written yet because the
 * thing they exercise does not exist and depends on an open decision.
 *
 * Attachment storage is held in memory here: the fixtures include the EICAR
 * test file and a decompression bomb, which have no business on a developer's
 * disk (and the developer's own antivirus would remove the first mid-test).
 */

const app = createApp();
const SECRET = "p0-baseline-inbound-secret-0123456789abcdef";
const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv: Record<string, unknown> = {};
const stored = new Map<string, Buffer>();
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

beforeEach(() => {
  for (const key of ["INBOUND_WEBHOOK_SECRET", "INBOUND_MAX_MESSAGE_BYTES"]) savedEnv[key] = mutableEnv[key];
  mutableEnv.INBOUND_WEBHOOK_SECRET = SECRET;
  stored.clear();
  vi.spyOn(attachmentStorage, "save").mockImplementation(async (data: Buffer) => {
    const key = unique("mem");
    stored.set(key, Buffer.from(data));
    return key;
  });
  vi.spyOn(attachmentStorage, "delete").mockImplementation(async (key: string) => {
    stored.delete(key);
  });
});

afterEach(() => {
  Object.assign(mutableEnv, savedEnv);
  vi.restoreAllMocks();
});

/** A workspace whose creator holds a personal mailbox. */
async function recipient(creatorRole: "OWNER" | "ADMIN" = "OWNER") {
  const user = await registerUser(app, { email: `${unique("p0")}@zoiko.test`, creatorRole });
  const address = `${unique("inbox")}@p0-baseline.test`;
  const mailbox = await prisma.mailbox.create({
    data: { tenantId: user.tenantId, membershipId: user.membershipId, address, workspaces: ["MEMBER"] },
  });
  return { tenantId: user.tenantId, address, mailboxId: mailbox.id };
}

function deliver(
  raw: Buffer,
  recipients: string,
  options: { signedRecipients?: string; timestamp?: number; signature?: string } = {}
) {
  const timestamp = String(options.timestamp ?? Date.now());
  const signature =
    options.signature ?? IngestService.sign(SECRET, timestamp, options.signedRecipients ?? recipients, raw);
  return request(app)
    .post("/api/v1/internal/inbound/messages")
    .set("Content-Type", "message/rfc822")
    .set("X-Zoiko-Timestamp", timestamp)
    .set("X-Zoiko-Recipients", recipients)
    .set("X-Zoiko-Sender", "sender@outside.test")
    .set("X-Zoiko-Signature", signature)
    .send(raw);
}

function plain(to: string, extra: Partial<Parameters<typeof mimeMessage>[0]> = {}) {
  return mimeMessage({
    from: "Outside <sender@outside.test>",
    to,
    subject: "P0 baseline",
    messageId: `<${unique("msg")}@outside.test>`,
    ...extra,
  });
}

async function storedMessage(tenantId: string, messageId: string) {
  return prisma.emailMessage.findFirst({
    where: { tenantId, providerMessageId: messageId },
    include: { mailboxItems: true, attachments: true },
  });
}

// ── ZMT-01: envelope and authentication at the ingress ─────────────────────

describe("ZMT-01 — the ingress refuses what it cannot attribute", () => {
  it("refuses a message whose recipients were changed after signing, and stores nothing", async () => {
    const victim = await recipient();
    const intended = `${unique("someone")}@outside.test`;
    const raw = plain(victim.address);
    const res = await deliver(raw, victim.address, { signedRecipients: intended }).expect(401);
    expect(res.body.error.code).toBe("INBOUND_SIGNATURE_INVALID");
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: victim.mailboxId } })).toBe(0);
  });

  it("refuses an envelope with no valid address in it", async () => {
    const raw = plain("nobody");
    await deliver(raw, "not-an-address, also not one").expect(401);
  });

  it("refuses an envelope with more than 100 recipients", async () => {
    const list = Array.from({ length: 101 }, (_, i) => `r${i}@p0-baseline.test`).join(",");
    await deliver(plain("many@p0-baseline.test"), list).expect(401);
  });

  it("refuses a timestamp outside the tolerance in either direction", async () => {
    const target = await recipient();
    const raw = plain(target.address);
    const tolerance = env.INBOUND_SIGNATURE_TOLERANCE_MS;
    await deliver(raw, target.address, { timestamp: Date.now() + tolerance + 60_000 }).expect(401);
    await deliver(raw, target.address, { timestamp: Date.now() - tolerance - 60_000 }).expect(401);
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: target.mailboxId } })).toBe(0);
  });

  it("refuses a signature that is not hex, or is the right length but wrong", async () => {
    const target = await recipient();
    const raw = plain(target.address);
    await deliver(raw, target.address, { signature: "zz".repeat(32) }).expect(401);
    await deliver(raw, target.address, { signature: "0".repeat(64) }).expect(401);
  });

  it("refuses an empty body", async () => {
    const target = await recipient();
    await deliver(Buffer.alloc(0), target.address).expect((res) => expect([400, 401]).toContain(res.status));
  });
});

// ── ZMT-02: clean mail, one delivery, one receipt ─────────────────────────

describe("ZMT-02 — a clean message is delivered exactly once with an audit receipt", () => {
  it("stores one copy, one INBOX placement and one INBOUND_MESSAGE_RECEIVED receipt", async () => {
    const target = await recipient();
    const messageId = `<${unique("clean")}@outside.test>`;
    const res = await deliver(plain(target.address, { messageId }), target.address).expect(200);
    expect(res.body.data.outcomes).toEqual([{ address: target.address, status: "DELIVERED" }]);

    const message = await storedMessage(target.tenantId, messageId);
    expect(message).not.toBeNull();
    expect(message!.mailboxItems).toEqual([expect.objectContaining({ mailboxId: target.mailboxId, folder: "INBOX" })]);
    const receipts = await prisma.auditEvent.count({
      where: { tenantId: target.tenantId, eventType: "INBOUND_MESSAGE_RECEIVED", targetId: message!.id },
    });
    expect(receipts).toBe(1);
  });

  it("stores one copy with two placements when two mailboxes of one workspace are addressed", async () => {
    const first = await recipient();
    const second = await prisma.mailbox.create({
      data: { tenantId: first.tenantId, address: `${unique("shared")}@p0-baseline.test`, type: "SHARED" },
    });
    const messageId = `<${unique("two")}@outside.test>`;
    await deliver(plain(first.address, { messageId }), `${first.address},${second.address}`).expect(200);
    const message = await storedMessage(first.tenantId, messageId);
    expect(await prisma.emailMessage.count({ where: { tenantId: first.tenantId, providerMessageId: messageId } })).toBe(1);
    expect(message!.mailboxItems.map((item) => item.mailboxId).sort()).toEqual([first.mailboxId, second.id].sort());
  });
});

// ── ZMT-06: resource bounds ────────────────────────────────────────────────

describe("ZMT-06 — hostile structure does not take the service down", () => {
  it("refuses a message over the configured size limit before storing anything", async () => {
    const target = await recipient();
    mutableEnv.INBOUND_MAX_MESSAGE_BYTES = 2_048;
    const messageId = `<${unique("big")}@outside.test>`;
    const raw = plain(target.address, { messageId, text: "x".repeat(4_096) });
    await deliver(raw, target.address).expect(413);
    expect(await storedMessage(target.tenantId, messageId)).toBeNull();
  });

  it("answers a 100-level nested message without a server error, within 15 seconds", async () => {
    const target = await recipient();
    const raw = nestedMessage(100, { from: "sender@outside.test", to: target.address, messageId: `<${unique("nest")}@outside.test>` });
    const started = Date.now();
    const res = await deliver(raw, target.address);
    expect(res.status).toBeLessThan(500);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 30_000);

  it("answers bytes that are not a message at all without a server error", async () => {
    const target = await recipient();
    const garbage = Buffer.from(Array.from({ length: 2_048 }, (_, i) => (i * 7919) % 256));
    const res = await deliver(garbage, target.address);
    expect(res.status).toBeLessThan(500);
  });

  it("stores a decompression bomb without expanding it (32 MiB inside a ~32 KiB archive)", async () => {
    const target = await recipient();
    const bomb = zipBomb();
    const messageId = `<${unique("bomb")}@outside.test>`;
    const started = Date.now();
    await deliver(
      plain(target.address, { messageId, attachments: [{ filename: "data.zip", contentType: "application/zip", content: bomb }] }),
      target.address
    ).expect(200);
    expect(Date.now() - started).toBeLessThan(15_000);
    const message = await storedMessage(target.tenantId, messageId);
    expect(message!.attachments).toEqual([expect.objectContaining({ fileName: "data.zip", sizeBytes: bomb.length })]);
    // What reached storage is the archive as sent, not its expansion.
    expect([...stored.values()].map((data) => data.length)).toEqual([bomb.length]);
  });
});

// ── ZMT-08: sender-supplied verdicts are not trusted ───────────────────────

describe("ZMT-08 — verdict and authentication headers written by the sender are ignored", () => {
  it("leaves spam, malware and quarantine state untouched by forged PASS headers", async () => {
    const target = await recipient();
    const messageId = `<${unique("forged")}@outside.test>`;
    await deliver(plain(target.address, { messageId, headers: FORGED_VERDICT_HEADERS }), target.address).expect(200);
    const message = await storedMessage(target.tenantId, messageId);
    expect(message).toMatchObject({ spamStatus: "UNKNOWN", malwareStatus: "UNKNOWN", quarantinedAt: null, quarantineReason: null });
    const flags = message!.securityFlags as Record<string, unknown>;
    expect(Object.keys(flags).sort()).toEqual(["envelopeFrom", "inbound", "size"]);
  });

  it("does not quarantine on a forged FAIL header either: a sender cannot steer placement", async () => {
    const target = await recipient();
    const messageId = `<${unique("forged-fail")}@outside.test>`;
    await deliver(
      plain(target.address, { messageId, headers: ["X-SES-Virus-Verdict: FAIL", "X-Zoiko-Security-Verdict: MALICIOUS"] }),
      target.address
    ).expect(200);
    const message = await storedMessage(target.tenantId, messageId);
    expect(message!.mailboxItems[0]!.folder).toBe("INBOX");
    expect(message!.malwareStatus).toBe("UNKNOWN");
  });
});

// ── ZMT-09: duplicates and races ───────────────────────────────────────────

describe("ZMT-09 — duplicate and concurrent deliveries settle on one message", () => {
  it("stores and places a message once when five copies arrive at the same moment", async () => {
    const target = await recipient();
    const messageId = `<${unique("race")}@outside.test>`;
    const raw = plain(target.address, { messageId });
    const responses = await Promise.all(Array.from({ length: 5 }, () => deliver(raw, target.address)));

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    const statuses = responses.map((res) => res.body.data.outcomes[0].status).sort();
    expect(statuses).toEqual(["DELIVERED", "DUPLICATE", "DUPLICATE", "DUPLICATE", "DUPLICATE"]);
    expect(await prisma.emailMessage.count({ where: { tenantId: target.tenantId, providerMessageId: messageId } })).toBe(1);
    expect(await prisma.mailboxMessage.count({ where: { mailboxId: target.mailboxId } })).toBe(1);
  });

  it("keeps a late re-delivery as a duplicate after the first copy was moved out of INBOX", async () => {
    const target = await recipient();
    const messageId = `<${unique("late")}@outside.test>`;
    const raw = plain(target.address, { messageId });
    await deliver(raw, target.address).expect(200);
    await prisma.mailboxMessage.updateMany({ where: { mailboxId: target.mailboxId }, data: { folder: "ARCHIVE" } });
    const again = await deliver(raw, target.address).expect(200);
    expect(again.body.data.outcomes[0].status).toBe("DUPLICATE");
    const items = await prisma.mailboxMessage.findMany({ where: { mailboxId: target.mailboxId } });
    expect(items.map((item) => item.folder)).toEqual(["ARCHIVE"]);
  });
});

// ── Gaps: today's behaviour where the foundation is not built yet ──────────

describe("gaps the later priorities close (current behaviour, pinned)", () => {
  it("[GAP ZMT-03 → P3, needs D-02] the EICAR test file is delivered to INBOX unscanned", async () => {
    const target = await recipient();
    const messageId = `<${unique("eicar")}@outside.test>`;
    await deliver(
      plain(target.address, { messageId, attachments: [{ filename: "eicar.com", contentType: "application/octet-stream", content: eicar() }] }),
      target.address
    ).expect(200);
    const message = await storedMessage(target.tenantId, messageId);
    expect(message!.mailboxItems[0]!.folder).toBe("INBOX");
    expect(message!.malwareStatus).toBe("UNKNOWN");
    expect(message!.attachments[0]!.scanStatus).toBe("PENDING");
  });

  it("[GAP ZMT-05 → P3, needs D-02/D-03] a password-protected archive is delivered with no 'not verified' state", async () => {
    const target = await recipient();
    const messageId = `<${unique("locked")}@outside.test>`;
    await deliver(
      plain(target.address, { messageId, attachments: [{ filename: "invoice.zip", contentType: "application/zip", content: passwordProtectedZip() }] }),
      target.address
    ).expect(200);
    const message = await storedMessage(target.tenantId, messageId);
    expect(message!.mailboxItems[0]!.folder).toBe("INBOX");
    expect(message!.attachments[0]!.scanStatus).toBe("PENDING");
  });

  // Closed in P1 (provisionally, pending D-04): was "[GAP D-04] … is refused".
  it("delivers to a shared mailbox in a workspace with no Owner, attributed to its Admin", async () => {
    // Self-service creators are ADMIN (G0 role fix), so a fresh workspace has
    // no Owner; the ingest used to require one and refused the message.
    const workspace = await recipient("ADMIN");
    const shared = await prisma.mailbox.create({
      data: { tenantId: workspace.tenantId, address: `${unique("support")}@p0-baseline.test`, type: "SHARED" },
    });
    const messageId = `<${unique("no-owner")}@outside.test>`;
    const res = await deliver(plain(shared.address, { messageId }), shared.address).expect(200);
    expect(res.body.data.outcomes).toEqual([{ address: shared.address, status: "DELIVERED" }]);
    const admin = await prisma.tenantMembership.findFirstOrThrow({ where: { tenantId: workspace.tenantId, role: "ADMIN" } });
    const message = await storedMessage(workspace.tenantId, messageId);
    expect(message!.authorUserId).toBe(admin.userId);
    expect(message!.mailboxItems).toEqual([expect.objectContaining({ mailboxId: shared.id, folder: "INBOX" })]);
  });

  it.todo("ZMT-04 phishing sender/URL → warning or quarantine with a reason (P3; needs D-02 vendor and D-03 policy)");
  it.todo("ZMT-07 scanner timeout or feed failure → ENGINE_ERROR, visible degradation, fail state per policy (P3; needs D-02, D-03)");
  it.todo("ZMT-01 recipient check without enumeration detail at the SMTP edge (P2; needs D-01 provider)");
});
