import { createHash } from "node:crypto";
import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { policyService } from "../policy/policy.service.js";
import { aiProvider, type ActionPriority } from "./ai.provider.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

type AIActionType = Prisma.AIActionCreateInput["actionType"];

const MATERIALIZABLE = new Set<AIActionType>(["COMMITMENT_EXTRACTION", "REPLY_OWED", "DEADLINE", "APPROVAL"]);

function inputHash(tenantId: string, actionType: string, messageId?: string | null, threadId?: string | null) {
  return createHash("sha256")
    .update(`${tenantId}:${actionType}:${messageId ?? threadId}`)
    .digest("hex");
}

export class AIService {
  async create(input: { actionType: Prisma.AIActionCreateInput["actionType"]; messageId?: string; threadId?: string }, context: { tenantId: string; userId: string; membershipId: string; role: MembershipRole }) {
    const mailbox = await prisma.mailbox.findFirst({ where: { tenantId: context.tenantId, membershipId: context.membershipId } });
    const accessible = mailbox && (input.messageId
      ? await prisma.emailMessage.findFirst({ where: { id: input.messageId, tenantId: context.tenantId, mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } } } })
      : await prisma.messageThread.findFirst({ where: { id: input.threadId, tenantId: context.tenantId, messages: { some: { tenantId: context.tenantId, mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } } } } } }));
    if (!accessible) throw new AppError("AI source not found", 404, ErrorCodes.NOT_FOUND);
    const decision = await policyService.evaluate({ type: "AI", context: { actionType: input.actionType, mailbox: { eligible: true } } }, context);
    if (decision.effect === "DENY") throw new AppError(`AI processing denied by tenant policy (${decision.reason})`, 403, ErrorCodes.FORBIDDEN);
    const action = await prisma.aIAction.create({ data: { tenantId: context.tenantId, createdByUserId: context.userId, actionType: input.actionType, messageId: input.messageId, threadId: input.threadId, inputHash: inputHash(context.tenantId, input.actionType, input.messageId, input.threadId) } });
    await auditService.record({ tenantId: context.tenantId, actorUserId: context.userId, eventType: "AI_ACTION_REQUESTED", targetType: "AIAction", targetId: action.id });
    return action;
  }

  list(tenantId: string, userId: string, status?: string) {
    return prisma.aIAction.findMany({
      where: { tenantId, createdByUserId: userId, ...(status ? { status: status as Prisma.AIActionWhereInput["status"] } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  async complete(id: string, input: { output: Prisma.InputJsonValue; confidenceScore: number; sourceExcerpt: string }, tenantId: string, userId: string) {
    const action = await prisma.aIAction.findFirst({ where: { id, tenantId, status: "PENDING" } });
    if (!action) throw new AppError("Pending AI action not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.aIAction.update({ where: { id: action.id, tenantId }, data: { ...input, status: "COMPLETED" } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "AI_ACTION_COMPLETED", targetType: "AIAction", targetId: id });
    return updated;
  }

  /**
   * User review of a completed extraction (ZM-BE-008). CONFIRM materializes the
   * commitment from the action output and — for reply approvals — enqueues the
   * background draft generation (ZM-BE-009).
   */
  async review(id: string, status: "CONFIRMED" | "DISMISSED", tenantId: string, userId: string) {
    const action = await prisma.aIAction.findFirst({ where: { id, tenantId, createdByUserId: userId, status: "COMPLETED" } });
    if (!action) throw new AppError("Completed AI action not found", 404, ErrorCodes.NOT_FOUND);

    return prisma.$transaction(async (tx) => {
      const updated = await tx.aIAction.update({ where: { id: action.id, tenantId }, data: { status } });
      await auditService.record({ tenantId, actorUserId: userId, eventType: `AI_ACTION_${status}`, targetType: "AIAction", targetId: id }, tx);

      if (updated.status === "CONFIRMED" && MATERIALIZABLE.has(updated.actionType)) {
        await this.materializeCommitment(tx, updated);
      }

      // Auto-draft (ZM-BE-009): confirmed reply/approval actions get a draft
      // generated in the background so ingestion is never blocked.
      if (
        updated.status === "CONFIRMED" &&
        env.FLAG_AI_DRAFTING_ENABLED &&
        (updated.actionType === "REPLY_OWED" || updated.actionType === "APPROVAL")
      ) {
        const { jobService } = await import("../job/job.service.js");
        await jobService.enqueue({
          tenantId,
          userId,
          type: "AI_DRAFT_GENERATION",
          payload: { aiActionId: updated.id, messageId: updated.messageId, threadId: updated.threadId },
          idempotencyKey: `ai-draft-${updated.id}`,
        }, tx);
      }
      return updated;
    });
  }

  /**
   * Background AI_EXTRACTION job handler (ZM-BE-007): runs the configured
   * provider over one synced message and records COMPLETED actions for the
   * user to review. Idempotent via the input hash.
   */
  async processExtraction(jobId: string, tenantId: string, actorUserId: string, payload: Prisma.JsonValue) {
    const messageId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      && typeof payload.messageId === "string" ? payload.messageId : null;
    const threadId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      && typeof payload.threadId === "string" ? payload.threadId : null;
    if (!messageId) throw new Error("AI extraction job has no message id");
    if (!env.FLAG_AI_EXTRACTION_ENABLED) {
      return { skipped: true, reason: "FLAG_AI_EXTRACTION_ENABLED=false" };
    }

    const membership = await prisma.tenantMembership.findFirst({
      where: { tenantId, userId: actorUserId, status: "ACTIVE" },
      select: { role: true },
    });
    if (!membership) throw new Error("AI extraction actor is not an active member");

    const message = await prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId },
      select: { id: true, subject: true, fromAddress: true, fromName: true, textBody: true, threadId: true },
    });
    if (!message) throw new Error("AI extraction source message not found");

    const decision = await policyService.evaluate(
      { type: "AI", context: { actionType: "COMMITMENT_EXTRACTION", mailbox: { eligible: true } } },
      { tenantId, userId: actorUserId, role: membership.role }
    );
    if (decision.effect === "DENY") {
      return { skipped: true, reason: `POLICY_DENY:${decision.reason}` };
    }

    const extracted = await aiProvider.extractActions({
      messageId: message.id,
      threadId: threadId ?? message.threadId,
      subject: message.subject,
      fromAddress: message.fromAddress,
      fromName: message.fromName,
      body: message.textBody,
    });

    let created = 0;
    let alreadyPresent = 0;
    for (const action of extracted) {
      const hash = inputHash(tenantId, action.actionType, message.id, threadId ?? message.threadId);
      const existing = await prisma.aIAction.findFirst({ where: { tenantId, inputHash: hash } });
      if (existing) {
        alreadyPresent += 1;
        continue;
      }
      await prisma.aIAction.create({
        data: {
          tenantId,
          createdByUserId: actorUserId,
          actionType: action.actionType,
          messageId: message.id,
          threadId: threadId ?? message.threadId ?? null,
          inputHash: hash,
          output: { text: action.text, dueAt: action.dueAt ?? null, priority: action.priority },
          confidenceScore: action.confidence,
          sourceExcerpt: action.excerpt,
          status: "COMPLETED",
        },
      });
      created += 1;
    }

    await auditService.record({
      tenantId,
      actorUserId,
      eventType: "AI_EXTRACTION_COMPLETED",
      targetType: "BackgroundJob",
      targetId: jobId,
      metadata: { messageId, provider: aiProvider.name, extracted: created, alreadyPresent },
    });
    await prisma.backgroundJob.update({
      where: { id: jobId, tenantId },
      data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, result: { extracted: created, alreadyPresent } },
    });
    logger.info({ jobId, messageId, provider: aiProvider.name, created }, "AI extraction completed");
    return { extracted: created, alreadyPresent, provider: aiProvider.name };
  }

  /**
   * Background AI_DRAFT_GENERATION job handler (ZM-BE-009): composes a DRAFT
   * EmailMessage reply for a confirmed action, threaded to the source message.
   */
  async processDraftGeneration(jobId: string, tenantId: string, actorUserId: string, payload: Prisma.JsonValue) {
    const aiActionId = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      && typeof payload.aiActionId === "string" ? payload.aiActionId : null;
    if (!aiActionId) throw new Error("AI draft job has no aiActionId");
    if (!env.FLAG_AI_DRAFTING_ENABLED) {
      return { skipped: true, reason: "FLAG_AI_DRAFTING_ENABLED=false" };
    }

    const action = await prisma.aIAction.findFirst({
      where: { id: aiActionId, tenantId, status: "CONFIRMED" },
    });
    if (!action) throw new Error("Confirmed AI action for draft generation not found");

    const sourceMessage = action.messageId
      ? await prisma.emailMessage.findFirst({
          where: { id: action.messageId, tenantId },
          include: { thread: true, recipients: true },
        })
      : null;
    const participants = sourceMessage
      ? uniqueSorted([
          ...(sourceMessage.fromAddress ? [sourceMessage.fromAddress] : []),
          ...sourceMessage.recipients.map((recipient) => recipient.email),
        ])
      : [];
    const membership = await prisma.tenantMembership.findFirst({
      where: { tenantId, userId: actorUserId, status: "ACTIVE" },
      include: { mailbox: true, user: { select: { displayName: true } } },
    });
    if (!membership?.mailbox) throw new Error("User has no mailbox to draft from");
    const mailbox = membership.mailbox;
    const sourceThreadId = sourceMessage?.threadId ?? action.threadId ?? null;

    // Idempotency: a retried job must never stack a second draft for the same
    // AIAction (the previous run may have committed the draft but crashed
    // before marking the job COMPLETED).
    const existingForAction = await prisma.emailMessage.findFirst({
      where: { tenantId, sourceAiActionId: aiActionId },
      select: { id: true, status: true },
    });
    if (existingForAction?.status === "DRAFT") {
      await prisma.backgroundJob.update({
        where: { id: jobId, tenantId },
        data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, result: { messageId: existingForAction.id, reused: true } },
      });
      logger.info({ jobId, aiActionId, draftMessageId: existingForAction.id }, "AI draft already exists; reusing");
      return { messageId: existingForAction.id, reused: true, provider: aiProvider.name };
    }

    // Two confirmed actions on the same message (e.g. APPROVAL + REPLY_OWED)
    // both enqueue a draft job; a thread must never end up with two identical
    // AI-generated replies pointing at the same conversation.
    if (sourceThreadId) {
      const threadAiDraft = await prisma.emailMessage.findFirst({
        where: {
          tenantId,
          threadId: sourceThreadId,
          sourceAiActionId: { not: null },
          mailboxItems: { some: { mailboxId: mailbox.id, folder: "DRAFTS" } },
        },
        select: { id: true },
      });
      if (threadAiDraft) {
        await prisma.backgroundJob.update({
          where: { id: jobId, tenantId },
          data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, result: { messageId: threadAiDraft.id, skipped: "THREAD_DRAFT_EXISTS" } },
        });
        logger.info({ jobId, aiActionId, draftMessageId: threadAiDraft.id }, "AI draft already exists for thread; skipping");
        return { messageId: threadAiDraft.id, skipped: "THREAD_DRAFT_EXISTS", provider: aiProvider.name };
      }
    }

    const output = action.output && typeof action.output === "object" && !Array.isArray(action.output)
      ? action.output as Record<string, unknown>
      : {};
    const commitmentText = typeof output.text === "string" ? output.text : null;

    const draft = await aiProvider.generateDraft({
      messageId: sourceMessage?.id ?? action.messageId ?? "",
      threadId: sourceMessage?.threadId ?? action.threadId ?? null,
      threadIdToLink: sourceMessage?.threadId ?? action.threadId ?? null,
      subject: sourceMessage?.subject ?? "(no subject)",
      fromAddress: sourceMessage?.fromAddress ?? null,
      fromName: sourceMessage?.fromName ?? null,
      participants,
      commitmentText,
      actorName: membership.user.displayName ?? null,
    });

    const createdDraft = await prisma.$transaction(async (tx) => {
      // Draft creation and the job's COMPLETED transition commit atomically so
      // a crash cannot leave "draft exists but job not completed" behind.
      let email: { id: string };
      try {
        const created = await tx.emailMessage.create({
          data: {
            tenantId,
            authorUserId: actorUserId,
            threadId: sourceThreadId,
            subject: draft.subject,
            status: "DRAFT",
            textBody: draft.body,
            providerType: null,
            sourceAiActionId: aiActionId,
            fromAddress: mailbox.address,
            fromName: membership.user.displayName,
            recipients: {
              create: participants.slice(0, 20).map((address) => ({
                tenantId,
                email: address,
                type: "TO" as const,
                deliveryStatus: "PENDING" as const,
              })),
            },
            mailboxItems: {
              create: {
                tenantId,
                mailboxId: mailbox.id,
                folder: "DRAFTS",
                isRead: true,
              },
            },
          },
          select: { id: true },
        });
        email = created;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const raced = await tx.emailMessage.findFirst({
            where: { tenantId, sourceAiActionId: aiActionId },
            select: { id: true },
          });
          if (!raced) throw error;
          email = raced;
        } else {
          throw error;
        }
      }
      await tx.backgroundJob.update({
        where: { id: jobId, tenantId },
        data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, result: { messageId: email.id } },
      });
      await auditService.record({
        tenantId,
        actorUserId,
        eventType: "AI_DRAFT_GENERATED",
        targetType: "BackgroundJob",
        targetId: jobId,
        metadata: { aiActionId, messageId: email.id, provider: aiProvider.name },
      }, tx);
      return email;
    });

    logger.info({ jobId, aiActionId, draftMessageId: createdDraft.id }, "AI draft generated");
    return { messageId: createdDraft.id, provider: aiProvider.name };
  }

  private async materializeCommitment(tx: Prisma.TransactionClient, action: { id: string; tenantId: string; createdByUserId: string; messageId: string | null; threadId: string | null; actionType: AIActionType; output: Prisma.JsonValue }) {
    const output = action.output && typeof action.output === "object" && !Array.isArray(action.output)
      ? action.output as Record<string, unknown>
      : {};
    const text = typeof output.text === "string" && output.text.trim().length > 0 ? output.text.trim() : null;
    if (!text) return;

    const existing = await tx.commitment.findFirst({ where: { tenantId: action.tenantId, sourceAiActionId: action.id } });
    if (existing) return;

    const dueAt = typeof output.dueAt === "string" && !Number.isNaN(Date.parse(output.dueAt))
      ? new Date(output.dueAt)
      : null;
    const priority = (["LOW", "MEDIUM", "HIGH", "URGENT"].includes(String(output.priority))
      ? String(output.priority)
      : "MEDIUM") as ActionPriority;

    await tx.commitment.create({
      data: {
        tenantId: action.tenantId,
        messageId: action.messageId,
        threadId: action.threadId,
        ownerUserId: action.createdByUserId,
        createdByUserId: action.createdByUserId,
        text,
        dueAt,
        priority,
        sourceAiActionId: action.id,
      },
    });
    await auditService.record({
      tenantId: action.tenantId,
      actorUserId: action.createdByUserId,
      eventType: "COMMITMENT_CREATED_FROM_AI",
      targetType: "AIAction",
      targetId: action.id,
      metadata: { actionType: action.actionType },
    }, tx);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))].sort();
}

export const aiService = new AIService();