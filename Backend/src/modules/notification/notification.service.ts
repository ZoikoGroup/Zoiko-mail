import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
export class NotificationService {
  create(input: { tenantId: string; userId: string; type: NotificationType; title: string; body: string; linkPath?: string }, tx: Prisma.TransactionClient = prisma) {
    return tx.notification.create({ data: input });
  }
  list(tenantId: string, userId: string, unreadOnly: boolean) {
    return prisma.notification.findMany({ where: { tenantId, userId, readAt: unreadOnly ? null : undefined }, orderBy: { createdAt: "desc" }, take: 100 });
  }
  async markRead(id: string, tenantId: string, userId: string) {
    const item = await prisma.notification.findFirst({ where: { id, tenantId, userId } });
    if (!item) throw new AppError("Notification not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.notification.update({ where: { id: item.id, tenantId }, data: { readAt: item.readAt ?? new Date() } });
  }
}
export const notificationService = new NotificationService();
