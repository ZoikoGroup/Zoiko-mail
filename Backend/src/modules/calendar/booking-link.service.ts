import { randomBytes } from "node:crypto";
import { Prisma, type BookingLink, type GuestBookingStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withCrossTenant, withTenant } from "../../config/tenantScope.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { assertTimeZone } from "./calendar.span.js";
import { accessTo, atLeast } from "./calendar.access.js";
import { describeWhen, notifyMembers, resolveAttendees, syncAttendees } from "./invitation.service.js";
import { sharingService } from "./sharing.service.js";
import { datesBetween, isoWeekday, parseHm, zonedInstant } from "./calendar.zone.js";
import type { CalendarContext } from "./calendar.service.js";
import type { BookingLinkInput, GuestBookInput, UpdateBookingLinkInput } from "./calendar.schema.js";

/**
 * Scheduling links: a public page where people pick a time with the link's
 * owner, from the times its rules allow and the owner's calendar leaves free.
 *
 * Guests are not signed in. The page shows only free times — never what fills
 * the rest — and booking re-checks the slot under a per-host lock, so two
 * guests cannot take the same time. A link that needs approval holds the slot
 * as a request until its owner confirms it.
 */

const LIVE: GuestBookingStatus[] = ["PENDING", "CONFIRMED"];
const MAX_SLOTS = 500;

const notFound = (what = "Booking link") => new AppError(`${what} not found`, 404, ErrorCodes.NOT_FOUND);

function nameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName?.trim() || user.email;
}

/** A readable, unguessable address: "30-minute-introduction-k3x9p2qa". */
function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return `${base || "meet"}-${suffix || randomBytes(4).toString("hex")}`;
}

async function lockHost(tx: Prisma.TransactionClient, membershipId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking-host:${membershipId}`}::text))::text AS locked`;
}

const linkInclude = {
  owner: { select: { id: true, userId: true, user: { select: { email: true, displayName: true } } } },
  calendar: { select: { id: true, name: true, kind: true } },
  _count: { select: { bookings: { where: { status: "PENDING" as GuestBookingStatus } } } },
} satisfies Prisma.BookingLinkInclude;

type LinkRow = Prisma.BookingLinkGetPayload<{ include: typeof linkInclude }>;

function linkView(link: LinkRow, context: CalendarContext) {
  const { owner, calendar, _count, tenantId: _tenant, ownerMembershipId, ...fields } = link;
  return {
    ...fields,
    kind: calendar.kind === "TEAM" ? ("TEAM" as const) : ("PERSONAL" as const),
    calendarName: calendar.name,
    owner: { name: nameOf(owner.user), email: owner.user.email },
    isMine: ownerMembershipId === context.membershipId,
    pendingCount: _count.bookings,
  };
}

/** The host as a calendar context: what their calendar and notifications act as. */
function hostContext(link: { tenantId: string; ownerMembershipId: string }, ownerUserId: string): CalendarContext {
  return { tenantId: link.tenantId, membershipId: link.ownerMembershipId, userId: ownerUserId };
}

/**
 * Free start times for a link between from and to: in its weekly hours (in
 * its zone), after the minimum notice, within how far ahead it allows, and
 * clear of the owner's busy time (and its own pending requests) with the
 * buffer on both sides.
 */
async function computeSlots(link: BookingLink, from: Date, to: Date, host: CalendarContext) {
  const now = Date.now();
  const earliest = new Date(Math.max(from.getTime(), now + link.minNoticeHours * 3_600_000));
  const latest = new Date(Math.min(to.getTime(), now + link.maxDaysAhead * 86_400_000));
  if (earliest >= latest) return [];

  const lengthMs = link.durationMinutes * 60_000;
  const bufferMs = link.bufferMinutes * 60_000;
  const stepMs = (link.durationMinutes % 30 === 0 ? 30 : 15) * 60_000;
  const windowFrom = new Date(earliest.getTime() - bufferMs - 86_400_000);
  const windowTo = new Date(latest.getTime() + bufferMs + 86_400_000);

  const [people, pending, teamEvents] = await Promise.all([
    sharingService.freeBusy({ emails: [], from: windowFrom, to: windowTo, includeMe: true }, host),
    // Requests waiting for approval hold their time too (they have no event yet).
    prisma.guestBooking.findMany({
      where: {
        tenantId: link.tenantId,
        status: "PENDING",
        link: { ownerMembershipId: link.ownerMembershipId },
        startsAt: { lt: windowTo },
        endsAt: { gt: windowFrom },
      },
      select: { startsAt: true, endsAt: true },
    }),
    // A link that books into a team calendar respects that calendar's meetings as well.
    prisma.calendarEvent.findMany({
      where: {
        tenantId: link.tenantId,
        calendarId: link.calendarId,
        calendar: { kind: "TEAM" },
        showAs: "BUSY",
        startsAt: { lt: windowTo },
        endsAt: { gt: windowFrom },
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  const busy = [
    ...(people.find((p) => p.isMe)?.busy ?? []).map((b) => ({ start: b.start.getTime(), end: b.end.getTime() })),
    ...pending.map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
    ...teamEvents.map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() })),
  ];

  const [startH, startM] = parseHm(link.dayStart);
  const [endH, endM] = parseHm(link.dayEnd);
  const slots: Array<{ start: Date; end: Date }> = [];
  for (const date of datesBetween(earliest, latest, link.timeZone)) {
    if (!link.weekdays.includes(isoWeekday(date.year, date.month, date.day))) continue;
    const open = zonedInstant(date.year, date.month, date.day, startH, startM, link.timeZone).getTime();
    const close = zonedInstant(date.year, date.month, date.day, endH, endM, link.timeZone).getTime();
    for (let t = open; t + lengthMs <= close; t += stepMs) {
      if (t < earliest.getTime() || t + lengthMs > latest.getTime()) continue;
      const s = t - bufferMs;
      const e = t + lengthMs + bufferMs;
      if (busy.some((b) => b.start < e && b.end > s)) continue;
      slots.push({ start: new Date(t), end: new Date(t + lengthMs) });
      if (slots.length >= MAX_SLOTS) return slots;
    }
  }
  return slots;
}

export class BookingLinkService {
  /**
   * My links, and links that book into team calendars I belong to (team
   * links), each with how many requests wait.
   */
  async list(context: CalendarContext) {
    const accessible = await sharingService.accessibleCalendars(context);
    const teamCalendarIds = accessible.filter((c) => c.kind === "TEAM").map((c) => c.id);
    const links = await prisma.bookingLink.findMany({
      where: {
        tenantId: context.tenantId,
        OR: [{ ownerMembershipId: context.membershipId }, { calendarId: { in: teamCalendarIds } }],
      },
      include: linkInclude,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });
    return links.map((l) => linkView(l, context));
  }

  async create(input: BookingLinkInput, context: CalendarContext) {
    assertTimeZone(input.timeZone);
    const calendarId = input.calendarId ?? (await this.mainCalendarId(context));
    await this.assertWritable(calendarId, context);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const link = await prisma.bookingLink.create({
          data: { tenantId: context.tenantId, ownerMembershipId: context.membershipId, ...input, calendarId, slug: makeSlug(input.title) },
          include: linkInclude,
        });
        return linkView(link, context);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
    throw new AppError("Could not create a unique address for the link. Try again.", 409, ErrorCodes.CONFLICT);
  }

  async update(linkId: string, input: UpdateBookingLinkInput, context: CalendarContext) {
    const link = await this.ownLink(linkId, context);
    if (input.timeZone) assertTimeZone(input.timeZone);
    if (input.calendarId && input.calendarId !== link.calendarId) await this.assertWritable(input.calendarId, context);
    const start = input.dayStart ?? link.dayStart;
    const end = input.dayEnd ?? link.dayEnd;
    if (start >= end) {
      throw new AppError("The day must end after it starts.", 400, ErrorCodes.VALIDATION_ERROR, [{ path: "dayEnd", message: "Must be after dayStart" }]);
    }
    const updated = await prisma.bookingLink.update({ where: { id: linkId, tenantId: context.tenantId }, data: input, include: linkInclude });
    return linkView(updated, context);
  }

  async remove(linkId: string, context: CalendarContext) {
    await this.ownLink(linkId, context);
    await prisma.bookingLink.delete({ where: { id: linkId, tenantId: context.tenantId } });
  }

  /** The free times a link offers, for its owner's preview (drafts included). */
  async previewSlots(linkId: string, from: Date, to: Date, context: CalendarContext) {
    const link = await this.ownLink(linkId, context);
    return computeSlots(link, from, to, context);
  }

  /** Bookings through the caller's links: waiting ones first, then upcoming. */
  async requests(context: CalendarContext) {
    const bookings = await prisma.guestBooking.findMany({
      where: {
        tenantId: context.tenantId,
        link: { ownerMembershipId: context.membershipId },
        endsAt: { gt: new Date(Date.now() - 86_400_000) },
      },
      include: { link: { select: { id: true, title: true, durationMinutes: true } } },
      orderBy: [{ startsAt: "asc" }],
      take: 300,
    });
    return bookings.map((b) => ({
      id: b.id,
      guestName: b.guestName,
      guestEmail: b.guestEmail,
      notes: b.notes,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      timeZone: b.timeZone,
      status: b.status,
      eventId: b.eventId,
      createdAt: b.createdAt,
      link: b.link,
    }));
  }

  /** Confirm (the meeting goes in the calendar) or decline a request. The link's owner only. */
  async decide(bookingId: string, approve: boolean, context: CalendarContext) {
    const booking = await prisma.guestBooking.findFirst({
      where: { id: bookingId, tenantId: context.tenantId, link: { ownerMembershipId: context.membershipId } },
      include: { link: true },
    });
    if (!booking) throw notFound("Booking");
    if (booking.status !== "PENDING") {
      throw new AppError("This booking was already decided.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_DECIDED" });
    }
    if (!approve) {
      await prisma.guestBooking.update({ where: { id: booking.id, tenantId: context.tenantId }, data: { status: "DECLINED", decidedAt: new Date() } });
      return this.requests(context);
    }
    await prisma.$transaction(async (tx) => {
      await lockHost(tx, booking.link.ownerMembershipId);
      const eventId = await this.createMeeting(tx, booking.link, booking, context);
      await tx.guestBooking.update({
        where: { id: booking.id, tenantId: context.tenantId },
        data: { status: "CONFIRMED", decidedAt: new Date(), eventId },
      });
    });
    return this.requests(context);
  }

  /** Cancel a booking through one of the caller's links; its meeting is removed. */
  async cancel(bookingId: string, context: CalendarContext) {
    const booking = await prisma.guestBooking.findFirst({
      where: { id: bookingId, tenantId: context.tenantId, link: { ownerMembershipId: context.membershipId } },
      select: { id: true, status: true, eventId: true },
    });
    if (!booking) throw notFound("Booking");
    if (!LIVE.includes(booking.status)) throw new AppError("This booking is not active.", 409, ErrorCodes.CONFLICT, { reason: "NOT_ACTIVE" });
    await prisma.$transaction(async (tx) => {
      await tx.guestBooking.update({ where: { id: booking.id, tenantId: context.tenantId }, data: { status: "CANCELLED", eventId: null } });
      if (booking.eventId) await tx.calendarEvent.deleteMany({ where: { id: booking.eventId, tenantId: context.tenantId } });
    });
  }

  // ── The public booking page ───────────────────────────────────────────────

  /** A published link as a guest sees it, and its free times in [from, to). */
  async publicView(slug: string, from: Date, to: Date) {
    const link = await this.publishedLink(slug);
    return withTenant(link.tenantId, async () => {
      const slots = await computeSlots(link, from, to, hostContext(link, link.owner.userId));
      return {
        slug: link.slug,
        title: link.title,
        description: link.description,
        durationMinutes: link.durationMinutes,
        timeZone: link.timeZone,
        locationType: link.locationType,
        requiresApproval: link.requiresApproval,
        maxDaysAhead: link.maxDaysAhead,
        host: { name: nameOf(link.owner.user) },
        workspace: { name: link.tenant.name },
        slots,
      };
    });
  }

  /**
   * A guest books a time. The time must be one the link offers right now:
   * it is recomputed under the host's lock, so a slot taken a moment ago — by
   * another guest or a new meeting — is refused rather than double-booked.
   */
  async publicBook(slug: string, input: GuestBookInput) {
    const link = await this.publishedLink(slug);
    return withTenant(link.tenantId, async () => {
      const host = hostContext(link, link.owner.userId);
      // Notifications are from the guest, so the host is told.
      const asGuest: CalendarContext = { ...host, userId: "" };
      const start = input.startsAt;
      const end = new Date(start.getTime() + link.durationMinutes * 60_000);
      const status: GuestBookingStatus = link.requiresApproval ? "PENDING" : "CONFIRMED";

      const booking = await prisma.$transaction(async (tx) => {
        await lockHost(tx, link.ownerMembershipId);
        const dayFrom = new Date(start.getTime() - 60_000);
        const dayTo = new Date(end.getTime() + 60_000);
        const offered = await computeSlots(link, dayFrom, dayTo, host);
        if (!offered.some((s) => s.start.getTime() === start.getTime())) {
          throw new AppError("That time is no longer available. Please choose another.", 409, ErrorCodes.CONFLICT, {
            reason: "SLOT_UNAVAILABLE",
          });
        }
        const created = await tx.guestBooking.create({
          data: {
            tenantId: link.tenantId,
            linkId: link.id,
            guestName: input.name,
            guestEmail: input.email,
            notes: input.notes ?? null,
            startsAt: start,
            endsAt: end,
            timeZone: input.timeZone,
            status,
          },
        });
        if (status === "CONFIRMED") {
          const eventId = await this.createMeeting(tx, link, created, host);
          await tx.guestBooking.update({ where: { id: created.id }, data: { eventId } });
        }
        return created;
      });

      await notifyMembers(asGuest, [{ userId: link.owner.userId }], {
        type: status === "PENDING" ? "ACTION_REQUIRED" : "INFO",
        category: "bookings",
        title: status === "PENDING" ? `Booking request: ${input.name} · ${link.title}` : `New booking: ${input.name} · ${link.title}`,
        body: describeWhen({ startsAt: start, allDay: false, timeZone: link.timeZone }),
        eventId: "",
        linkPath: "/mail/calendar/scheduling?tab=requests",
      });
      return {
        id: booking.id,
        status,
        startsAt: start,
        endsAt: end,
        title: link.title,
        host: { name: nameOf(link.owner.user) },
      };
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** The meeting for a booking: in the link's calendar, organised by its owner, the guest invited. */
  private async createMeeting(
    tx: Prisma.TransactionClient,
    link: BookingLink,
    booking: { guestName: string; guestEmail: string; notes: string | null; startsAt: Date; endsAt: Date },
    host: CalendarContext
  ): Promise<string> {
    const clash = await tx.calendarEvent.findFirst({
      where: {
        tenantId: link.tenantId,
        showAs: "BUSY",
        startsAt: { lt: booking.endsAt },
        endsAt: { gt: booking.startsAt },
        OR: [
          { calendar: { ownerMembershipId: link.ownerMembershipId, kind: "PERSONAL" } },
          { attendees: { some: { membershipId: link.ownerMembershipId, response: { in: ["ACCEPTED", "TENTATIVE"] } } } },
        ],
      },
      select: { id: true },
    });
    if (clash) {
      throw new AppError("That time is no longer free in the calendar.", 409, ErrorCodes.CONFLICT, { reason: "SLOT_UNAVAILABLE" });
    }
    const video = link.locationType === "VIDEO" && link.locationDetail && /^https?:\/\//i.test(link.locationDetail) ? link.locationDetail : null;
    const event = await tx.calendarEvent.create({
      data: {
        tenantId: link.tenantId,
        calendarId: link.calendarId,
        organizerMembershipId: link.ownerMembershipId,
        title: `${link.title} with ${booking.guestName}`,
        description: booking.notes,
        location: link.locationType === "IN_PERSON" ? link.locationDetail : link.locationType === "PHONE" ? `Phone${link.locationDetail ? `: ${link.locationDetail}` : ""}` : "Video meeting",
        videoLink: video,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        timeZone: link.timeZone,
      },
      select: { id: true },
    });
    const [guest] = await resolveAttendees([booking.guestEmail], host);
    if (guest) await syncAttendees(tx, host, event.id, [{ ...guest, displayName: guest.displayName ?? booking.guestName }]);
    return event.id;
  }

  private async publishedLink(slug: string) {
    const link = await withCrossTenant(() =>
      prisma.bookingLink.findFirst({
        where: { slug, status: "PUBLISHED", owner: { status: "ACTIVE" } },
        include: {
          owner: { select: { userId: true, user: { select: { email: true, displayName: true } } } },
          tenant: { select: { name: true, status: true } },
        },
      })
    );
    if (!link || link.tenant.status !== "ACTIVE") throw notFound();
    return link;
  }

  private async ownLink(linkId: string, context: CalendarContext) {
    const link = await prisma.bookingLink.findFirst({ where: { id: linkId, tenantId: context.tenantId, ownerMembershipId: context.membershipId } });
    if (!link) throw notFound();
    return link;
  }

  private async assertWritable(calendarId: string, context: CalendarContext) {
    const found = await accessTo(calendarId, context);
    if (!found || !atLeast(found.access, "EDIT")) throw notFound("Calendar");
  }

  private async mainCalendarId(context: CalendarContext): Promise<string> {
    const { calendarService } = await import("./calendar.service.js");
    const list = await calendarService.listCalendars(context);
    return (list.find((c) => c.isDefault) ?? list[0])!.id;
  }
}

export const bookingLinkService = new BookingLinkService();
