import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { attachmentStorage } from "../mail/attachment.storage.js";
import { policyRulesSchema, type PolicyRules } from "./policy.schema.js";

interface RetentionContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function readField(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function matches(actual: unknown, operator: PolicyRules["conditions"][number]["operator"], expected: unknown) {
  if (operator === "EQUALS") return actual === expected;
  if (operator === "NOT_EQUALS") return actual !== expected;
  if (operator === "IN") return Array.isArray(expected) && expected.includes(actual as never);
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (operator === "GREATER_THAN") return actual > expected;
  if (operator === "GREATER_THAN_OR_EQUAL") return actual >= expected;
  if (operator === "LESS_THAN") return actual < expected;
  return actual <= expected;
}

export class RetentionService {
  private async eligible(context: RetentionContext, asOf: Date) {
    const policy = await prisma.tenantPolicy.findFirst({
      where: { tenantId: context.tenantId, type: "RETENTION", status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    if (!policy) throw new AppError("No active retention policy", 409, ErrorCodes.CONFLICT);
    const rules = policyRulesSchema.parse(policy.rules);
    const messages = await prisma.emailMessage.findMany({
      where: { tenantId: context.tenantId, status: "SENT", createdAt: { lt: asOf } },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        sentAt: true,
        threadId: true,
        authorUserId: true,
        attachments: { select: { storageKey: true, sizeBytes: true } },
        author: {
          select: {
            memberships: {
              where: { tenantId: context.tenantId },
              select: { mailbox: { select: { id: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 501,
    });
    const eligible = messages.filter((message) => {
      const ageDays = Math.floor((asOf.getTime() - message.createdAt.getTime()) / 86_400_000);
      const evaluationContext = {
        message: {
          ageDays,
          status: "SENT",
          hasAttachments: message.attachments.length > 0,
        },
      };
      const matched = rules.conditions.find((condition) =>
        matches(readField(evaluationContext, condition.field), condition.operator, condition.value)
      );
      return (matched?.effect ?? rules.defaultEffect) === "ALLOW";
    });
    return { policy, eligible: eligible.slice(0, 500), capped: eligible.length > 500 };
  }

  async preview(asOf: Date, context: RetentionContext) {
    const result = await this.eligible(context, asOf);
    return {
      policyId: result.policy.id,
      policyVersion: result.policy.version,
      asOf,
      eligibleCount: result.eligible.length,
      capped: result.capped,
      totalAttachmentBytes: result.eligible.reduce(
        (total, message) => total + message.attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
        0
      ),
      oldestMessageAt: result.eligible[0]?.createdAt ?? null,
      newestMessageAt: result.eligible.at(-1)?.createdAt ?? null,
    };
  }

  async execute(asOf: Date, context: RetentionContext) {
    const result = await this.eligible(context, asOf);
    const messageIds = result.eligible.map((message) => message.id);
    if (messageIds.length === 0) return { deletedCount: 0, capped: false };
    const storageByMailbox = new Map<string, number>();
    const storageKeys: string[] = [];
    const threadIds = new Set<string>();
    for (const message of result.eligible) {
      if (message.threadId) threadIds.add(message.threadId);
      const mailboxId = message.author.memberships[0]?.mailbox?.id;
      for (const attachment of message.attachments) {
        storageKeys.push(attachment.storageKey);
        if (mailboxId) storageByMailbox.set(mailboxId, (storageByMailbox.get(mailboxId) ?? 0) + attachment.sizeBytes);
      }
    }

    await prisma.$transaction(async (tx) => {
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "RETENTION_CLEANUP_EXECUTED",
        targetType: "TenantPolicy",
        targetId: result.policy.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { deletedCount: messageIds.length, asOf: asOf.toISOString(), capped: result.capped },
      }, tx);
      await tx.emailMessage.deleteMany({ where: { tenantId: context.tenantId, id: { in: messageIds } } });
      for (const [mailboxId, bytes] of storageByMailbox) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "mailboxes"
          SET "storage_used" = GREATEST(0, "storage_used" - ${bytes}),
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${mailboxId}::uuid AND "tenant_id" = ${context.tenantId}::uuid
        `);
      }
      for (const threadId of threadIds) {
        const remaining = await tx.emailMessage.findMany({
          where: { tenantId: context.tenantId, threadId },
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
        });
        if (remaining.length === 0) {
          await tx.messageThread.deleteMany({ where: { id: threadId, tenantId: context.tenantId } });
        } else {
          await tx.messageThread.update({
            where: { id: threadId, tenantId: context.tenantId },
            data: {
              messageCount: remaining.length,
              firstMessageAt: remaining[0]!.createdAt,
              lastMessageAt: remaining.at(-1)!.createdAt,
            },
          });
        }
      }
    });
    await Promise.all(storageKeys.map((storageKey) => attachmentStorage.delete(storageKey)));
    return { deletedCount: messageIds.length, capped: result.capped };
  }
}

export const retentionService = new RetentionService();
