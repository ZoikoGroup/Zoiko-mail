import { createHash } from "node:crypto";
import { Prisma, type SuppressionReason } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

export function recipientHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export class DeliveryProtectionService {
  async assertRecipientsAllowed(tenantId: string, emails: string[]) {
    const hashes = emails.map(recipientHash);
    const suppressed = await prisma.suppressionEntry.findFirst({
      where: { tenantId, emailHash: { in: hashes }, active: true },
      select: { reason: true },
    });
    if (suppressed) {
      throw new AppError(
        `Recipient is suppressed (${suppressed.reason})`,
        409,
        ErrorCodes.CONFLICT
      );
    }
  }

  async reserveWarmup(mailboxId: string, tenantId: string, externalRecipients: number) {
    if (externalRecipients === 0) return true;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "mailboxes"
      SET "warmup_daily_count" = CASE
            WHEN "warmup_daily_started_at" < date_trunc('day', CURRENT_TIMESTAMP)
            THEN ${externalRecipients}
            ELSE "warmup_daily_count" + ${externalRecipients}
          END,
          "warmup_daily_started_at" = CASE
            WHEN "warmup_daily_started_at" < date_trunc('day', CURRENT_TIMESTAMP)
            THEN CURRENT_TIMESTAMP
            ELSE "warmup_daily_started_at"
          END,
          "external_sent_count" = "external_sent_count" + ${externalRecipients},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id"=${mailboxId}::uuid AND "tenant_id"=${tenantId}::uuid
        AND "send_suspended_at" IS NULL
        AND (
          CASE
            WHEN "warmup_daily_started_at" < date_trunc('day', CURRENT_TIMESTAMP)
            THEN ${externalRecipients}
            ELSE "warmup_daily_count" + ${externalRecipients}
          END
        ) <= CASE "warmup_stage"
          WHEN 0 THEN 10 WHEN 1 THEN 25 WHEN 2 THEN 50 WHEN 3 THEN 100
          ELSE COALESCE("custom_warmup_cap", 100)
        END
      RETURNING "id"
    `);
    return rows.length === 1;
  }

  listSuppressions(tenantId: string) {
    return prisma.suppressionEntry.findMany({
      where: { tenantId, active: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async suppress(tenantId: string, email: string, reason: SuppressionReason, userId: string) {
    const entry = await prisma.suppressionEntry.upsert({
      where: { tenantId_emailHash: { tenantId, emailHash: recipientHash(email) } },
      create: { tenantId, emailHash: recipientHash(email), reason },
      update: { active: true, reason },
    });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "RECIPIENT_SUPPRESSED",
      targetType: "SuppressionEntry", targetId: entry.id, metadata: { reason },
    });
    return entry;
  }

  async unsuppress(tenantId: string, id: string, userId: string) {
    const entry = await prisma.suppressionEntry.findFirst({ where: { id, tenantId, active: true } });
    if (!entry) throw new AppError("Suppression entry not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.suppressionEntry.update({ where: { id }, data: { active: false } });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "RECIPIENT_UNSUPPRESSED",
      targetType: "SuppressionEntry", targetId: id,
    });
    return updated;
  }

  async warmupStatus(tenantId: string, mailboxId: string) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      select: {
        id: true, address: true, warmupStage: true, warmupStageStartedAt: true,
        warmupDailyCount: true, warmupDailyStartedAt: true, customWarmupCap: true,
        externalSentCount: true, bounceCount: true, complaintCount: true,
        sendSuspendedAt: true, sendSuspensionReason: true,
      },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);
    const cap = [10, 25, 50, 100][mailbox.warmupStage] ?? mailbox.customWarmupCap ?? 100;
    const bounceRate = mailbox.externalSentCount ? mailbox.bounceCount / mailbox.externalSentCount : 0;
    const complaintRate = mailbox.externalSentCount ? mailbox.complaintCount / mailbox.externalSentCount : 0;
    return { ...mailbox, dailyCap: cap, bounceRate, complaintRate };
  }

  async evaluateWarmup(tenantId: string, mailboxId: string, userId: string) {
    const status = await this.warmupStatus(tenantId, mailboxId);
    if (status.warmupStage >= 3) {
      throw new AppError("Further warm-up promotion requires operations approval", 409, ErrorCodes.CONFLICT);
    }
    const requiredDays = [3, 5, 7][status.warmupStage];
    const elapsedDays = (Date.now() - status.warmupStageStartedAt.getTime()) / 86_400_000;
    if (elapsedDays < requiredDays || status.bounceRate > 0.02 || status.complaintRate > 0.0005) {
      throw new AppError("Mailbox has not met warm-up promotion conditions", 409, ErrorCodes.CONFLICT);
    }
    const updated = await prisma.mailbox.update({
      where: { id: mailboxId, tenantId },
      data: {
        warmupStage: { increment: 1 }, warmupStageStartedAt: new Date(),
        externalSentCount: 0, bounceCount: 0, complaintCount: 0,
      },
      select: {
        id: true, address: true, warmupStage: true, warmupStageStartedAt: true,
        warmupDailyCount: true, warmupDailyStartedAt: true, customWarmupCap: true,
        externalSentCount: true, bounceCount: true, complaintCount: true,
        sendSuspendedAt: true, sendSuspensionReason: true,
      },
    });
    await auditService.record({
      tenantId, actorUserId: userId, eventType: "MAILBOX_WARMUP_PROMOTED",
      targetType: "Mailbox", targetId: mailboxId,
      metadata: { fromStage: status.warmupStage, toStage: status.warmupStage + 1 },
    });
    return updated;
  }

  async processProviderSignal(
    tx: Prisma.TransactionClient,
    event: {
      id: string; tenantId: string; eventType: string;
      normalizedResourceType: string | null; normalizedResourceId: string | null;
      providerEventId: string | null; provider: string;
    }
  ) {
    const type = event.eventType.toUpperCase();
    if (["BOUNCED", "COMPLAINED", "ACCEPTED", "DELIVERED", "DEFERRED", "REJECTED", "BLOCKED", "SUPPRESSED", "RATE_LIMITED", "PROVIDER_ERROR"].includes(type)) {
      if (event.normalizedResourceType !== "RECIPIENT" || !event.normalizedResourceId) {
        throw new Error("DELIVERY_RESOURCE_INVALID");
      }
      const recipient = await tx.messageRecipient.findFirst({
        where: { id: event.normalizedResourceId, tenantId: event.tenantId },
        include: { message: { select: { id: true, authorUserId: true } } },
      });
      if (!recipient) throw new Error("DELIVERY_RECIPIENT_NOT_FOUND");
      const deliveryType = type as "BOUNCED" | "COMPLAINED" | "ACCEPTED" | "DELIVERED" | "DEFERRED" | "REJECTED" | "BLOCKED" | "SUPPRESSED" | "RATE_LIMITED" | "PROVIDER_ERROR";
      await tx.deliveryEvent.create({
        data: {
          tenantId: event.tenantId, messageId: recipient.messageId, recipientId: recipient.id,
          type: deliveryType, providerEventId: event.providerEventId,
          metadata: { provider: event.provider },
        },
      });
      await tx.messageRecipient.update({
        where: { id: recipient.id },
        data: { deliveryStatus: ["ACCEPTED", "DEFERRED"].includes(type) ? "QUEUED" : type === "DELIVERED" ? "DELIVERED" : "FAILED" },
      });
      if (type === "BOUNCED" || type === "COMPLAINED") {
        await tx.suppressionEntry.upsert({
          where: { tenantId_emailHash: { tenantId: event.tenantId, emailHash: recipientHash(recipient.email) } },
          create: {
            tenantId: event.tenantId, emailHash: recipientHash(recipient.email),
            reason: type === "BOUNCED" ? "HARD_BOUNCE" : "COMPLAINT", sourceEventId: event.id,
          },
          update: {
            active: true, reason: type === "BOUNCED" ? "HARD_BOUNCE" : "COMPLAINT",
            sourceEventId: event.id,
          },
        });
        const mailbox = await tx.mailbox.findFirst({
          where: { tenantId: event.tenantId, membership: { tenantId: event.tenantId, userId: recipient.message.authorUserId } },
        });
        if (mailbox) {
          const updated = await tx.mailbox.update({
            where: { id: mailbox.id },
            data: type === "BOUNCED" ? { bounceCount: { increment: 1 } } : { complaintCount: { increment: 1 } },
          });
          const bounceRate = updated.externalSentCount ? updated.bounceCount / updated.externalSentCount : 1;
          const complaintRate = updated.externalSentCount ? updated.complaintCount / updated.externalSentCount : 1;
          if (bounceRate > 0.05 || complaintRate > 0.001 || (updated.warmupStage === 0 && updated.complaintCount > 0)) {
            await tx.mailbox.update({
              where: { id: mailbox.id },
              data: {
                sendSuspendedAt: new Date(),
                sendSuspensionReason: type === "BOUNCED" ? "Bounce threshold exceeded" : "Complaint threshold exceeded",
              },
            });
          }
        }
      }
      return;
    }

    if (["SPAM_DETECTED", "PHISHING_DETECTED", "MALWARE_DETECTED", "SECURITY_CLEAN"].includes(type)) {
      if (event.normalizedResourceType !== "MESSAGE" || !event.normalizedResourceId) throw new Error("SECURITY_RESOURCE_INVALID");
      const message = await tx.emailMessage.findFirst({
        where: { id: event.normalizedResourceId, tenantId: event.tenantId },
      });
      if (!message) throw new Error("SECURITY_MESSAGE_NOT_FOUND");
      const dangerous = type !== "SECURITY_CLEAN";
      await tx.emailMessage.update({
        where: { id: message.id },
        data: {
          spamStatus: type === "SPAM_DETECTED" ? "SPAM" : type === "PHISHING_DETECTED" ? "PHISHING" : type === "SECURITY_CLEAN" ? "CLEAN" : message.spamStatus,
          malwareStatus: type === "MALWARE_DETECTED" ? "DETECTED" : type === "SECURITY_CLEAN" ? "CLEAN" : message.malwareStatus,
          securityFlags: { provider: event.provider, verdict: type },
          quarantinedAt: dangerous ? new Date() : null,
          quarantineReason: dangerous ? type : null,
        },
      });
      if (dangerous) {
        await tx.mailboxMessage.updateMany({
          where: { tenantId: event.tenantId, messageId: message.id },
          data: { folder: "QUARANTINE" },
        });
      }
      if (type === "MALWARE_DETECTED") {
        await tx.messageAttachment.updateMany({
          where: { tenantId: event.tenantId, messageId: message.id },
          data: { scanStatus: "BLOCKED", threatCategory: "MALWARE" },
        });
      }
    }
  }
}

export const deliveryProtectionService = new DeliveryProtectionService();
