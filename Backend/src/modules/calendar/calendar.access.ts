import type { CalendarAccess } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import type { CalendarContext } from "./calendar.service.js";

/**
 * Who may do what with a calendar.
 *
 * The owner can do everything. Anyone else has exactly what was shared with
 * them: FREE_BUSY (that time is taken), VIEW (details), EDIT (add and change
 * events), MANAGE (also decide who has access). Without a share, a calendar
 * does not exist for them — 404, never 403, so its existence is not leaked.
 */
export type EffectiveAccess = CalendarAccess | "OWNER";

export const ACCESS_RANK: Record<EffectiveAccess, number> = {
  FREE_BUSY: 1,
  VIEW: 2,
  EDIT: 3,
  MANAGE: 4,
  OWNER: 5,
};

export function atLeast(access: EffectiveAccess | null, needed: EffectiveAccess): boolean {
  return access !== null && ACCESS_RANK[access] >= ACCESS_RANK[needed];
}

/** The caller's access to one calendar, or null when they have none. */
export async function accessTo(calendarId: string, context: CalendarContext) {
  const calendar = await prisma.calendar.findFirst({
    where: { id: calendarId, tenantId: context.tenantId },
    select: {
      id: true,
      kind: true,
      name: true,
      isDefault: true,
      ownerMembershipId: true,
      shares: { where: { membershipId: context.membershipId }, select: { id: true, access: true, isVisible: true } },
    },
  });
  if (!calendar) return null;
  const access: EffectiveAccess | null =
    calendar.ownerMembershipId === context.membershipId ? "OWNER" : calendar.shares[0]?.access ?? null;
  return access ? { calendar, access, share: calendar.shares[0] ?? null } : null;
}

/** The calendar, if the caller has at least `needed`; otherwise 404. */
export async function requireAccess(calendarId: string, needed: EffectiveAccess, context: CalendarContext) {
  const found = await accessTo(calendarId, context);
  if (!found || !atLeast(found.access, needed)) {
    // Holding some access but not enough is a 403 with the reason; holding none
    // is a 404, the same as a calendar that does not exist.
    if (found) {
      throw new AppError("You do not have permission to do that with this calendar.", 403, ErrorCodes.FORBIDDEN, {
        reason: "CALENDAR_ACCESS",
        access: found.access,
      });
    }
    throw new AppError("Calendar not found", 404, ErrorCodes.NOT_FOUND);
  }
  return found;
}
