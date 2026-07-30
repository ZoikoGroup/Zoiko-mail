import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { notificationService } from "../notification/notification.service.js";
import type { z } from "zod";
import type { createActionSchema, updateActionSchema } from "./action.schema.js";
type Create = z.infer<typeof createActionSchema>; type Update = z.infer<typeof updateActionSchema>;
export class ActionService {
  async create(input: Create, tenantId: string, userId: string, membershipId: string) {
    const ownerUserId = input.ownerUserId ?? userId;
    const owner = await prisma.tenantMembership.findFirst({ where: { tenantId, userId: ownerUserId, status: "ACTIVE" } });
    if (!owner) throw new AppError("Active owner membership not found", 400, ErrorCodes.VALIDATION_ERROR);
    const mailbox = await prisma.mailbox.findFirst({ where: { tenantId, membershipId }, select: { id: true } });
    if (input.messageId && (!mailbox || !await prisma.emailMessage.findFirst({ where: { id: input.messageId, tenantId, mailboxItems: { some: { tenantId, mailboxId: mailbox.id } } } }))) throw new AppError("Source message not found", 404, ErrorCodes.NOT_FOUND);
    if (input.threadId && (!mailbox || !await prisma.messageThread.findFirst({ where: { id: input.threadId, tenantId, messages: { some: { tenantId, mailboxItems: { some: { tenantId, mailboxId: mailbox.id } } } } } }))) throw new AppError("Source thread not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.$transaction(async (tx) => {
      const action = await tx.commitment.create({ data: { tenantId, createdByUserId: userId, ownerUserId, text: input.text, messageId: input.messageId, threadId: input.threadId, dueAt: input.dueAt ? new Date(input.dueAt) : undefined, priority: input.priority } });
      if (ownerUserId !== userId) await notificationService.create({ tenantId, userId: ownerUserId, type: "ACTION_REQUIRED", title: "New commitment assigned", body: input.text, linkPath: `/actions/${action.id}` }, tx);
      await auditService.record({ tenantId, actorUserId: userId, eventType: "COMMITMENT_CREATED", targetType: "Commitment", targetId: action.id }, tx);
      return action;
    });
  }
  list(tenantId: string, userId: string) {
    return prisma.commitment.findMany({ where: { tenantId, ownerUserId: userId }, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }] });
  }
  async update(id: string, input: Update, tenantId: string, userId: string) {
    const action = await prisma.commitment.findFirst({ where: { id, tenantId, ownerUserId: userId } });
    if (!action) throw new AppError("Commitment not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.commitment.update({ where: { id: action.id, tenantId }, data: { status: input.status, snoozedUntil: input.status === "SNOOZED" ? new Date(input.snoozedUntil!) : null } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "COMMITMENT_STATUS_CHANGED", targetType: "Commitment", targetId: id, metadata: { status: input.status } });
    return updated;
  }
}
export const actionService = new ActionService();
