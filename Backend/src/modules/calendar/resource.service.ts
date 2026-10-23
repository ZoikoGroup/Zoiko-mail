import type { Prisma, ResourceBookingStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { assertTimeZone, normaliseSpan } from "./calendar.span.js";
import { requireAccess } from "./calendar.access.js";
import { describeWhen, notifyMembers, resolveAttendees, syncAttendees } from "./invitation.service.js";
import type { CalendarContext } from "./calendar.service.js";
import type { BookResourceInput, ResourceBoardInput, ResourceInput, UpdateResourceInput } from "./calendar.schema.js";

/**
 * Rooms and equipment, and who has them when.
 *
 * Owners and Admins manage resources and approve bookings that need it; any
 * member books. A booking always belongs to an event (the meeting the room is
 * for) and follows its times. Two bookings of one resource never overlap:
 * each booking, move or approval takes a per-resource lock in its transaction
 * and checks for an overlap under it, so two people asking for the same slot
 * at the same moment cannot both get it.
 */

/** Bookings that hold a resource: confirmed, or waiting for approval. */
const LIVE: ResourceBookingStatus[] = ["CONFIRMED", "PENDING"];

const notFound = (what = "Resource") => new AppError(`${what} not found`, 404, ErrorCodes.NOT_FOUND);

function isManager(context: CalendarContext): boolean {
  return context.membershipRole === "OWNER" || context.membershipRole === "ADMIN";
}

function requireManager(context: CalendarContext): void {
  if (!isManager(context)) {
    throw new AppError("Only workspace Owners and Admins manage rooms and resources.", 403, ErrorCodes.FORBIDDEN, {
      reason: "RESOURCE_MANAGER",
    });
  }
}

function nameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName?.trim() || user.email;
}

const resourceSelect = {
  id: true,
  kind: true,
  name: true,
  description: true,
  capacity: true,
  location: true,
  floor: true,
  features: true,
  requiresApproval: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CalendarResourceSelect;

/** Serialise everything that changes one resource's bookings. */
async function lockResource(tx: Prisma.TransactionClient, resourceId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${resourceId}::text))::text AS locked`;
}

/** Refuse when another live booking of the resource overlaps [start, end). */
async function assertFree(
  tx: Prisma.TransactionClient,
  context: CalendarContext,
  resource: { id: string; name: string },
  start: Date,
  end: Date,
  exceptBookingId?: string
) {
  const clash = await tx.resourceBooking.findFirst({
    where: {
      tenantId: context.tenantId,
      resourceId: resource.id,
      status: { in: LIVE },
      startsAt: { lt: end },
      endsAt: { gt: start },
      ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
  if (clash) {
    throw new AppError(`${resource.name} is already booked at that time.`, 409, ErrorCodes.CONFLICT, {
      reason: "RESOURCE_UNAVAILABLE",
      resourceId: resource.id,
    });
  }
}

export class ResourceService {
  /** Resources members can book. Managers also see retired ones, to bring them back. */
  async list(context: CalendarContext) {
    return prisma.calendarResource.findMany({
      where: { tenantId: context.tenantId, ...(isManager(context) ? {} : { isActive: true }) },
      select: resourceSelect,
      orderBy: [{ isActive: "desc" }, { kind: "asc" }, { name: "asc" }],
    });
  }

  async create(input: ResourceInput, context: CalendarContext) {
    requireManager(context);
    return prisma.calendarResource.create({
      data: { tenantId: context.tenantId, ...input, features: input.features ?? [] },
      select: resourceSelect,
    });
  }

  async update(resourceId: string, input: UpdateResourceInput, context: CalendarContext) {
    requireManager(context);
    await this.find(resourceId, context);
    return prisma.calendarResource.update({
      where: { id: resourceId, tenantId: context.tenantId },
      data: input,
      select: resourceSelect,
    });
  }

  /**
   * Who has each resource in [from, to). Titles are shown, as on a room's
   * door sign; a private meeting shows only as Reserved.
   */
  async board(input: ResourceBoardInput, context: CalendarContext) {
    const [resources, bookings] = await Promise.all([
      prisma.calendarResource.findMany({
        where: { tenantId: context.tenantId, isActive: true },
        select: resourceSelect,
        orderBy: [{ kind: "asc" }, { name: "asc" }],
      }),
      prisma.resourceBooking.findMany({
        where: {
          tenantId: context.tenantId,
          status: { in: LIVE },
          startsAt: { lt: input.to },
          endsAt: { gt: input.from },
          resource: { isActive: true },
        },
        select: {
          id: true,
          resourceId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          bookedByMembershipId: true,
          bookedBy: { select: { user: { select: { email: true, displayName: true } } } },
          event: { select: { id: true, title: true, visibility: true, organizerMembershipId: true } },
        },
        orderBy: { startsAt: "asc" },
      }),
    ]);
    return {
      resources,
      bookings: bookings.map((b) => {
        const mine = b.bookedByMembershipId === context.membershipId || b.event.organizerMembershipId === context.membershipId;
        return {
          id: b.id,
          resourceId: b.resourceId,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          status: b.status,
          isMine: mine,
          title: b.event.visibility === "PRIVATE" && !mine ? "Reserved" : b.event.title,
          bookedBy: nameOf(b.bookedBy.user),
          eventId: mine ? b.event.id : null,
        };
      }),
    };
  }

  /**
   * Book a resource: a meeting in the caller's calendar (their main one, or
   * the one chosen) with the resource as its place, and the booking —
   * confirmed, or pending when the resource needs approval. The overlap check
   * and both writes are one transaction under the resource's lock.
   */
  async book(resourceId: string, input: BookResourceInput, context: CalendarContext) {
    const resource = await this.find(resourceId, context);
    if (!resource.isActive) {
      throw new AppError(`${resource.name} is no longer available to book.`, 409, ErrorCodes.CONFLICT, { reason: "RESOURCE_RETIRED" });
    }
    if (input.attendeeCount && resource.capacity && input.attendeeCount > resource.capacity) {
      throw new AppError(`${resource.name} seats ${resource.capacity}; this meeting is for ${input.attendeeCount}.`, 409, ErrorCodes.CONFLICT, {
        reason: "OVER_CAPACITY",
      });
    }
    assertTimeZone(input.timeZone);
    const span = normaliseSpan(input.startsAt, input.endsAt, false);
    if (span.startsAt.getTime() < Date.now() - 5 * 60_000) {
      throw new AppError("That time has already passed.", 400, ErrorCodes.VALIDATION_ERROR, [{ path: "startsAt", message: "In the past" }]);
    }
    const calendarId = input.calendarId ?? (await this.mainCalendarId(context));
    await requireAccess(calendarId, "EDIT", context);
    const attendees = await resolveAttendees(input.attendees ?? [], context);
    const status: ResourceBookingStatus = resource.requiresApproval ? "PENDING" : "CONFIRMED";
    const place = [resource.name, resource.location].filter(Boolean).join(" · ");

    const result = await prisma.$transaction(async (tx) => {
      await lockResource(tx, resource.id);
      await assertFree(tx, context, resource, span.startsAt, span.endsAt);
      const event = await tx.calendarEvent.create({
        data: {
          tenantId: context.tenantId,
          calendarId,
          organizerMembershipId: context.membershipId,
          title: input.title,
          description: input.note ?? null,
          location: place,
          ...span,
          timeZone: input.timeZone,
        },
        select: { id: true, title: true, startsAt: true, allDay: true, timeZone: true },
      });
      if (attendees.length) await syncAttendees(tx, context, event.id, attendees);
      const booking = await tx.resourceBooking.create({
        data: {
          tenantId: context.tenantId,
          resourceId: resource.id,
          eventId: event.id,
          bookedByMembershipId: context.membershipId,
          ...span,
          status,
          attendeeCount: input.attendeeCount ?? null,
          note: input.note ?? null,
        },
        select: { id: true },
      });
      return { event, booking };
    });

    if (attendees.length) {
      await notifyMembers(context, attendees, {
        type: "ACTION_REQUIRED",
        category: "invitations",
        title: `Invitation: ${result.event.title}`,
        body: `${describeWhen(result.event)} · ${place}`,
        eventId: result.event.id,
      });
    }
    if (status === "PENDING") await this.notifyManagers(context, resource.name, result.event);
    return { bookingId: result.booking.id, eventId: result.event.id, status };
  }

  /** Add a resource to an existing meeting the caller can edit. */
  async addToEvent(eventId: string, resourceId: string, context: CalendarContext) {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: eventId, tenantId: context.tenantId },
      select: { id: true, calendarId: true, title: true, startsAt: true, endsAt: true, allDay: true, timeZone: true, location: true },
    });
    if (!event) throw notFound("Event");
    await requireAccess(event.calendarId, "EDIT", context);
    const resource = await this.find(resourceId, context);
    if (!resource.isActive) throw new AppError(`${resource.name} is no longer available to book.`, 409, ErrorCodes.CONFLICT, { reason: "RESOURCE_RETIRED" });
    const status: ResourceBookingStatus = resource.requiresApproval ? "PENDING" : "CONFIRMED";
    await prisma.$transaction(async (tx) => {
      await lockResource(tx, resource.id);
      await assertFree(tx, context, resource, event.startsAt, event.endsAt);
      await tx.resourceBooking.create({
        data: {
          tenantId: context.tenantId,
          resourceId: resource.id,
          eventId,
          bookedByMembershipId: context.membershipId,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          status,
        },
      });
      if (!event.location) {
        await tx.calendarEvent.update({
          where: { id: eventId, tenantId: context.tenantId },
          data: { location: [resource.name, resource.location].filter(Boolean).join(" · ") },
        });
      }
    });
    if (status === "PENDING") await this.notifyManagers(context, resource.name, event);
    return { eventId, resourceId, status };
  }

  /**
   * Keep an event's bookings on its new times, inside the caller's update
   * transaction. Refused (and the whole update with it) when a resource is
   * taken at the new time.
   */
  async moveEventBookings(tx: Prisma.TransactionClient, context: CalendarContext, eventId: string, startsAt: Date, endsAt: Date) {
    const bookings = await tx.resourceBooking.findMany({
      where: { tenantId: context.tenantId, eventId, status: { in: LIVE } },
      select: { id: true, resource: { select: { id: true, name: true } } },
    });
    for (const booking of bookings) {
      await lockResource(tx, booking.resource.id);
      await assertFree(tx, context, booking.resource, startsAt, endsAt, booking.id);
      await tx.resourceBooking.update({ where: { id: booking.id, tenantId: context.tenantId }, data: { startsAt, endsAt } });
    }
  }

  /** The caller's bookings, upcoming and recent. */
  async mine(context: CalendarContext) {
    const since = new Date(Date.now() - 86_400_000);
    const bookings = await prisma.resourceBooking.findMany({
      where: { tenantId: context.tenantId, bookedByMembershipId: context.membershipId, endsAt: { gt: since } },
      select: this.bookingSelect(),
      orderBy: { startsAt: "asc" },
      take: 200,
    });
    return bookings.map((b) => this.bookingView(b, context));
  }

  /** Bookings waiting for a decision. Owners and Admins only. */
  async pending(context: CalendarContext) {
    requireManager(context);
    const bookings = await prisma.resourceBooking.findMany({
      where: { tenantId: context.tenantId, status: "PENDING", endsAt: { gt: new Date() } },
      select: this.bookingSelect(),
      orderBy: { startsAt: "asc" },
      take: 200,
    });
    return bookings.map((b) => this.bookingView(b, context));
  }

  /** Approve or decline a pending booking. Owners and Admins only. */
  async decide(bookingId: string, approve: boolean, context: CalendarContext) {
    requireManager(context);
    const booking = await prisma.resourceBooking.findFirst({
      where: { id: bookingId, tenantId: context.tenantId },
      select: { id: true, status: true, resource: { select: { name: true } }, event: { select: { id: true, title: true, startsAt: true, allDay: true, timeZone: true } }, bookedBy: { select: { userId: true } } },
    });
    if (!booking) throw notFound("Booking");
    const decided = await prisma.resourceBooking.updateMany({
      where: { id: bookingId, tenantId: context.tenantId, status: "PENDING" },
      data: { status: approve ? "CONFIRMED" : "DECLINED", decidedByMembershipId: context.membershipId, decidedAt: new Date() },
    });
    if (decided.count === 0) {
      throw new AppError("This booking was already decided.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_DECIDED" });
    }
    await notifyMembers(context, [{ userId: booking.bookedBy.userId }], {
      category: "bookings",
      title: `${booking.resource.name} ${approve ? "confirmed" : "declined"} for “${booking.event.title}”`,
      body: describeWhen(booking.event),
      eventId: booking.event.id,
      linkPath: "/mail/calendar/rooms?view=mine",
    });
    return this.pending(context);
  }

  /** Give a booking back. The person who booked it, or an Owner or Admin. */
  async cancel(bookingId: string, context: CalendarContext) {
    const booking = await prisma.resourceBooking.findFirst({
      where: { id: bookingId, tenantId: context.tenantId },
      select: { id: true, bookedByMembershipId: true, status: true },
    });
    if (!booking || (booking.bookedByMembershipId !== context.membershipId && !isManager(context))) throw notFound("Booking");
    if (!LIVE.includes(booking.status)) {
      throw new AppError("This booking is not active.", 409, ErrorCodes.CONFLICT, { reason: "NOT_ACTIVE" });
    }
    await prisma.resourceBooking.update({ where: { id: bookingId, tenantId: context.tenantId }, data: { status: "CANCELLED" } });
  }

  private bookingSelect() {
    return {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      attendeeCount: true,
      note: true,
      createdAt: true,
      bookedByMembershipId: true,
      resource: { select: { id: true, name: true, kind: true, location: true, floor: true, capacity: true } },
      event: { select: { id: true, title: true } },
      bookedBy: { select: { user: { select: { email: true, displayName: true } } } },
    } satisfies Prisma.ResourceBookingSelect;
  }

  private bookingView(
    b: Prisma.ResourceBookingGetPayload<{ select: ReturnType<ResourceService["bookingSelect"]> }>,
    context: CalendarContext
  ) {
    return {
      id: b.id,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      status: b.status,
      attendeeCount: b.attendeeCount,
      note: b.note,
      createdAt: b.createdAt,
      resource: b.resource,
      event: b.event,
      bookedBy: { name: nameOf(b.bookedBy.user), email: b.bookedBy.user.email },
      isMine: b.bookedByMembershipId === context.membershipId,
    };
  }

  private async find(resourceId: string, context: CalendarContext) {
    const resource = await prisma.calendarResource.findFirst({
      where: { id: resourceId, tenantId: context.tenantId },
      select: { id: true, name: true, location: true, capacity: true, requiresApproval: true, isActive: true },
    });
    if (!resource) throw notFound();
    return resource;
  }

  private async mainCalendarId(context: CalendarContext): Promise<string> {
    const main = await prisma.calendar.findFirst({
      where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId, isDefault: true },
      select: { id: true },
    });
    if (main) return main.id;
    // First use: the main calendar is created by listing calendars.
    const { calendarService } = await import("./calendar.service.js");
    const list = await calendarService.listCalendars(context);
    return list[0]!.id;
  }

  private async notifyManagers(context: CalendarContext, resourceName: string, event: { id: string; title: string; startsAt: Date; allDay: boolean; timeZone: string }) {
    const managers = await prisma.tenantMembership.findMany({
      where: { tenantId: context.tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    });
    await notifyMembers(context, managers, {
      type: "ACTION_REQUIRED",
      category: "bookings",
      title: `Approval needed: ${resourceName}`,
      body: `“${event.title}” · ${describeWhen(event)}`,
      eventId: event.id,
      linkPath: "/mail/calendar/rooms?view=pending",
    });
  }
}

export const resourceService = new ResourceService();
