import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { notificationService } from "../notification/notification.service.js";
import { participantService, participantSummarySelect, toParticipantSummary } from "../participant/participant.service.js";
import type { z } from "zod";
import type { createActionSchema, updateActionSchema, listActionsSchema } from "./action.schema.js";
type Create = z.infer<typeof createActionSchema>; type Update = z.infer<typeof updateActionSchema>;
type ListFilters = z.infer<typeof listActionsSchema>;
/**
 * Participants, inlined on every commitment that leaves this module.
 *
 * §12: "Commitments must never expose opaque participant IDs without a
 * resolution path" and responses should carry "participant summaries, not
 * only opaque IDs". Inlining is the cheaper half of that promise — the
 * /participants endpoints are the other half, for clients that want more.
 */
const commitmentParticipants = {
  owedBy: { select: participantSummarySelect },
  owedTo: { select: participantSummarySelect },
} satisfies Prisma.CommitmentInclude;

type CommitmentWithParticipants = Prisma.CommitmentGetPayload<{
  include: typeof commitmentParticipants;
}>;

function withParticipantSummaries(commitment: CommitmentWithParticipants) {
  return {
    ...commitment,
    owedBy: commitment.owedBy ? toParticipantSummary(commitment.owedBy) : null,
    owedTo: commitment.owedTo ? toParticipantSummary(commitment.owedTo) : null,
  };
}

export class ActionService {
  async create(input: Create, tenantId: string, userId: string, membershipId: string) {
    const ownerUserId = input.ownerUserId ?? userId;
    const owner = await prisma.tenantMembership.findFirst({ where: { tenantId, userId: ownerUserId, status: "ACTIVE" } });
    if (!owner) throw new AppError("Active owner membership not found", 400, ErrorCodes.VALIDATION_ERROR);
    const mailbox = await prisma.mailbox.findFirst({ where: { tenantId, membershipId }, select: { id: true } });
    if (input.messageId && (!mailbox || !await prisma.emailMessage.findFirst({ where: { id: input.messageId, tenantId, mailboxItems: { some: { tenantId, mailboxId: mailbox.id } } } }))) throw new AppError("Source message not found", 404, ErrorCodes.NOT_FOUND);
    if (input.threadId && (!mailbox || !await prisma.messageThread.findFirst({ where: { id: input.threadId, tenantId, messages: { some: { tenantId, mailboxItems: { some: { tenantId, mailboxId: mailbox.id } } } } } }))) throw new AppError("Source thread not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.$transaction(async (tx) => {
      // §12: a commitment that names only an opaque id is not resolvable, and
      // one that can only name an internal user cannot express an obligation
      // owed to a customer. Both sides resolve to participants.
      const owedBy = input.owedByEmail
        ? await participantService.resolve(tenantId, input.owedByEmail, null, tx)
        : null;
      const owedTo = input.owedToEmail
        ? await participantService.resolve(tenantId, input.owedToEmail, null, tx)
        : null;
      const action = await tx.commitment.create({ data: { tenantId, createdByUserId: userId, ownerUserId, text: input.text, messageId: input.messageId, threadId: input.threadId, dueAt: input.dueAt ? new Date(input.dueAt) : undefined, priority: input.priority, owedByParticipantId: owedBy?.id ?? null, owedToParticipantId: owedTo?.id ?? null }, include: commitmentParticipants });
      if (ownerUserId !== userId) await notificationService.create({ tenantId, userId: ownerUserId, type: "ACTION_REQUIRED", title: "New commitment assigned", body: input.text, linkPath: `/actions/${action.id}` }, tx);
      await auditService.record({ tenantId, actorUserId: userId, eventType: "COMMITMENT_CREATED", targetType: "Commitment", targetId: action.id }, tx);
      return withParticipantSummaries(action);
    });
  }

  list(tenantId: string, userId: string, filters?: ListFilters) {
    const where: Record<string, unknown> = { tenantId, ownerUserId: userId };
    if (filters?.status) where.status = filters.status;
    if (filters?.since || filters?.until) {
      where.createdAt = {
        ...(filters.since && { gte: new Date(filters.since) }),
        ...(filters.until && { lte: new Date(filters.until) }),
      };
    }
    if (filters?.dueBefore || filters?.dueAfter) {
      where.dueAt = {
        ...(filters.dueBefore && { lte: new Date(filters.dueBefore) }),
        ...(filters.dueAfter && { gte: new Date(filters.dueAfter) }),
      };
    }
    return prisma.commitment
      .findMany({ where, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], include: commitmentParticipants })
      .then((rows) => rows.map(withParticipantSummaries));
  }

  async update(id: string, input: Update, tenantId: string, userId: string) {
    const action = await prisma.commitment.findFirst({ where: { id, tenantId, ownerUserId: userId } });
    if (!action) throw new AppError("Commitment not found", 404, ErrorCodes.NOT_FOUND);
    const updated = await prisma.commitment.update({ where: { id: action.id, tenantId }, data: { status: input.status, snoozedUntil: input.status === "SNOOZED" ? new Date(input.snoozedUntil!) : null }, include: commitmentParticipants });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "COMMITMENT_STATUS_CHANGED", targetType: "Commitment", targetId: id, metadata: { status: input.status } });
    return withParticipantSummaries(updated);
  }
}
export const actionService = new ActionService();
