import { createHash } from "node:crypto";
import type { MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { policyService } from "../policy/policy.service.js";
export class AIService {
  async create(input: { actionType: Prisma.AIActionCreateInput["actionType"]; messageId?: string; threadId?: string }, context: { tenantId: string; userId: string; membershipId: string; role: MembershipRole }) {
    const mailbox = await prisma.mailbox.findFirst({ where: { tenantId: context.tenantId, membershipId: context.membershipId } });
    const accessible = mailbox && (input.messageId
      ? await prisma.emailMessage.findFirst({ where: { id: input.messageId, tenantId: context.tenantId, mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } } } })
      : await prisma.messageThread.findFirst({ where: { id: input.threadId, tenantId: context.tenantId, messages: { some: { tenantId: context.tenantId, mailboxItems: { some: { tenantId: context.tenantId, mailboxId: mailbox.id } } } } } }));
    if (!accessible) throw new AppError("AI source not found", 404, ErrorCodes.NOT_FOUND);
    const decision = await policyService.evaluate({ type: "AI", context: { actionType: input.actionType, mailbox: { eligible: true } } }, context);
    if (decision.effect === "DENY") throw new AppError(`AI processing denied by tenant policy (${decision.reason})`, 403, ErrorCodes.FORBIDDEN);
    const action = await prisma.aIAction.create({ data: { tenantId: context.tenantId, createdByUserId: context.userId, actionType: input.actionType, messageId: input.messageId, threadId: input.threadId, inputHash: createHash("sha256").update(`${context.tenantId}:${input.actionType}:${input.messageId ?? input.threadId}`).digest("hex") } });
    await auditService.record({ tenantId: context.tenantId, actorUserId: context.userId, eventType: "AI_ACTION_REQUESTED", targetType: "AIAction", targetId: action.id });
    return action;
  }
  list(tenantId: string, userId: string) { return prisma.aIAction.findMany({ where: { tenantId, createdByUserId: userId }, orderBy: { createdAt: "desc" } }); }
  async complete(id: string, input: { output: Prisma.InputJsonValue; confidenceScore: number; sourceExcerpt: string }, tenantId: string, userId: string) {
    const action = await prisma.aIAction.findFirst({ where: { id, tenantId, status: "PENDING" } });
    if (!action) throw new AppError("Pending AI action not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.aIAction.update({ where: { id: action.id, tenantId }, data: { ...input, status: "COMPLETED" } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "AI_ACTION_COMPLETED", targetType: "AIAction", targetId: id });
    return updated;
  }
  async review(id: string, status: "CONFIRMED" | "DISMISSED", tenantId: string, userId: string) {
    const action = await prisma.aIAction.findFirst({ where: { id, tenantId, createdByUserId: userId, status: "COMPLETED" } });
    if (!action) throw new AppError("Completed AI action not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.aIAction.update({ where: { id: action.id, tenantId }, data: { status } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: `AI_ACTION_${status}`, targetType: "AIAction", targetId: id });
    return updated;
  }
}
export const aiService = new AIService();
