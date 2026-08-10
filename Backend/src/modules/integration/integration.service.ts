import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
export class IntegrationService {
  list(tenantId: string) { return prisma.integrationLink.findMany({ where: { tenantId, status: { not: "REMOVED" } }, orderBy: { createdAt: "desc" } }); }
  async create(input: { product: Prisma.IntegrationLinkCreateInput["product"]; resourceType: Prisma.IntegrationLinkCreateInput["resourceType"]; sourceType: string; sourceId: string; metadata?: Prisma.InputJsonValue }, tenantId: string, userId: string, membershipId: string) {
    const mailbox = await prisma.mailbox.findFirst({ where: { tenantId, membershipId }, select: { id: true } });
    const exists = input.sourceType === "MESSAGE" ? mailbox && await prisma.emailMessage.findFirst({ where: { id: input.sourceId, tenantId, mailboxItems: { some: { tenantId, mailboxId: mailbox.id } } } })
      : input.sourceType === "THREAD" ? mailbox && await prisma.messageThread.findFirst({ where: { id: input.sourceId, tenantId, messages: { some: { tenantId, mailboxItems: { some: { tenantId, mailboxId: mailbox.id } } } } } })
      : await prisma.commitment.findFirst({ where: { id: input.sourceId, tenantId, OR: [{ ownerUserId: userId }, { createdByUserId: userId }] } });
    if (!exists) throw new AppError("Integration source not found", 404, ErrorCodes.NOT_FOUND);
    const link = await prisma.integrationLink.create({ data: { tenantId, createdByUserId: userId, ...input } });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "INTEGRATION_LINK_CREATED", targetType: "IntegrationLink", targetId: link.id });
    return link;
  }
}
export const integrationService = new IntegrationService();
