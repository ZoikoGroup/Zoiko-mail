import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { jobService } from "../job/job.service.js";

/** The local hour from which a day's digest may be queued. */
export const DAILY_DIGEST_HOUR = 8;

/** The date and hour it is in `zone` at `now`; UTC when the zone is missing or unknown. */
function localClock(now: Date, zone: string | null): { date: string; hour: number } {
  for (const timeZone of [zone || "UTC", "UTC"]) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
        .formatToParts(now);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
    } catch {
      /* Unknown zone: fall through to UTC. */
    }
  }
  return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours() };
}
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

  /**
   * Queues today's digest for everyone who turned the daily digest on and for
   * whom it is now `DAILY_DIGEST_HOUR` or later in their own time zone, once per
   * local day. The digest itself is the same NOTIFICATION_DIGEST job "Send
   * digest now" queues, in the workspace the account is currently signed into.
   */
  async processDailyDigests(now = new Date()) {
    return withCrossTenant(async () => {
      const users = await prisma.appUser.findMany({
        where: { dailyDigest: true, status: "ACTIVE", activeTenantId: { not: null } },
        select: { id: true, timezone: true, activeTenantId: true, dailyDigestLastOn: true },
        take: 500,
      });
      let queued = 0;
      for (const user of users) {
        const { date, hour } = localClock(now, user.timezone);
        if (hour < DAILY_DIGEST_HOUR || user.dailyDigestLastOn === date) continue;
        // Claim the day first, so two sweeps cannot both queue it.
        const claimed = await prisma.appUser.updateMany({
          where: { id: user.id, OR: [{ dailyDigestLastOn: null }, { dailyDigestLastOn: { not: date } }] },
          data: { dailyDigestLastOn: date },
        });
        if (claimed.count === 0) continue;
        try {
          await jobService.enqueue({
            tenantId: user.activeTenantId!,
            userId: user.id,
            type: "NOTIFICATION_DIGEST",
            payload: { userId: user.id },
            idempotencyKey: `digest:daily:${user.id}:${date}`,
          });
          queued += 1;
        } catch {
          // Let the next sweep try this day again.
          await prisma.appUser.update({ where: { id: user.id }, data: { dailyDigestLastOn: user.dailyDigestLastOn } });
        }
      }
      return { queued };
    });
  }
}
export const notificationService = new NotificationService();
