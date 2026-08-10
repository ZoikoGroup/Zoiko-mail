import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { auditService } from "../audit/audit.service.js";
import { normalizeSubject, uniqueParticipants } from "../message/message.utils.js";
import { imapSmtpAdapter, type ImapSmtpAdapter } from "./imap-smtp.adapter.js";

export class ProviderMailService {
  constructor(private readonly adapter: ImapSmtpAdapter = imapSmtpAdapter) {}

  private mapping() {
    if (!env.MAIL_PROVIDER_ENABLED || !env.MAIL_PROVIDER_TENANT_ID || !env.MAIL_PROVIDER_MEMBERSHIP_ID) {
      throw new Error("IMAP/SMTP tenant mapping is not configured");
    }
    return {
      tenantId: env.MAIL_PROVIDER_TENANT_ID,
      membershipId: env.MAIL_PROVIDER_MEMBERSHIP_ID,
      address: env.MAIL_PROVIDER_FROM_ADDRESS!.toLowerCase(),
    };
  }

  async validateMapping() {
    const mapping = this.mapping();
    const membership = await prisma.tenantMembership.findFirst({
      where: {
        id: mapping.membershipId,
        tenantId: mapping.tenantId,
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
        user: { status: "ACTIVE" },
      },
      include: { user: { select: { id: true } } },
    });
    if (!membership) throw new Error("Configured IMAP/SMTP membership is not active in the configured tenant");
    return { ...mapping, userId: membership.user.id };
  }

  async ensureConnectedAccount() {
    const mapping = await this.validateMapping();
    return prisma.connectedAccount.upsert({
      where: { provider_providerAccountId: { provider: "IMAP_SMTP", providerAccountId: mapping.address } },
      create: {
        tenantId: mapping.tenantId,
        membershipId: mapping.membershipId,
        userId: mapping.userId,
        provider: "IMAP_SMTP",
        providerAccountId: mapping.address,
        email: mapping.address,
        scopes: ["mail.read", "mail.send"],
        status: "ACTIVE",
      },
      update: {
        tenantId: mapping.tenantId,
        membershipId: mapping.membershipId,
        userId: mapping.userId,
        email: mapping.address,
        scopes: ["mail.read", "mail.send"],
        status: "ACTIVE",
        disconnectedAt: null,
        lastErrorCode: null,
      },
    });
  }

  async enqueueSync() {
    const mapping = await this.validateMapping();
    const bucket = Math.floor(Date.now() / env.MAIL_PROVIDER_SYNC_INTERVAL_MS);
    return prisma.backgroundJob.upsert({
      where: {
        tenantId_idempotencyKey: {
          tenantId: mapping.tenantId,
          idempotencyKey: `imap-sync:${bucket}`,
        },
      },
      create: {
        tenantId: mapping.tenantId,
        createdByUserId: mapping.userId,
        type: "IMAP_SYNC",
        payload: {},
        idempotencyKey: `imap-sync:${bucket}`,
      },
      update: {},
    });
  }

  async syncInbox(limit = 100) {
    const mapping = await this.validateMapping();
    const account = await this.ensureConnectedAccount();
    const mailbox = await prisma.mailbox.upsert({
      where: { membershipId: mapping.membershipId },
      create: {
        tenantId: mapping.tenantId,
        membershipId: mapping.membershipId,
        address: mapping.address,
      },
      update: { address: mapping.address },
    });
    const fetched = await this.adapter.fetchMetadata(limit);
    let imported = 0;

    for (const item of fetched) {
      const providerMessageId = item.providerMessageId?.trim() || `uid:${item.uid}`;
      const exists = await prisma.emailMessage.findUnique({
        where: {
          tenantId_providerType_providerMessageId: {
            tenantId: mapping.tenantId,
            providerType: "IMAP_SMTP",
            providerMessageId,
          },
        },
        select: { id: true },
      });
      if (exists) continue;

      const sender = item.from[0];
      const receivedAt = item.date ?? new Date();
      const recipients = [...item.to.map((value) => ({ ...value, type: "TO" as const })),
        ...item.cc.map((value) => ({ ...value, type: "CC" as const }))];

      await prisma.$transaction(async (tx) => {
        const thread = await tx.messageThread.create({
          data: {
            tenantId: mapping.tenantId,
            subjectNormalized: normalizeSubject(item.subject),
            participants: uniqueParticipants([
              ...item.from.map((value) => value.address),
              ...recipients.map((value) => value.address),
            ]),
            firstMessageAt: receivedAt,
            lastMessageAt: receivedAt,
          },
        });
        const message = await tx.emailMessage.create({
          data: {
            tenantId: mapping.tenantId,
            authorUserId: mapping.userId,
            threadId: thread.id,
            subject: item.subject || "(no subject)",
            status: "RECEIVED",
            sentAt: receivedAt,
            providerType: "IMAP_SMTP",
            providerMessageId,
            providerUid: String(item.uid),
            fromAddress: sender?.address ?? null,
            fromName: sender?.name ?? null,
            securityFlags: { metadataOnly: true, size: item.size },
            recipients: {
              create: recipients.map((recipient) => ({
                tenantId: mapping.tenantId,
                email: recipient.address,
                type: recipient.type,
                deliveryStatus: "DELIVERED",
              })),
            },
            mailboxItems: {
              create: {
                tenantId: mapping.tenantId,
                mailboxId: mailbox.id,
                folder: "INBOX",
                isRead: item.flags.includes("\\Seen"),
                isStarred: item.flags.includes("\\Flagged"),
              },
            },
          },
        });
        await auditService.record({
          tenantId: mapping.tenantId,
          actorUserId: mapping.userId,
          eventType: "IMAP_MESSAGE_IMPORTED",
          targetType: "EmailMessage",
          targetId: message.id,
          metadata: { provider: "IMAP_SMTP", metadataOnly: true },
        }, tx);
      });
      imported += 1;
    }

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date(), status: "ACTIVE", lastErrorCode: null },
    });
    await auditService.record({
      tenantId: mapping.tenantId,
      actorUserId: mapping.userId,
      eventType: "IMAP_SYNC_COMPLETED",
      targetType: "ConnectedAccount",
      targetId: account.id,
      metadata: { fetched: fetched.length, imported },
    });
    return { fetched: fetched.length, imported };
  }

  async sendMessage(messageId: string, tenantId: string) {
    const mapping = await this.validateMapping();
    if (tenantId !== mapping.tenantId) throw new Error("SMTP job tenant does not match the configured tenant");
    const message = await prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId, authorUserId: mapping.userId },
      include: { recipients: { where: { recipientMembershipId: null } } },
    });
    if (!message) throw new Error("SMTP message is not available for the configured tenant");
    const byType = (type: "TO" | "CC" | "BCC") =>
      message.recipients.filter((recipient) => recipient.type === type).map((recipient) => recipient.email);
    const result = await this.adapter.send({
      to: byType("TO"),
      cc: byType("CC"),
      bcc: byType("BCC"),
      subject: message.subject,
      text: message.textBody,
      html: message.htmlBody,
    });
    const accepted = new Set(result.accepted.map((address: string) => address.toLowerCase()));
    await prisma.$transaction(async (tx) => {
      for (const recipient of message.recipients) {
        const wasAccepted = accepted.has(recipient.email.toLowerCase());
        await tx.messageRecipient.update({
          where: { id: recipient.id, tenantId },
          data: { deliveryStatus: wasAccepted ? "QUEUED" : "FAILED" },
        });
        await tx.deliveryEvent.create({
          data: {
            tenantId,
            messageId,
            recipientId: recipient.id,
            type: wasAccepted ? "ACCEPTED" : "REJECTED",
            providerEventId: result.messageId,
            metadata: { transport: "IMAP_SMTP" },
          },
        });
      }
    });
    return { messageId, accepted: result.accepted.length, rejected: result.rejected.length };
  }
}

export const providerMailService = new ProviderMailService();
