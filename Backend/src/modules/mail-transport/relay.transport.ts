import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { attachmentStorage } from "../mail/attachment.storage.js";
import { dkimService } from "../domain/dkim.service.js";

/**
 * Outbound mail to the internet through an authenticated SMTP relay —
 * decision D2 (implementation guide v2.5 §6).
 *
 * Every mailbox sends as its own address. The single GoDaddy account in
 * MAIL_PROVIDER_* could only ever send as itself, for one member of one
 * workspace; this sends for any mailbox whose domain is cleared for sending.
 * The relay (Amazon SES, Brevo, …) carries the message to the recipient's
 * server; Zoiko records what the relay accepted.
 *
 * Each message gets a real Message-ID, and replies carry In-Reply-To and
 * References, so the conversation threads in the recipient's mail client and
 * their reply threads back here (the ingest service matches on these ids).
 */

/** What the message is recorded under, so inbound replies can find it. */
export const RELAY_PROVIDER_TYPE = "RELAY_SMTP";

export type RelayTransportFactory = () => Pick<Transporter, "sendMail">;

const defaultFactory: RelayTransportFactory = () =>
  nodemailer.createTransport({
    host: env.RELAY_SMTP_HOST,
    port: env.RELAY_SMTP_PORT,
    secure: env.RELAY_SMTP_SECURE,
    // On 587 the session must be upgraded to TLS before credentials are sent.
    requireTLS: !env.RELAY_SMTP_SECURE,
    auth: { user: env.RELAY_SMTP_USERNAME!, pass: env.RELAY_SMTP_PASSWORD! },
    connectionTimeout: env.RELAY_SMTP_TIMEOUT_MS,
    greetingTimeout: env.RELAY_SMTP_TIMEOUT_MS,
    socketTimeout: env.RELAY_SMTP_TIMEOUT_MS,
  });

export class RelayTransport {
  private factory: RelayTransportFactory = defaultFactory;
  private transporter: Pick<Transporter, "sendMail"> | null = null;

  /** Test seam: a transport that captures instead of connecting. */
  setTransportFactory(factory: RelayTransportFactory | null): void {
    this.factory = factory ?? defaultFactory;
    this.transporter = null;
  }

  isConfigured(): boolean {
    return env.RELAY_ENABLED && Boolean(env.RELAY_SMTP_HOST && env.RELAY_SMTP_USERNAME && env.RELAY_SMTP_PASSWORD);
  }

  private client() {
    this.transporter ??= this.factory();
    return this.transporter;
  }

  /**
   * Send the outside recipients of one message. Recipients delivered inside
   * Zoiko are left alone; they already have their copy.
   */
  async sendMessage(messageId: string, tenantId: string) {
    const message = await prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId },
      include: {
        recipients: { where: { deliveryStatus: { not: "DELIVERED" } } },
        attachments: { where: { scanStatus: { not: "BLOCKED" } } },
        sentAsMailbox: { select: { address: true, displayName: true } },
        author: { select: { displayName: true } },
      },
    });
    if (!message) throw new Error("Relay message not found");
    const from = message.fromAddress;
    if (!from) throw new Error("Relay message has no sender address");
    const byType = (type: "TO" | "CC" | "BCC") =>
      message.recipients.filter((recipient) => recipient.type === type).map((recipient) => recipient.email);
    const to = byType("TO");
    const cc = byType("CC");
    const bcc = byType("BCC");
    if (to.length + cc.length + bcc.length === 0) throw new Error("Message has no outside recipients to send to");

    const domain = from.split("@")[1]!.toLowerCase();
    // Ours, and stable across retries: a retry after a lost response must
    // reuse it, or the recipient could receive two messages that do not
    // dedupe and an inbound reply could miss the thread.
    const internetMessageId = message.providerMessageId ?? `<${randomUUID()}@${domain}>`;
    if (!message.providerMessageId) {
      await prisma.emailMessage.update({
        where: { id: message.id, tenantId },
        data: { providerType: RELAY_PROVIDER_TYPE, providerMessageId: internetMessageId },
      });
    }
    const threading = await this.threadHeaders(tenantId, message.threadId, message.id);
    const dkim = await dkimService.signingKeyFor(tenantId, domain);
    const displayName = message.sentAsMailbox?.displayName ?? message.author.displayName;

    const result = await this.client().sendMail({
      from: displayName ? { name: displayName, address: from } : from,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject: message.subject,
      text: message.textBody ?? undefined,
      html: message.htmlBody ?? undefined,
      messageId: internetMessageId,
      ...(threading.inReplyTo ? { inReplyTo: threading.inReplyTo, references: threading.references } : {}),
      attachments: await Promise.all(
        message.attachments.map(async (attachment) => ({
          filename: attachment.fileName,
          contentType: attachment.contentType,
          content: await attachmentStorage.read(attachment.storageKey),
        }))
      ),
      ...(dkim ? { dkim } : {}),
    });

    const accepted = new Set((result.accepted as Array<string | { address: string }>).map(addressOf));
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const recipient of message.recipients) {
        const ok = accepted.has(recipient.email.toLowerCase());
        await tx.messageRecipient.update({
          where: { id: recipient.id, tenantId },
          // QUEUED: the relay has it and is delivering. Nothing reports the
          // final outcome back yet (relay webhooks are the next step).
          data: { deliveryStatus: ok ? "QUEUED" : "FAILED" },
        });
        await tx.deliveryEvent.create({
          data: {
            tenantId,
            messageId: message.id,
            recipientId: recipient.id,
            type: ok ? "ACCEPTED" : "REJECTED",
            providerEventId: typeof result.messageId === "string" ? result.messageId : internetMessageId,
            ...(ok ? {} : { failureCode: "RELAY_REJECTED", failureReason: "The relay refused this recipient" }),
            metadata: { transport: RELAY_PROVIDER_TYPE, response: String(result.response ?? "").slice(0, 300) },
          },
        });
      }
      await tx.emailMessage.update({
        where: { id: message.id, tenantId },
        data: { status: "SENT", sentAt: message.sentAt ?? now, scheduleLastError: null },
      });
      if (message.threadId) {
        await tx.messageThread.update({ where: { id: message.threadId, tenantId }, data: { lastMessageAt: now } });
      }
    });
    return { messageId: message.id, internetMessageId, accepted: accepted.size, rejected: message.recipients.length - accepted.size };
  }

  /**
   * In-Reply-To and References for a message in an existing conversation:
   * the Message-IDs of the earlier messages in its thread, oldest first.
   */
  private async threadHeaders(tenantId: string, threadId: string | null, selfId: string) {
    if (!threadId) return { inReplyTo: null as string | null, references: [] as string[] };
    const earlier = await prisma.emailMessage.findMany({
      where: { tenantId, threadId, id: { not: selfId }, providerMessageId: { not: null } },
      select: { providerMessageId: true },
      orderBy: { createdAt: "asc" },
    });
    const ids = earlier.map((row) => row.providerMessageId!).filter((id) => /^<[^>]+>$/.test(id));
    return { inReplyTo: ids.at(-1) ?? null, references: ids };
  }
}

function addressOf(value: string | { address: string }): string {
  return (typeof value === "string" ? value : value.address).toLowerCase();
}

export const relayTransport = new RelayTransport();
