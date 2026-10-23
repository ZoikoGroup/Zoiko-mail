import type { CalendarPreference } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { assertTimeZone } from "./calendar.span.js";
import type { CalendarContext } from "./calendar.service.js";
import type { PreferencesInput } from "./calendar.schema.js";

/**
 * A member's calendar preferences: how their calendar looks, their working
 * hours, defaults for new events, and which calendar notifications they get.
 * Nothing is stored until they change something; until then the defaults apply.
 */

export const DEFAULT_PREFERENCES = {
  defaultView: "week",
  weekStart: 1,
  defaultDurationMinutes: 30,
  timeZone: null as string | null,
  locale: "en-GB",
  dateFormat: "DMY",
  timeFormat: "H24",
  showWeekends: false,
  showDescriptions: true,
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "17:00",
  defaultVisibility: "DEFAULT" as CalendarPreference["defaultVisibility"],
  defaultShowAs: "BUSY" as CalendarPreference["defaultShowAs"],
  allowAccessRequests: true,
  showPendingInvitations: true,
  notifyInvitations: true,
  notifyResponses: true,
  notifyUpdates: true,
  notifyBookings: true,
  notifySharing: true,
  notifyTemplates: true,
};

export type Preferences = typeof DEFAULT_PREFERENCES;

/** The notification groups a member can turn off, and the setting for each. */
export const NOTIFY_SETTING = {
  invitations: "notifyInvitations",
  responses: "notifyResponses",
  updates: "notifyUpdates",
  bookings: "notifyBookings",
  sharing: "notifySharing",
  templates: "notifyTemplates",
} as const;
export type NotifyCategory = keyof typeof NOTIFY_SETTING;

function view(row: CalendarPreference | null): Preferences & { saved: boolean; updatedAt: Date | null } {
  if (!row) return { ...DEFAULT_PREFERENCES, saved: false, updatedAt: null };
  const { id: _id, tenantId: _t, membershipId: _m, createdAt: _c, updatedAt, ...fields } = row;
  return { ...fields, saved: true, updatedAt };
}

export class PreferenceService {
  async get(context: CalendarContext) {
    const row = await prisma.calendarPreference.findUnique({ where: { membershipId: context.membershipId } });
    return view(row && row.tenantId === context.tenantId ? row : null);
  }

  async update(input: PreferencesInput, context: CalendarContext) {
    if (input.timeZone) assertTimeZone(input.timeZone);
    const current = await this.get(context);
    const workStart = input.workStart ?? current.workStart;
    const workEnd = input.workEnd ?? current.workEnd;
    if (workStart >= workEnd) {
      throw new AppError("Working hours must end after they start.", 400, ErrorCodes.VALIDATION_ERROR, [
        { path: "workEnd", message: "Must be after workStart" },
      ]);
    }
    const data = { ...input, ...(input.workDays ? { workDays: Array.from(new Set(input.workDays)).sort((a, b) => a - b) } : {}) };
    const row = await prisma.calendarPreference.upsert({
      where: { membershipId: context.membershipId },
      create: { tenantId: context.tenantId, membershipId: context.membershipId, ...data },
      update: data,
    });
    return view(row);
  }

  /**
   * Of these users (members of the tenant), the ones who turned a notification
   * group off. Everyone without saved preferences gets everything.
   */
  async mutedUsers(tenantId: string, userIds: string[], category: NotifyCategory): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await prisma.calendarPreference.findMany({
      where: { tenantId, [NOTIFY_SETTING[category]]: false, membership: { userId: { in: userIds } } },
      select: { membership: { select: { userId: true } } },
    });
    return new Set(rows.map((r) => r.membership.userId).filter((id): id is string => Boolean(id)));
  }

  /** Whether a member accepts access requests for their personal calendars. */
  async acceptsAccessRequests(tenantId: string, membershipId: string): Promise<boolean> {
    const row = await prisma.calendarPreference.findUnique({ where: { membershipId }, select: { tenantId: true, allowAccessRequests: true } });
    return !row || row.tenantId !== tenantId || row.allowAccessRequests;
  }
}

export const preferenceService = new PreferenceService();
