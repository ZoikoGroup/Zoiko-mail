import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { assertTimeZone, normaliseSpan } from "./calendar.span.js";
import { describeWhen, notifyMembers, recordActivity, resolveAttendees, syncAttendees } from "./invitation.service.js";
import { requireAccess } from "./calendar.access.js";
import { sharingService } from "./sharing.service.js";
import { resourceService } from "./resource.service.js";
import type {
  CreateCalendarInput,
  CreateEventInput,
  CreateTeamCalendarInput,
  ListEventsInput,
  UpdateCalendarInput,
  UpdateEventInput,
} from "./calendar.schema.js";

export interface CalendarContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  /** The member’s real role. Owners and Admins manage rooms and approve bookings. */
  membershipRole?: string;
  requestId?: string;
}

/** How many calendars one member may keep. */
const MAX_CALENDARS = 20;

const calendarSelect = {
  id: true,
  kind: true,
  name: true,
  color: true,
  description: true,
  isDefault: true,
  isVisible: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CalendarSelect;

const eventSelect = {
  id: true,
  calendarId: true,
  title: true,
  description: true,
  location: true,
  videoLink: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  timeZone: true,
  visibility: true,
  showAs: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CalendarEventSelect;

const notFound = (what: "Calendar" | "Event") => new AppError(`${what} not found`, 404, ErrorCodes.NOT_FOUND);
export class CalendarService {
  /**
   * The member's calendars, creating their first one ("Work") on first use.
   *
   * Created lazily rather than at sign-up so every existing member gets one
   * without a backfill. A unique partial index (one default per member) makes
   * two simultaneous first visits create it once: the loser finds the
   * winner's calendar.
   */
  async listCalendars(context: CalendarContext) {
    const existing = await prisma.calendar.findMany({
      where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId, kind: "PERSONAL" },
      select: calendarSelect,
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (existing.length > 0) return existing;

    try {
      await prisma.calendar.create({
        data: {
          tenantId: context.tenantId,
          ownerMembershipId: context.membershipId,
          name: "Work",
          color: "blue",
          isDefault: true,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    return prisma.calendar.findMany({
      where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId, kind: "PERSONAL" },
      select: calendarSelect,
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  async createCalendar(input: CreateCalendarInput, context: CalendarContext) {
    await this.listCalendars(context); // the default exists before any other
    const count = await prisma.calendar.count({
      where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId },
    });
    if (count >= MAX_CALENDARS) {
      throw new AppError(`You can keep up to ${MAX_CALENDARS} calendars.`, 409, ErrorCodes.CONFLICT, {
        reason: "CALENDAR_LIMIT",
      });
    }
    return prisma.calendar.create({
      data: {
        tenantId: context.tenantId,
        ownerMembershipId: context.membershipId,
        name: input.name,
        color: input.color,
        description: input.description ?? null,
      },
      select: calendarSelect,
    });
  }

  /**
   * A team calendar: a shared calendar for a group. Its creator owns and
   * manages it; the colleagues named join it and can add and change events.
   */
  async createTeamCalendar(input: CreateTeamCalendarInput, context: CalendarContext) {
    const count = await prisma.calendar.count({
      where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId },
    });
    if (count >= MAX_CALENDARS) {
      throw new AppError(`You can keep up to ${MAX_CALENDARS} calendars.`, 409, ErrorCodes.CONFLICT, {
        reason: "CALENDAR_LIMIT",
      });
    }
    const resolved = await resolveAttendees(input.members, context);
    const outsiders = resolved.filter((m) => !m.membershipId).map((m) => m.email);
    if (outsiders.length) {
      throw new AppError(
        `Only members of this workspace can join a team calendar: ${outsiders.join(", ")}`,
        400,
        ErrorCodes.VALIDATION_ERROR,
        [{ path: "members", message: "Not a member of this workspace" }]
      );
    }
    const calendar = await prisma.$transaction(async (tx) => {
      const created = await tx.calendar.create({
        data: {
          tenantId: context.tenantId,
          ownerMembershipId: context.membershipId,
          kind: "TEAM",
          name: input.name,
          color: input.color,
          description: input.description ?? null,
        },
        select: calendarSelect,
      });
      if (resolved.length) {
        await tx.calendarShare.createMany({
          data: resolved.map((m) => ({
            tenantId: context.tenantId,
            calendarId: created.id,
            membershipId: m.membershipId!,
            access: "EDIT" as const,
            grantedByMembershipId: context.membershipId,
          })),
        });
      }
      return created;
    });
    await notifyMembers(context, resolved, {
      category: "sharing",
      title: `Added to ${calendar.name}`,
      body: "You can see and add events in this team calendar.",
      eventId: "",
      linkPath: "/mail/calendar/team",
    });
    return calendar;
  }

  /**
   * Rename or recolour (owner or manager), or show/hide — which is each
   * person's own choice, so for a calendar shared with the caller it changes
   * only their view of it.
   */
  async updateCalendar(calendarId: string, input: UpdateCalendarInput, context: CalendarContext) {
    const { isVisible, ...rest } = input;
    if (Object.keys(rest).length > 0) await requireAccess(calendarId, "MANAGE", context);
    if (isVisible !== undefined) await sharingService.setMyVisibility(calendarId, isVisible, context);
    if (Object.keys(rest).length > 0) {
      await prisma.calendar.update({ where: { id: calendarId, tenantId: context.tenantId }, data: rest });
    }
    const all = await sharingService.accessibleCalendars(context);
    const updated = all.find((c) => c.id === calendarId);
    if (!updated) throw notFound("Calendar");
    return updated;
  }

  /** Deletes the calendar and every event in it. Owner only; the main calendar stays. */
  async deleteCalendar(calendarId: string, context: CalendarContext) {
    const { calendar } = await requireAccess(calendarId, "OWNER", context);
    if (calendar.isDefault) {
      throw new AppError("Your main calendar cannot be deleted.", 409, ErrorCodes.CONFLICT, {
        reason: "DEFAULT_CALENDAR",
      });
    }
    await prisma.calendar.delete({ where: { id: calendarId, tenantId: context.tenantId } });
  }

  /**
   * Everything on the member's calendar in [from, to): events in their own
   * calendars, and events they are invited to and have not declined. Each says
   * which it is (`source`), so the client draws invitations differently and
   * opens them as invitations rather than for editing.
   */
  async listEvents(range: ListEventsInput, context: CalendarContext) {
    const overlap = { startsAt: { lt: range.to }, endsAt: { gt: range.from } };
    const [own, invited] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { tenantId: context.tenantId, calendar: { ownerMembershipId: context.membershipId, kind: "PERSONAL" }, ...overlap },
        select: { ...eventSelect, _count: { select: { attendees: true } } },
        orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }],
        take: 2000,
      }),
      prisma.eventAttendee.findMany({
        where: {
          tenantId: context.tenantId,
          membershipId: context.membershipId,
          response: { not: "DECLINED" },
          event: overlap,
        },
        select: {
          response: true,
          event: {
            select: {
              ...eventSelect,
              _count: { select: { attendees: true } },
              organizer: { select: { user: { select: { email: true, displayName: true } } } },
            },
          },
        },
        take: 2000,
      }),
    ]);
    const ownIds = new Set(own.map((e) => e.id));
    return [
      ...own.map(({ _count, ...event }) => ({
        ...event,
        source: "OWN" as const,
        myResponse: null,
        organizerName: null,
        attendeeCount: _count.attendees,
      })),
      // An event in one's own calendar that also lists one as attendee shows once, as one's own.
      ...invited
        .filter((row) => !ownIds.has(row.event.id))
        .map(({ response, event: { _count, organizer, ...event } }) => ({
          ...event,
          source: "INVITED" as const,
          myResponse: response,
          organizerName: organizer.user.displayName?.trim() || organizer.user.email,
          attendeeCount: _count.attendees,
        })),
    ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime());
  }

  /**
   * An event the caller may edit — in their own calendar, or one shared with
   * them with edit access — with who is invited.
   */
  async getEvent(eventId: string, context: CalendarContext) {
    const located = await prisma.calendarEvent.findFirst({
      where: { id: eventId, tenantId: context.tenantId },
      select: { calendarId: true },
    });
    if (!located) throw notFound("Event");
    await requireAccess(located.calendarId, "EDIT", context).catch((error: AppError) => {
      // An event the caller cannot edit is, to them, not there.
      throw error.statusCode === 403 ? notFound("Event") : error;
    });
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, tenantId: context.tenantId },
      select: { ...eventSelect, sequence: true, attendees: { select: { email: true, displayName: true, response: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!event) throw notFound("Event");
    return event;
  }

  async createEvent(input: CreateEventInput, context: CalendarContext) {
    await this.ownCalendar(input.calendarId, context);
    assertTimeZone(input.timeZone);
    const span = normaliseSpan(input.startsAt, input.endsAt, input.allDay);
    const attendees = await resolveAttendees(input.attendees ?? [], context);
    const created = await prisma.$transaction(async (tx) => {
      const event = await tx.calendarEvent.create({
        data: {
          tenantId: context.tenantId,
          calendarId: input.calendarId,
          organizerMembershipId: context.membershipId,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          videoLink: input.videoLink ?? null,
          ...span,
          allDay: input.allDay,
          timeZone: input.timeZone,
          visibility: input.visibility,
          showAs: input.showAs,
        },
        select: eventSelect,
      });
      if (attendees.length) await syncAttendees(tx, context, event.id, attendees);
      return event;
    });
    await notifyMembers(context, attendees, {
      type: "ACTION_REQUIRED",
      category: "invitations",
      title: `Invitation: ${created.title}`,
      body: describeWhen(created),
      eventId: created.id,
    });
    return this.getEvent(created.id, context);
  }

  /**
   * Edit an event. A change to its time, place or title is an update its
   * attendees are told about; a change of time also asks everyone to answer
   * again, since a yes to Tuesday is not a yes to Thursday.
   */
  async updateEvent(eventId: string, input: UpdateEventInput, context: CalendarContext) {
    const current = await this.getEvent(eventId, context);
    if (input.calendarId && input.calendarId !== current.calendarId) {
      await this.ownCalendar(input.calendarId, context);
    }
    if (input.timeZone) assertTimeZone(input.timeZone);
    const allDay = input.allDay ?? current.allDay;
    const span = normaliseSpan(input.startsAt ?? current.startsAt, input.endsAt ?? current.endsAt, allDay);
    const wanted = input.attendees ? await resolveAttendees(input.attendees, context) : null;

    const timeChanged =
      span.startsAt.getTime() !== current.startsAt.getTime() ||
      span.endsAt.getTime() !== current.endsAt.getTime() ||
      allDay !== current.allDay;
    const changed: string[] = [];
    if (timeChanged) changed.push("time");
    if (input.title !== undefined && input.title !== current.title) changed.push("title");
    if (input.location !== undefined && (input.location ?? null) !== current.location) changed.push("location");
    if (input.videoLink !== undefined && (input.videoLink ?? null) !== current.videoLink) changed.push("video link");

    const { attendees: _attendees, ...fields } = input;
    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.calendarEvent.update({
        where: { id: eventId, tenantId: context.tenantId },
        data: { ...fields, ...span, allDay, ...(changed.length ? { sequence: { increment: 1 } } : {}) },
        select: eventSelect,
      });
      if (timeChanged) await resourceService.moveEventBookings(tx, context, eventId, span.startsAt, span.endsAt);
      const sync = wanted ? await syncAttendees(tx, context, eventId, wanted) : { added: [], removed: [] };
      if (changed.length) {
        if (timeChanged) {
          await tx.eventAttendee.updateMany({
            where: { eventId, tenantId: context.tenantId },
            data: { response: "NEEDS_ACTION", respondedAt: null, proposedStartsAt: null, proposedEndsAt: null },
          });
        }
        await recordActivity(tx, context, eventId, "UPDATED", { changed });
      }
      return { event, sync };
    });

    const addedEmails = new Set(result.sync.added.map((a) => a.email));
    if (result.sync.added.length) {
      await notifyMembers(context, result.sync.added, {
        type: "ACTION_REQUIRED",
        category: "invitations",
        title: `Invitation: ${result.event.title}`,
        body: describeWhen(result.event),
        eventId,
      });
    }
    if (changed.length) {
      const everyoneElse = await prisma.eventAttendee.findMany({
        where: { eventId, tenantId: context.tenantId, membershipId: { not: null } },
        select: { email: true, membership: { select: { userId: true } } },
      });
      await notifyMembers(
        context,
        everyoneElse.filter((a) => !addedEmails.has(a.email)).map((a) => ({ userId: a.membership?.userId ?? null })),
        {
          type: timeChanged ? "ACTION_REQUIRED" : "INFO",
          category: "updates",
          title: `Updated: ${result.event.title}`,
          body: `Changed ${changed.join(", ")}. ${describeWhen(result.event)}`,
          eventId,
        }
      );
    }
    return this.getEvent(eventId, context);
  }

  /** Delete an event. Its attendees are told it is cancelled. */
  async deleteEvent(eventId: string, context: CalendarContext) {
    const event = await this.getEvent(eventId, context);
    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, tenantId: context.tenantId, membershipId: { not: null } },
      select: { membership: { select: { userId: true } } },
    });
    await prisma.calendarEvent.delete({ where: { id: eventId, tenantId: context.tenantId } });
    if (event.endsAt > new Date()) {
      await notifyMembers(
        context,
        attendees.map((a) => ({ userId: a.membership?.userId ?? null })),
        { type: "INFO", category: "updates", title: `Cancelled: ${event.title}`, body: describeWhen(event), eventId }
      );
    }
  }

  /** A calendar the caller may add events to (own, or shared with edit or manage access). */
  private async ownCalendar(calendarId: string, context: CalendarContext) {
    const { calendar } = await requireAccess(calendarId, "EDIT", context);
    return calendar;
  }
}

export const calendarService = new CalendarService();
