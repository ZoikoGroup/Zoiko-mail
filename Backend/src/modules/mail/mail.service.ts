import { Prisma, type MailFolder, type MembershipRole, type MessageStatus, type RecipientType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { policyService } from "../policy/policy.service.js";
import { attachmentStorage } from "./attachment.storage.js";
import { normalizeSubject, uniqueParticipants } from "../message/message.utils.js";
import { deliveryProtectionService } from "../delivery-protection/delivery-protection.service.js";
import { jobService } from "../job/job.service.js";
import type { BulkMailboxActionInput, CreateDraftInput, CreateLabelInput, ListMailInput, UpdateDraftInput, UpdateLabelInput, UpdateMailboxItemInput } from "./mail.schema.js";

interface MailContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
  email: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const messageInclude = {
  recipients: { orderBy: [{ type: "asc" as const }, { email: "asc" as const }] },
  attachments: {
    select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
  },
  author: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.EmailMessageInclude;

function recipientRows(input: CreateDraftInput | UpdateDraftInput) {
  if (!input.recipients) return undefined;
  const seen = new Set<string>();
  return (["to", "cc", "bcc"] as const).flatMap((key) =>
    input.recipients![key].flatMap((email) => {
      const uniqueKey = `${key}:${email}`;
      if (seen.has(uniqueKey)) return [];
      seen.add(uniqueKey);
      return [{ email, type: key.toUpperCase() as RecipientType }];
    })
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export class MailService {
  private async mailbox(context: MailContext, tx: Prisma.TransactionClient = prisma) {
    return tx.mailbox.upsert({
      where: { membershipId: context.membershipId, tenantId: context.tenantId },
      create: {
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        address: context.email.toLowerCase(),
      },
      update: {},
    });
  }

  async createDraft(input: CreateDraftInput, context: MailContext) {
    return prisma.$transaction(async (tx) => {
      const mailbox = await this.mailbox(context, tx);
      const now = new Date();
      const thread = await tx.messageThread.create({
        data: {
          tenantId: context.tenantId,
          subjectNormalized: normalizeSubject(input.subject),
          participants: uniqueParticipants([
            context.email,
            ...input.recipients.to,
            ...input.recipients.cc,
            ...input.recipients.bcc,
          ]),
          firstMessageAt: now,
          lastMessageAt: now,
        },
      });
      const message = await tx.emailMessage.create({
        data: {
          tenantId: context.tenantId,
          authorUserId: context.userId,
          threadId: thread.id,
          subject: input.subject,
          textBody: input.textBody,
          htmlBody: input.htmlBody,
          recipients: {
            create: recipientRows(input)!.map((recipient) => ({ ...recipient, tenantId: context.tenantId })),
          },
          mailboxItems: {
            create: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS", isRead: true },
          },
        },
        include: messageInclude,
      });
      await this.audit(tx, context, "MAIL_DRAFT_CREATED", message.id);
      return message;
    });
  }

  async updateDraft(messageId: string, input: UpdateDraftInput, context: MailContext) {
    return prisma.$transaction(async (tx) => {
      const mailbox = await this.mailbox(context, tx);
      const draft = await tx.emailMessage.findFirst({
        where: {
          id: messageId,
          tenantId: context.tenantId,
          authorUserId: context.userId,
          status: "DRAFT",
          mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS" } },
        },
      });
      if (!draft) throw new AppError("Draft not found", 404, ErrorCodes.NOT_FOUND);

      const recipients = recipientRows(input);
      if (recipients) {
        await tx.messageRecipient.deleteMany({ where: { tenantId: context.tenantId, messageId } });
        await tx.messageRecipient.createMany({
          data: recipients.map((recipient) => ({ ...recipient, tenantId: context.tenantId, messageId })),
        });
      }
      const message = await tx.emailMessage.update({
        where: { id: draft.id, tenantId: context.tenantId },
        data: { subject: input.subject, textBody: input.textBody, htmlBody: input.htmlBody },
        include: messageInclude,
      });
      if (draft.threadId) {
        const allRecipients = await tx.messageRecipient.findMany({
          where: { tenantId: context.tenantId, messageId },
          select: { email: true },
        });
        await tx.messageThread.update({
          where: { id: draft.threadId, tenantId: context.tenantId },
          data: {
            subjectNormalized: normalizeSubject(message.subject),
            participants: uniqueParticipants([context.email, ...allRecipients.map((recipient) => recipient.email)]),
          },
        });
      }
      return message;
    });
  }

  async deleteDraft(messageId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const draft = await prisma.emailMessage.findFirst({
      where: {
        id: messageId,
        tenantId: context.tenantId,
        authorUserId: context.userId,
        status: "DRAFT",
        mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS" } },
      },
      include: { attachments: { select: { storageKey: true, sizeBytes: true } } },
    });
    if (!draft) throw new AppError("Draft not found", 404, ErrorCodes.NOT_FOUND);

    const attachmentBytes = draft.attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);
    await prisma.$transaction(async (tx) => {
      await this.audit(tx, context, "MAIL_DRAFT_DELETED", draft.id);
      await tx.emailMessage.delete({ where: { id: draft.id, tenantId: context.tenantId } });
      if (attachmentBytes > 0) {
        await tx.mailbox.update({
          where: { id: mailbox.id, tenantId: context.tenantId },
          data: { storageUsed: { decrement: attachmentBytes } },
        });
      }
      if (draft.threadId) {
        const remaining = await tx.emailMessage.count({
          where: { tenantId: context.tenantId, threadId: draft.threadId },
        });
        if (remaining === 0) {
          await tx.messageThread.delete({ where: { id: draft.threadId, tenantId: context.tenantId } });
        } else {
          await tx.messageThread.update({
            where: { id: draft.threadId, tenantId: context.tenantId },
            data: { messageCount: remaining },
          });
        }
      }
    });
    await Promise.all(draft.attachments.map((attachment) => attachmentStorage.delete(attachment.storageKey)));
    return { deleted: true };
  }

  private async accessibleMessage(messageId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const item = await prisma.mailboxMessage.findFirst({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId },
      include: { message: { include: { recipients: true, author: { select: { email: true } }, thread: { select: { participants: true } } } } },
    });
    if (!item) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    return { mailbox, message: item.message };
  }

  async createReply(
    messageId: string,
    input: { textBody?: string | null; htmlBody?: string | null },
    replyAll: boolean,
    context: MailContext
  ) {
    const { mailbox, message: source } = await this.accessibleMessage(messageId, context);
    if (!source.threadId) throw new AppError("Source message has no thread", 409, ErrorCodes.CONFLICT);
    const self = context.email.toLowerCase();
    const author = source.author.email.toLowerCase();
    const to = new Set<string>();
    const cc = new Set<string>();
    if (author !== self) to.add(author);
    if (replyAll) {
      for (const recipient of source.recipients) {
        const email = recipient.email.toLowerCase();
        if (email === self || recipient.type === "BCC") continue;
        if (recipient.type === "CC") cc.add(email);
        else to.add(email);
      }
    }
    for (const email of to) cc.delete(email);
    if (to.size === 0) throw new AppError("Reply has no eligible recipient", 400, ErrorCodes.VALIDATION_ERROR);
    const subject = /^re:/i.test(source.subject) ? source.subject : `Re: ${source.subject}`;
    const textBody = `${input.textBody ?? ""}\n\n--- Original message ---\n${source.textBody ?? ""}`.trim();
    const htmlBody = input.htmlBody
      ? `${input.htmlBody}<hr><blockquote>${escapeHtml(source.textBody ?? "")}</blockquote>`
      : null;

    return prisma.$transaction(async (tx) => {
      const draft = await tx.emailMessage.create({
        data: {
          tenantId: context.tenantId,
          authorUserId: context.userId,
          threadId: source.threadId,
          subject,
          textBody,
          htmlBody,
          recipients: {
            create: [
              ...[...to].map((email) => ({ tenantId: context.tenantId, email, type: "TO" as const })),
              ...[...cc].map((email) => ({ tenantId: context.tenantId, email, type: "CC" as const })),
            ],
          },
          mailboxItems: { create: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS", isRead: true } },
        },
        include: messageInclude,
      });
      await tx.messageThread.update({
        where: { id: source.threadId!, tenantId: context.tenantId },
        data: {
          messageCount: { increment: 1 },
          participants: uniqueParticipants([
            ...(Array.isArray(source.thread?.participants) ? source.thread.participants.filter((value): value is string => typeof value === "string") : []),
            context.email,
            ...to,
            ...cc,
          ]),
        },
      });
      await this.audit(tx, context, replyAll ? "MAIL_REPLY_ALL_DRAFT_CREATED" : "MAIL_REPLY_DRAFT_CREATED", draft.id, { sourceMessageId: source.id, threadId: source.threadId });
      return draft;
    });
  }

  async createForward(
    messageId: string,
    input: Omit<CreateDraftInput, "subject">,
    context: MailContext
  ) {
    const { message: source } = await this.accessibleMessage(messageId, context);
    const subject = /^fwd:/i.test(source.subject) ? source.subject : `Fwd: ${source.subject}`;
    const textBody = `${input.textBody ?? ""}\n\n--- Forwarded message ---\nFrom: ${source.author.email}\nSubject: ${source.subject}\n\n${source.textBody ?? ""}`.trim();
    const draft = await this.createDraft({ ...input, subject, textBody, htmlBody: input.htmlBody ?? null }, context);
    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: "MAIL_FORWARD_DRAFT_CREATED",
      targetType: "EmailMessage",
      targetId: draft.id,
      requestId: context.requestId,
      metadata: { sourceMessageId: source.id },
    });
    return draft;
  }

  async schedule(messageId: string, scheduledAt: Date, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const draft = await prisma.emailMessage.findFirst({
      where: {
        id: messageId,
        tenantId: context.tenantId,
        authorUserId: context.userId,
        status: "DRAFT",
        mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS" } },
        recipients: { some: { tenantId: context.tenantId, type: "TO" } },
      },
      select: { id: true },
    });
    if (!draft) throw new AppError("Sendable draft not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.$transaction(async (tx) => {
      const scheduled = await tx.emailMessage.update({
        where: { id: draft.id, tenantId: context.tenantId },
        data: { status: "SCHEDULED", scheduledAt, scheduleAttempts: 0, scheduleLastError: null },
        include: messageInclude,
      });
      await this.audit(tx, context, "MAIL_SEND_SCHEDULED", draft.id, { scheduledAt: scheduledAt.toISOString() });
      return scheduled;
    });
  }

  async cancelSchedule(messageId: string, context: MailContext) {
    const scheduled = await prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId: context.tenantId, authorUserId: context.userId, status: "SCHEDULED" },
      select: { id: true },
    });
    if (!scheduled) throw new AppError("Scheduled message not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.$transaction(async (tx) => {
      const draft = await tx.emailMessage.update({
        where: { id: scheduled.id, tenantId: context.tenantId },
        data: { status: "DRAFT", scheduledAt: null, scheduleAttempts: 0, scheduleLastError: null },
        include: messageInclude,
      });
      await this.audit(tx, context, "MAIL_SEND_SCHEDULE_CANCELLED", scheduled.id);
      return draft;
    });
  }

  send(messageId: string, context: MailContext) {
    return this.deliver(messageId, context, ["DRAFT"]);
  }

  private async deliver(messageId: string, context: MailContext, allowedStatuses: MessageStatus[]) {
    const draft = await prisma.emailMessage.findFirst({
      where: {
        id: messageId,
        tenantId: context.tenantId,
        authorUserId: context.userId,
        status: { in: allowedStatuses },
      },
      include: { recipients: true },
    });
    if (!draft) throw new AppError("Draft not found", 404, ErrorCodes.NOT_FOUND);
    if (!draft.recipients.some((recipient) => recipient.type === "TO")) {
      throw new AppError("At least one TO recipient is required", 400, ErrorCodes.VALIDATION_ERROR);
    }
    const senderDomain = context.email.split("@")[1]?.toLowerCase();
    if (senderDomain) {
      const configuredDomain = await prisma.mailDomain.findFirst({
        where: { tenantId: context.tenantId, domainName: senderDomain, type: "CUSTOM" },
        select: { id: true, sendingEnabled: true },
      });
      if (configuredDomain && !configuredDomain.sendingEnabled) {
        await auditService.record({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "DOMAIN_SEND_BLOCKED",
          targetType: "MailDomain",
          targetId: configuredDomain.id,
          requestId: context.requestId,
          metadata: { reason: "DNS_AUTHENTICATION_INCOMPLETE" },
        });
        throw new AppError(
          "Custom-domain sending is blocked until TXT, SPF, DKIM and DMARC checks pass",
          403,
          ErrorCodes.FORBIDDEN
        );
      }
    }

    const externalEmails: string[] = [];
    for (const recipient of draft.recipients) {
      const internal = await prisma.tenantMembership.findFirst({
        where: {
          tenantId: context.tenantId,
          status: "ACTIVE",
          user: { email: { equals: recipient.email, mode: "insensitive" }, status: "ACTIVE" },
        },
        select: { id: true },
      });
      if (!internal) externalEmails.push(recipient.email);
      const decision = await policyService.evaluate({
        type: "SENDING",
        context: { recipient: { email: recipient.email, external: !internal }, sender: { role: context.role } },
      }, context);
      if (decision.effect === "DENY") {
        await auditService.record({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "MAIL_SEND_POLICY_DENIED",
          targetType: "EmailMessage",
          targetId: draft.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { reason: decision.reason, recipientDomain: recipient.email.split("@")[1] ?? null },
        });
        throw new AppError(`Sending denied by tenant policy (${decision.reason})`, 403, ErrorCodes.FORBIDDEN);
      }
    }
    await deliveryProtectionService.assertRecipientsAllowed(context.tenantId, externalEmails);

    const senderMailbox = await this.mailbox(context);
    const warmupReserved = senderMailbox.sendSuspendedAt
      ? true
      : await deliveryProtectionService.reserveWarmup(
          senderMailbox.id,
          context.tenantId,
          externalEmails.length
        );
    if (!warmupReserved) {
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "MAIL_WARMUP_THROTTLED",
        targetType: "Mailbox",
        targetId: senderMailbox.id,
        requestId: context.requestId,
        metadata: { externalRecipientCount: externalEmails.length },
      });
      throw new AppError("Mailbox warm-up daily limit exceeded", 429, ErrorCodes.RATE_LIMIT_EXCEEDED);
    }
    const reservation = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "mailboxes"
      SET "send_recipient_count" = CASE
            WHEN "send_window_started_at" <= CURRENT_TIMESTAMP - (${env.MAIL_SEND_WINDOW_MS} * INTERVAL '1 millisecond')
            THEN ${draft.recipients.length}
            ELSE "send_recipient_count" + ${draft.recipients.length}
          END,
          "send_window_started_at" = CASE
            WHEN "send_window_started_at" <= CURRENT_TIMESTAMP - (${env.MAIL_SEND_WINDOW_MS} * INTERVAL '1 millisecond')
            THEN CURRENT_TIMESTAMP
            ELSE "send_window_started_at"
          END,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${senderMailbox.id}::uuid
        AND "tenant_id" = ${context.tenantId}::uuid
        AND "send_suspended_at" IS NULL
        AND (
          "send_window_started_at" <= CURRENT_TIMESTAMP - (${env.MAIL_SEND_WINDOW_MS} * INTERVAL '1 millisecond')
          OR "send_recipient_count" + ${draft.recipients.length} <= ${env.MAIL_MAX_RECIPIENTS_PER_WINDOW}
        )
      RETURNING "id"
    `);
    if (reservation.length === 0) {
      const current = await prisma.mailbox.findFirst({
        where: { id: senderMailbox.id, tenantId: context.tenantId },
        select: { sendSuspendedAt: true, sendSuspensionReason: true },
      });
      const suspended = Boolean(current?.sendSuspendedAt);
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: suspended ? "MAIL_SEND_SUSPENDED_DENIED" : "MAIL_SEND_RATE_LIMITED",
        targetType: "Mailbox",
        targetId: senderMailbox.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: suspended
          ? { reason: current?.sendSuspensionReason ?? "Sending suspended" }
          : { recipientCount: draft.recipients.length, windowMs: env.MAIL_SEND_WINDOW_MS },
      });
      throw new AppError(
        suspended ? "Mailbox sending is suspended" : "Mailbox sending rate limit exceeded",
        suspended ? 403 : 429,
        suspended ? ErrorCodes.FORBIDDEN : ErrorCodes.RATE_LIMIT_EXCEEDED
      );
    }

    try {
      return await prisma.$transaction(async (tx) => {
      const sentAt = new Date();
      const recipients = await tx.messageRecipient.findMany({
        where: { tenantId: context.tenantId, messageId },
      });

      for (const recipient of recipients) {
        const membership = await tx.tenantMembership.findFirst({
          where: {
            tenantId: context.tenantId,
            status: "ACTIVE",
            user: { email: { equals: recipient.email, mode: "insensitive" }, status: "ACTIVE" },
          },
          include: { user: { select: { email: true } } },
        });
        if (membership) {
          const recipientMailbox = await this.mailbox({
            ...context,
            userId: membership.userId,
            membershipId: membership.id,
            email: membership.user.email,
          }, tx);
          if (recipientMailbox.id !== senderMailbox.id) {
          await tx.mailboxMessage.upsert({
              where: {
                mailboxId_messageId: { mailboxId: recipientMailbox.id, messageId },
                tenantId: context.tenantId,
              },
              create: { tenantId: context.tenantId, mailboxId: recipientMailbox.id, messageId, folder: "INBOX" },
              update: { folder: "INBOX" },
            });
          }
          await tx.messageRecipient.update({
            where: { id: recipient.id, tenantId: context.tenantId },
            data: { recipientMembershipId: membership.id, deliveryStatus: "DELIVERED" },
          });
          await tx.deliveryEvent.create({
            data: {
              tenantId: context.tenantId,
              messageId,
              recipientId: recipient.id,
              type: "DELIVERED",
              metadata: { transport: "INTERNAL" },
            },
          });
        } else {
          await tx.messageRecipient.update({
            where: { id: recipient.id, tenantId: context.tenantId },
            data: { deliveryStatus: "QUEUED" },
          });
          await tx.deliveryEvent.create({
            data: {
              tenantId: context.tenantId,
              messageId,
              recipientId: recipient.id,
              type: "QUEUED",
              metadata: { transport: "EXTERNAL_PROVIDER_PENDING" },
            },
          });
        }
      }

      await tx.mailboxMessage.update({
        where: {
          mailboxId_messageId: { mailboxId: senderMailbox.id, messageId },
          tenantId: context.tenantId,
        },
        data: { folder: "SENT", isRead: true },
      });
      const message = await tx.emailMessage.update({
        where: { id: messageId, tenantId: context.tenantId },
        data: { status: "SENT", sentAt, scheduledAt: null, scheduleLastError: null },
        include: messageInclude,
      });
      if (message.threadId) {
        await tx.messageThread.update({
          where: { id: message.threadId, tenantId: context.tenantId },
          data: { lastMessageAt: sentAt },
        });
      }
      const hasExternalRecipients = await tx.messageRecipient.count({
        where: { tenantId: context.tenantId, messageId, recipientMembershipId: null },
      }) > 0;
      if (
        hasExternalRecipients
        && env.MAIL_PROVIDER_ENABLED
        && context.tenantId === env.MAIL_PROVIDER_TENANT_ID
        && context.membershipId === env.MAIL_PROVIDER_MEMBERSHIP_ID
      ) {
        await jobService.enqueue({
          tenantId: context.tenantId,
          userId: context.userId,
          type: "SMTP_SEND",
          payload: { messageId },
          idempotencyKey: `smtp-send:${messageId}`,
        }, tx);
      }
      await this.audit(tx, context, "MAIL_SENT", message.id, { recipientCount: recipients.length });
      return message;
      });
    } catch (error) {
      await prisma.deliveryEvent.createMany({
        data: draft.recipients.map((recipient) => ({
          tenantId: context.tenantId,
          messageId,
          recipientId: recipient.id,
          type: "FAILED" as const,
          failureCode: "INTERNAL_SEND_FAILURE",
          failureReason: "The message could not be processed",
        })),
      });
      throw error;
    }
  }

  async processDueScheduled(limit = 25) {
    const due = await prisma.emailMessage.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      select: { id: true, tenantId: true, authorUserId: true },
      orderBy: { scheduledAt: "asc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    let sent = 0;
    let failed = 0;
    for (const candidate of due) {
      const claimed = await prisma.emailMessage.updateMany({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          status: "SCHEDULED",
          scheduledAt: { lte: new Date() },
        },
        data: { status: "SENDING", scheduleAttempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      const membership = await prisma.tenantMembership.findFirst({
        where: {
          tenantId: candidate.tenantId,
          userId: candidate.authorUserId,
          status: "ACTIVE",
          tenant: { status: "ACTIVE" },
          user: { status: "ACTIVE" },
        },
        include: { user: { select: { email: true } } },
      });
      if (!membership) {
        await prisma.emailMessage.update({
          where: { id: candidate.id, tenantId: candidate.tenantId },
          data: { status: "FAILED", scheduleLastError: "Sender membership is inactive" },
        });
        failed += 1;
        continue;
      }

      const workerContext: MailContext = {
        tenantId: candidate.tenantId,
        userId: candidate.authorUserId,
        membershipId: membership.id,
        role: membership.role,
        email: membership.user.email,
      };
      try {
        await this.deliver(candidate.id, workerContext, ["SENDING"]);
        sent += 1;
      } catch (error) {
        const current = await prisma.emailMessage.findFirst({
          where: { id: candidate.id, tenantId: candidate.tenantId },
          select: { scheduleAttempts: true },
        });
        const terminal = (current?.scheduleAttempts ?? env.MAIL_SCHEDULE_MAX_ATTEMPTS) >= env.MAIL_SCHEDULE_MAX_ATTEMPTS;
        const message = error instanceof Error ? error.message.slice(0, 1000) : "Scheduled send failed";
        await prisma.emailMessage.update({
          where: { id: candidate.id, tenantId: candidate.tenantId },
          data: {
            status: terminal ? "FAILED" : "SCHEDULED",
            scheduledAt: terminal ? null : new Date(Date.now() + 30_000),
            scheduleLastError: message,
          },
        });
        await auditService.record({
          tenantId: candidate.tenantId,
          actorUserId: candidate.authorUserId,
          eventType: terminal ? "MAIL_SCHEDULE_FAILED" : "MAIL_SCHEDULE_RETRY",
          targetType: "EmailMessage",
          targetId: candidate.id,
          metadata: { error: message, attempt: current?.scheduleAttempts ?? null },
        });
        failed += 1;
      }
    }
    return { claimed: due.length, sent, failed };
  }

  async listDeliveryEvents(messageId: string, context: MailContext) {
    const message = await prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId: context.tenantId, authorUserId: context.userId },
      select: { id: true },
    });
    if (!message) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.deliveryEvent.findMany({
      where: { tenantId: context.tenantId, messageId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Tenant-wide delivery event feed for OWNER/ADMIN (unlike the per-message
   * variant above, which scopes to the authoring user). Read-only reporting:
   * no payload bodies are exposed, only routing metadata.
   */
  async adminListDeliveryEvents(
    input: { type?: string; limit?: number },
    context: MailContext
  ) {
    const events = await prisma.deliveryEvent.findMany({
      where: {
        tenantId: context.tenantId,
        ...(input.type ? { type: input.type as Prisma.DeliveryEventWhereInput["type"] } : {}),
      },
      select: {
        id: true,
        type: true,
        failureCode: true,
        failureReason: true,
        providerEventId: true,
        metadata: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            subject: true,
            fromAddress: true,
            status: true,
            recipients: { select: { email: true, type: true, deliveryStatus: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    return events.map((e) => ({
      id: e.id,
      type: e.type,
      failureCode: e.failureCode,
      failureReason: e.failureReason,
      providerEventId: e.providerEventId,
      metadata: e.metadata ?? null,
      createdAt: e.createdAt,
      messageId: e.message?.id ?? null,
      subject: e.message?.subject ?? null,
      fromAddress: e.message?.fromAddress ?? null,
      recipients: e.message?.recipients ?? [],
    }));
  }

  async updateSendingStatus(
    mailboxId: string,
    input: { suspended: boolean; reason?: string },
    context: MailContext
  ) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId: context.tenantId },
      select: { id: true },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.mailbox.update({
      where: { id: mailbox.id, tenantId: context.tenantId },
      data: {
        sendSuspendedAt: input.suspended ? new Date() : null,
        sendSuspensionReason: input.suspended ? input.reason : null,
        ...(!input.suspended ? { sendRecipientCount: 0, sendWindowStartedAt: new Date() } : {}),
      },
      select: {
        id: true,
        address: true,
        sendSuspendedAt: true,
        sendSuspensionReason: true,
        sendRecipientCount: true,
        sendWindowStartedAt: true,
      },
    });
    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType: input.suspended ? "MAILBOX_SENDING_SUSPENDED" : "MAILBOX_SENDING_RESUMED",
      targetType: "Mailbox",
      targetId: mailbox.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: input.suspended ? { reason: input.reason! } : undefined,
    });
    return updated;
  }

  async list(filters: ListMailInput, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const where = {
      tenantId: context.tenantId,
      mailboxId: mailbox.id,
      folder: filters.folder,
      ...(filters.starredOnly ? { isStarred: true } : {}),
      ...(filters.labelId ? {
        labels: { some: { tenantId: context.tenantId, labelId: filters.labelId } },
      } : {}),
      ...(filters.q ? {
        message: {
          OR: [
            { subject: { contains: filters.q, mode: "insensitive" as const } },
            { textBody: { contains: filters.q, mode: "insensitive" as const } },
            { fromAddress: { contains: filters.q, mode: "insensitive" as const } },
            { fromName: { contains: filters.q, mode: "insensitive" as const } },
            { recipients: { some: { email: { contains: filters.q, mode: "insensitive" as const } } } },
          ],
        },
      } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.mailboxMessage.findMany({
        where,
        include: {
          message: { include: messageInclude },
          labels: { include: { label: true }, orderBy: { label: { name: "asc" } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.mailboxMessage.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        labels: item.labels.map((entry) => entry.label),
        message: {
          ...item.message,
          recipients: item.message.authorUserId === context.userId
            ? item.message.recipients
            : item.message.recipients.filter((recipient) => recipient.type !== "BCC"),
        },
      })),
      pagination: { ...filters, total, totalPages: Math.ceil(total / filters.limit) },
    };
  }

  /**
   * Unread counts per folder for folder-rail badges. DRAFTS is excluded:
   * draft rows are never marked read, so counting them would show a
   * permanent phantom badge.
   */
  async unreadCounts(context: MailContext) {
    const mailbox = await this.mailbox(context);
    const grouped = await prisma.mailboxMessage.groupBy({
      by: ["folder"],
      where: {
        tenantId: context.tenantId,
        mailboxId: mailbox.id,
        isRead: false,
        folder: { not: "DRAFTS" },
      },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.folder] = row._count._all;
    return { counts };
  }

  async get(messageId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const item = await prisma.mailboxMessage.findFirst({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId },
      include: {
        message: { include: messageInclude },
        labels: { include: { label: true }, orderBy: { label: { name: "asc" } } },
      },
    });
    if (!item) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    return {
      ...item,
      labels: item.labels.map((entry) => entry.label),
      message: {
        ...item.message,
        recipients: item.message.authorUserId === context.userId
          ? item.message.recipients
          : item.message.recipients.filter((recipient) => recipient.type !== "BCC"),
      },
    };
  }

  async updateMailboxItem(messageId: string, input: UpdateMailboxItemInput, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const item = await prisma.mailboxMessage.findFirst({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId },
    });
    if (!item) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    if (input.folder === "INBOX" && !["INBOX", "ARCHIVE", "TRASH"].includes(item.folder)) {
      throw new AppError("Only archived or trashed inbox messages can be restored", 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (input.folder === "ARCHIVE" && !["INBOX", "ARCHIVE"].includes(item.folder)) {
      throw new AppError("Only inbox messages can be archived", 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (input.folder === "TRASH" && item.folder === "DRAFTS") {
      throw new AppError("Drafts must be deleted using the draft endpoint", 400, ErrorCodes.VALIDATION_ERROR);
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.mailboxMessage.update({
        where: { id: item.id, tenantId: context.tenantId },
        data: {
          isRead: input.isRead,
          isStarred: input.isStarred,
          folder: input.folder as MailFolder | undefined,
        },
      });
      await this.audit(tx, context, "MAILBOX_ITEM_UPDATED", messageId, {
        ...(input.isRead !== undefined ? { isRead: input.isRead } : {}),
        ...(input.isStarred !== undefined ? { isStarred: input.isStarred } : {}),
        ...(input.folder !== undefined ? { folder: input.folder } : {}),
      });
      return updated;
    });
  }

  async bulkAction(input: BulkMailboxActionInput, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const items = await prisma.mailboxMessage.findMany({
      where: {
        tenantId: context.tenantId,
        mailboxId: mailbox.id,
        messageId: { in: input.messageIds },
      },
      select: { id: true, messageId: true, folder: true },
    });
    if (items.length !== input.messageIds.length) {
      throw new AppError("One or more messages were not found", 404, ErrorCodes.NOT_FOUND);
    }

    const invalid = items.some((item) => {
      if (input.action === "ARCHIVE") return item.folder !== "INBOX" && item.folder !== "ARCHIVE";
      if (input.action === "RESTORE") return item.folder !== "TRASH" && item.folder !== "ARCHIVE";
      if (input.action === "TRASH") return item.folder === "DRAFTS";
      return false;
    });
    if (invalid) {
      throw new AppError("Bulk action is not valid for one or more message folders", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const data: Prisma.MailboxMessageUpdateManyMutationInput =
      input.action === "MARK_READ" ? { isRead: true }
      : input.action === "MARK_UNREAD" ? { isRead: false }
      : input.action === "STAR" ? { isStarred: true }
      : input.action === "UNSTAR" ? { isStarred: false }
      : input.action === "ARCHIVE" ? { folder: "ARCHIVE" }
      : input.action === "TRASH" ? { folder: "TRASH" }
      : { folder: "INBOX" };

    return prisma.$transaction(async (tx) => {
      const result = await tx.mailboxMessage.updateMany({
        where: {
          tenantId: context.tenantId,
          mailboxId: mailbox.id,
          messageId: { in: input.messageIds },
        },
        data,
      });
      await this.audit(tx, context, "MAILBOX_BULK_ACTION_COMPLETED", mailbox.id, {
        action: input.action,
        affectedCount: result.count,
        messageIds: input.messageIds,
      });
      return { action: input.action, affectedCount: result.count };
    });
  }

  async listLabels(context: MailContext) {
    const mailbox = await this.mailbox(context);
    return prisma.mailLabel.findMany({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: { _count: { select: { messages: true } } },
    });
  }

  async createLabel(input: CreateLabelInput, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const normalizedName = input.name.toLocaleLowerCase();
    try {
      return await prisma.$transaction(async (tx) => {
        const label = await tx.mailLabel.create({
          data: {
            tenantId: context.tenantId,
            mailboxId: mailbox.id,
            name: input.name,
            normalizedName,
            color: input.color,
          },
        });
        await this.audit(tx, context, "MAIL_LABEL_CREATED", label.id, { name: label.name });
        return label;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("A label with this name already exists", 409, ErrorCodes.CONFLICT);
      }
      throw error;
    }
  }

  async updateLabel(labelId: string, input: UpdateLabelInput, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const label = await prisma.mailLabel.findFirst({
      where: { id: labelId, tenantId: context.tenantId, mailboxId: mailbox.id },
    });
    if (!label) throw new AppError("Label not found", 404, ErrorCodes.NOT_FOUND);
    try {
      return await prisma.$transaction(async (tx) => {
        const updated = await tx.mailLabel.update({
          where: { id: label.id, tenantId: context.tenantId },
          data: {
            name: input.name,
            normalizedName: input.name?.toLocaleLowerCase(),
            color: input.color,
          },
        });
        await this.audit(tx, context, "MAIL_LABEL_UPDATED", label.id);
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("A label with this name already exists", 409, ErrorCodes.CONFLICT);
      }
      throw error;
    }
  }

  async deleteLabel(labelId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const label = await prisma.mailLabel.findFirst({
      where: { id: labelId, tenantId: context.tenantId, mailboxId: mailbox.id },
    });
    if (!label) throw new AppError("Label not found", 404, ErrorCodes.NOT_FOUND);
    await prisma.$transaction(async (tx) => {
      await tx.mailLabel.delete({ where: { id: label.id, tenantId: context.tenantId } });
      await this.audit(tx, context, "MAIL_LABEL_DELETED", label.id, { name: label.name });
    });
    return { deleted: true };
  }

  async assignLabel(messageId: string, labelId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const [item, label] = await prisma.$transaction([
      prisma.mailboxMessage.findFirst({
        where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId },
        select: { id: true },
      }),
      prisma.mailLabel.findFirst({
        where: { id: labelId, tenantId: context.tenantId, mailboxId: mailbox.id },
        select: { id: true },
      }),
    ]);
    if (!item || !label) throw new AppError("Message or label not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.$transaction(async (tx) => {
      await tx.mailboxMessageLabel.upsert({
        where: { mailboxMessageId_labelId: { mailboxMessageId: item.id, labelId: label.id } },
        create: { tenantId: context.tenantId, mailboxMessageId: item.id, labelId: label.id },
        update: {},
      });
      await this.audit(tx, context, "MAIL_LABEL_ASSIGNED", messageId, { labelId });
      return { assigned: true };
    });
  }

  async removeLabel(messageId: string, labelId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const item = await prisma.mailboxMessage.findFirst({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId },
      select: { id: true },
    });
    if (!item) throw new AppError("Message not found", 404, ErrorCodes.NOT_FOUND);
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.mailboxMessageLabel.deleteMany({
        where: {
          tenantId: context.tenantId,
          mailboxMessageId: item.id,
          labelId,
          label: { tenantId: context.tenantId, mailboxId: mailbox.id },
        },
      });
      if (deleted.count === 0) throw new AppError("Label assignment not found", 404, ErrorCodes.NOT_FOUND);
      await this.audit(tx, context, "MAIL_LABEL_REMOVED", messageId, { labelId });
      return deleted;
    });
    return { removed: result.count === 1 };
  }

  async permanentlyDelete(messageId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const item = await prisma.mailboxMessage.findFirst({
      where: { tenantId: context.tenantId, mailboxId: mailbox.id, messageId, folder: "TRASH" },
    });
    if (!item) throw new AppError("Trashed message not found", 404, ErrorCodes.NOT_FOUND);

    await prisma.$transaction(async (tx) => {
      await tx.mailboxMessage.delete({ where: { id: item.id, tenantId: context.tenantId } });
      await this.audit(tx, context, "MAIL_TRASH_MESSAGE_DELETED", messageId, { mailboxId: mailbox.id });
    });
    return { deleted: true };
  }

  async emptyTrash(context: MailContext) {
    const mailbox = await this.mailbox(context);
    return prisma.$transaction(async (tx) => {
      const result = await tx.mailboxMessage.deleteMany({
        where: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "TRASH" },
      });
      await this.audit(tx, context, "MAIL_TRASH_EMPTIED", mailbox.id, { deletedCount: result.count });
      return { deletedCount: result.count };
    });
  }

  async addAttachment(messageId: string, file: Express.Multer.File, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const draft = await prisma.emailMessage.findFirst({
      where: {
        id: messageId,
        tenantId: context.tenantId,
        authorUserId: context.userId,
        status: "DRAFT",
        mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS" } },
      },
      select: { id: true },
    });
    if (!draft) throw new AppError("Draft not found", 404, ErrorCodes.NOT_FOUND);
    if (mailbox.storageUsed + BigInt(file.size) > mailbox.storageLimit) {
      throw new AppError("Mailbox storage quota exceeded", 413, ErrorCodes.VALIDATION_ERROR);
    }

    const storageKey = await attachmentStorage.save(file.buffer);
    try {
      return await prisma.$transaction(async (tx) => {
        const reserved = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "mailboxes"
          SET "storage_used" = "storage_used" + ${file.size},
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${mailbox.id}::uuid
            AND "tenant_id" = ${context.tenantId}::uuid
            AND "storage_used" + ${file.size} <= "storage_limit"
          RETURNING "id"
        `);
        if (reserved.length === 0) {
          throw new AppError("Mailbox storage quota exceeded", 413, ErrorCodes.VALIDATION_ERROR);
        }
        const attachment = await tx.messageAttachment.create({
          data: {
            tenantId: context.tenantId,
            messageId,
            fileName: file.originalname.slice(0, 255),
            contentType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
          },
          select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
        });
        await this.audit(tx, context, "MAIL_ATTACHMENT_UPLOADED", attachment.id, {
          messageId,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes,
        });
        return attachment;
      });
    } catch (error) {
      await attachmentStorage.delete(storageKey);
      throw error;
    }
  }

  async downloadAttachment(messageId: string, attachmentId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const attachment = await prisma.messageAttachment.findFirst({
      where: {
        id: attachmentId,
        messageId,
        tenantId: context.tenantId,
        message: {
          tenantId: context.tenantId,
          mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } },
        },
      },
      include: { message: { select: { authorUserId: true, quarantinedAt: true } } },
    });
    if (!attachment) throw new AppError("Attachment not found", 404, ErrorCodes.NOT_FOUND);
    if (attachment.scanStatus === "BLOCKED" ||
        (attachment.message.quarantinedAt && attachment.message.authorUserId !== context.userId)) {
      throw new AppError("Attachment is blocked by security controls", 403, ErrorCodes.FORBIDDEN);
    }
    return {
      data: await attachmentStorage.read(attachment.storageKey),
      fileName: attachment.fileName,
      contentType: attachment.contentType,
    };
  }

  async deleteAttachment(messageId: string, attachmentId: string, context: MailContext) {
    const mailbox = await this.mailbox(context);
    const attachment = await prisma.messageAttachment.findFirst({
      where: {
        id: attachmentId,
        messageId,
        tenantId: context.tenantId,
        message: {
          tenantId: context.tenantId,
          authorUserId: context.userId,
          status: "DRAFT",
          mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id, folder: "DRAFTS" } },
        },
      },
    });
    if (!attachment) throw new AppError("Draft attachment not found", 404, ErrorCodes.NOT_FOUND);

    await prisma.$transaction(async (tx) => {
      await tx.messageAttachment.delete({ where: { id: attachment.id, tenantId: context.tenantId } });
      await tx.mailbox.update({
        where: { id: mailbox.id, tenantId: context.tenantId },
        data: { storageUsed: { decrement: attachment.sizeBytes } },
      });
      await this.audit(tx, context, "MAIL_ATTACHMENT_DELETED", attachment.id, { messageId });
    });
    await attachmentStorage.delete(attachment.storageKey);
    return { deleted: true };
  }

  // ─── Admin: List all tenant mailboxes ────────────────────────────────────────

  async listAllMailboxes(tenantId: string) {
    const mailboxes = await prisma.mailbox.findMany({
      where: { tenantId },
      include: {
        membership: {
          include: {
            user: { select: { id: true, displayName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return mailboxes.map((mb) => ({
      ...mb,
      storageUsed: Number(mb.storageUsed),
      storageLimit: Number(mb.storageLimit),
    }));
  }

  // ─── Admin: Provision a mailbox for an existing member ──────────────────────

  async adminCreateMailbox(tenantId: string, membershipId: string, context: MailContext) {
    const membership = await prisma.tenantMembership.findFirst({
      where: { id: membershipId, tenantId, status: "ACTIVE" },
      include: { user: { select: { id: true, email: true } }, mailbox: true },
    });
    if (!membership) throw new AppError("Active membership not found", 404, ErrorCodes.NOT_FOUND);
    if (membership.mailbox) throw new AppError("Mailbox already exists for this member", 409, ErrorCodes.CONFLICT);

    const mailbox = await prisma.mailbox.create({
      data: {
        tenantId,
        membershipId,
        address: membership.user.email.toLowerCase(),
      },
      include: {
        membership: {
          include: {
            user: { select: { id: true, displayName: true, email: true } },
          },
        },
      },
    });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "MAILBOX_CREATED",
      targetType: "Mailbox",
      targetId: mailbox.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { address: mailbox.address, membershipId },
    });

    return {
      ...mailbox,
      storageUsed: Number(mailbox.storageUsed),
      storageLimit: Number(mailbox.storageLimit),
    };
  }

  // ─── Admin: Delete a mailbox ────────────────────────────────────────────────

  async adminDeleteMailbox(tenantId: string, mailboxId: string, context: MailContext) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      select: { id: true, address: true },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);

    const messageCount = await prisma.mailboxMessage.count({
      where: { mailboxId, tenantId },
    });
    if (messageCount > 0) {
      throw new AppError("Cannot delete mailbox with messages", 409, ErrorCodes.CONFLICT);
    }

    await prisma.mailbox.delete({ where: { id: mailboxId, tenantId } });

    await auditService.record({
      tenantId,
      actorUserId: context.userId,
      eventType: "MAILBOX_DELETED",
      targetType: "Mailbox",
      targetId: mailboxId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { address: mailbox.address },
    });

    return { deleted: true };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: MailContext,
    eventType: string,
    targetId: string,
    metadata?: Prisma.InputJsonValue
  ) {
    await auditService.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      eventType,
      targetType: "EmailMessage",
      targetId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata,
    }, tx);
  }
}

export const mailService = new MailService();
