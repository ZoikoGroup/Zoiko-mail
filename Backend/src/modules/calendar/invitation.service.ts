import type { CalendarActivityType, EventResponse, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { sseManager } from "../../common/sse/sse.manager.js";
import { normaliseSpan } from "./calendar.span.js";
import type { CalendarContext } from "./calendar.service.js";
import type { InvitationTab, ProposeTimeInput, RespondInput } from "./calendar.schema.js";
import { preferenceService, type NotifyCategory } from "./preference.service.js";

/**
 * Invitations: who is asked to an event, how they answer, and what happened.
 *
 * An attendee who is a member of the workspace answers here and sees the
 * event on their own calendar; anyone else is a guest, listed by address.
 * Only the organizer edits an event. Attendees respond, propose another
 * time, and see what changed since they last looked.
 */

/** Most people one event may invite. */
export const MAX_ATTENDEES = 100;
/** How far back "All invitations" and "Sent by me" look. */
const HISTORY_DAYS = 90;

export interface ResolvedAttendee {
  email: string;
  membershipId: string | null;
  userId: string | null;
  displayName: string | null;
}

/** The fields whose change counts as an update attendees should hear about. */
export const SIGNIFICANT_FIELDS = ["title", "startsAt", "endsAt", "allDay", "location", "videoLink"] as const;

const notFound = () => new AppError("Event not found", 404, ErrorCodes.NOT_FOUND);

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Display name for a membership's user, falling back to the address. */
function nameOf(user: { displayName: string | null; email: string } | null | undefined): string | null {
  if (!user) return null;
  return user.displayName?.trim() || user.email;
}

/**
 * Turn typed addresses into attendees. An address that belongs to an active
 * member of this workspace — their sign-in address or their mailbox — is that
 * member; anything else is a guest. The organizer is never their own attendee.
 */
export async function resolveAttendees(emails: string[], context: CalendarContext): Promise<ResolvedAttendee[]> {
  const wanted = [...new Set(emails.map(normaliseEmail).filter(Boolean))];
  if (wanted.length > MAX_ATTENDEES) {
    throw new AppError(`Invite at most ${MAX_ATTENDEES} people to one event.`, 400, ErrorCodes.VALIDATION_ERROR, [
      { path: "attendees", message: `At most ${MAX_ATTENDEES}` },
    ]);
  }
  if (wanted.length === 0) return [];

  const members = await prisma.tenantMembership.findMany({
    where: {
      tenantId: context.tenantId,
      status: "ACTIVE",
      OR: [
        { user: { email: { in: wanted, mode: "insensitive" } } },
        { mailbox: { address: { in: wanted, mode: "insensitive" } } },
      ],
    },
    select: { id: true, userId: true, user: { select: { email: true, displayName: true } }, mailbox: { select: { address: true } } },
  });
  const byEmail = new Map<string, (typeof members)[number]>();
  for (const m of members) {
    byEmail.set(m.user.email.toLowerCase(), m);
    if (m.mailbox?.address) byEmail.set(m.mailbox.address.toLowerCase(), m);
  }

  const seen = new Set<string>();
  const result: ResolvedAttendee[] = [];
  for (const email of wanted) {
    const member = byEmail.get(email);
    if (member?.id === context.membershipId) continue; // the organizer
    const key = member ? `m:${member.id}` : `e:${email}`;
    if (seen.has(key)) continue; // two addresses of the same person
    seen.add(key);
    result.push({
      email,
      membershipId: member?.id ?? null,
      userId: member?.userId ?? null,
      displayName: member ? nameOf(member.user) : null,
    });
  }
  return result;
}

export async function recordActivity(
  tx: Prisma.TransactionClient,
  context: CalendarContext,
  eventId: string,
  type: CalendarActivityType,
  detail: Prisma.InputJsonValue = {}
) {
  await tx.calendarEventActivity.create({
    data: { tenantId: context.tenantId, eventId, actorMembershipId: context.membershipId, type, detail },
  });
}

/**
 * Make the event's attendee list match `wanted`: add the new ones, remove the
 * ones no longer listed, leave everyone else's answer alone. Returns who was
 * added, for notifying.
 */
export async function syncAttendees(
  tx: Prisma.TransactionClient,
  context: CalendarContext,
  eventId: string,
  wanted: ResolvedAttendee[]
): Promise<{ added: ResolvedAttendee[]; removed: string[] }> {
  const current = await tx.eventAttendee.findMany({ where: { eventId, tenantId: context.tenantId }, select: { id: true, email: true } });
  const wantedEmails = new Set(wanted.map((a) => a.email));
  const currentEmails = new Set(current.map((a) => a.email));
  const added = wanted.filter((a) => !currentEmails.has(a.email));
  const removed = current.filter((a) => !wantedEmails.has(a.email));

  if (removed.length) {
    await tx.eventAttendee.deleteMany({ where: { id: { in: removed.map((a) => a.id) }, tenantId: context.tenantId } });
    await recordActivity(tx, context, eventId, "REMOVED", { emails: removed.map((a) => a.email) });
  }
  if (added.length) {
    await tx.eventAttendee.createMany({
      data: added.map((a) => ({
        tenantId: context.tenantId,
        eventId,
        membershipId: a.membershipId,
        email: a.email,
        displayName: a.displayName,
      })),
    });
    await recordActivity(tx, context, eventId, "INVITED", { emails: added.map((a) => a.email) });
  }
  return { added, removed: removed.map((a) => a.email) };
}

/**
 * Tell members about something that happened to an event: a notification in
 * their bell (kept), and a live nudge so an open calendar refreshes. Sent
 * after the change is committed; a failure here is logged, never undoes it.
 */
export async function notifyMembers(
  context: CalendarContext,
  recipients: Array<{ userId: string | null }>,
  message: {
    type?: NotificationType;
    /** Which notification setting governs it; people who turned it off are skipped. */
    category: NotifyCategory;
    title: string;
    body: string;
    eventId: string;
    /** Where the notification leads, when not to the event. */
    linkPath?: string;
  }
): Promise<void> {
  const wanted = [...new Set(recipients.map((r) => r.userId).filter((id): id is string => Boolean(id) && id !== context.userId))];
  if (wanted.length === 0) return;
  let muted = new Set<string>();
  try {
    muted = await preferenceService.mutedUsers(context.tenantId, wanted, message.category);
  } catch (error) {
    logger.warn({ err: error }, "Could not read calendar notification preferences");
  }
  const userIds = wanted.filter((id) => !muted.has(id));
  if (userIds.length === 0) return;
  const linkPath = message.linkPath ?? `/mail/calendar/invitations?event=${message.eventId}`;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        tenantId: context.tenantId,
        userId,
        type: message.type ?? "INFO",
        title: message.title,
        body: message.body,
        linkPath,
      })),
    });
    for (const userId of userIds) {
      sseManager.sendToUser(userId, {
        type: "NOTIFICATION",
        tenantId: context.tenantId,
        userId,
        payload: { title: message.title, body: message.body, kind: "calendar", eventId: message.eventId },
      });
    }
  } catch (error) {
    logger.warn({ err: error, eventId: message.eventId }, "Could not notify calendar attendees");
  }
}

const whenFormat = (date: Date, allDay: boolean, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: allDay ? "UTC" : timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(allDay ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

export function describeWhen(event: { startsAt: Date; allDay: boolean; timeZone: string }): string {
  return whenFormat(event.startsAt, event.allDay, event.timeZone);
}

/** What the attendee list, history and organizer look like to the client. */
const detailInclude = {
  organizer: { select: { id: true, user: { select: { email: true, displayName: true } } } },
  calendar: { select: { name: true, color: true, ownerMembershipId: true } },
  attendees: {
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
    select: {
      id: true,
      membershipId: true,
      email: true,
      displayName: true,
      response: true,
      respondedAt: true,
      comment: true,
      proposedStartsAt: true,
      proposedEndsAt: true,
      seenSequence: true,
      createdAt: true,
    },
  },
  activities: {
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, type: true, detail: true, createdAt: true, actor: { select: { user: { select: { email: true, displayName: true } } } } },
  },
} satisfies Prisma.CalendarEventInclude;

export class InvitationService {
  /**
   * An event as the organizer or an attendee sees it, with everyone's answers
   * and its history. Anyone else — a colleague not invited, another
   * workspace — gets 404.
   */
  async detail(eventId: string, context: CalendarContext) {
    const event = await prisma.calendarEvent.findFirst({
      where: {
        id: eventId,
        tenantId: context.tenantId,
        OR: [
          { organizerMembershipId: context.membershipId },
          { calendar: { ownerMembershipId: context.membershipId } },
          { attendees: { some: { membershipId: context.membershipId } } },
        ],
      },
      include: detailInclude,
    });
    if (!event) throw notFound();
    const isOrganizer = event.organizerMembershipId === context.membershipId || event.calendar.ownerMembershipId === context.membershipId;
    const mine = event.attendees.find((a) => a.membershipId === context.membershipId) ?? null;
    const counts = { accepted: 0, tentative: 0, declined: 0, needsAction: 0 };
    for (const a of event.attendees) {
      if (a.response === "ACCEPTED") counts.accepted++;
      else if (a.response === "TENTATIVE") counts.tentative++;
      else if (a.response === "DECLINED") counts.declined++;
      else counts.needsAction++;
    }
    return {
      id: event.id,
      calendarId: isOrganizer ? event.calendarId : null,
      calendarName: isOrganizer ? event.calendar.name : null,
      calendarColor: isOrganizer ? event.calendar.color : null,
      title: event.title,
      description: event.description,
      location: event.location,
      videoLink: event.videoLink,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      timeZone: event.timeZone,
      visibility: event.visibility,
      showAs: event.showAs,
      sequence: event.sequence,
      isOrganizer,
      organizer: {
        membershipId: event.organizer.id,
        name: nameOf(event.organizer.user),
        email: event.organizer.user.email,
      },
      myResponse: mine?.response ?? null,
      myComment: mine?.comment ?? null,
      receivedAt: mine?.createdAt ?? null,
      hasUpdate: mine ? mine.seenSequence !== null && mine.seenSequence < event.sequence : false,
      isNew: mine ? mine.seenSequence === null : false,
      counts,
      attendees: event.attendees.map((a) => ({
        id: a.id,
        email: a.email,
        name: a.displayName ?? a.email,
        isMember: a.membershipId !== null,
        isMe: a.membershipId === context.membershipId,
        response: a.response,
        respondedAt: a.respondedAt,
        comment: a.comment,
        proposedStartsAt: a.proposedStartsAt,
        proposedEndsAt: a.proposedEndsAt,
      })),
      history: event.activities.map((h) => ({
        id: h.id,
        type: h.type,
        detail: h.detail,
        actorName: nameOf(h.actor?.user) ?? "Someone",
        createdAt: h.createdAt,
      })),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  /** The attendee has opened the invitation: it is no longer New, and its changes are seen. */
  async markSeen(eventId: string, context: CalendarContext) {
    const attendee = await this.myAttendance(eventId, context);
    await prisma.eventAttendee.update({
      where: { id: attendee.id, tenantId: context.tenantId },
      data: { seenSequence: attendee.event.sequence },
    });
  }

  /** Accept, tentatively accept, or decline. */
  async respond(eventId: string, input: RespondInput, context: CalendarContext) {
    const attendee = await this.myAttendance(eventId, context);
    await prisma.$transaction(async (tx) => {
      await tx.eventAttendee.update({
        where: { id: attendee.id, tenantId: context.tenantId },
        data: {
          response: input.response,
          respondedAt: new Date(),
          comment: input.comment ?? null,
          seenSequence: attendee.event.sequence,
          // Answering yes or no settles a counter-proposal; tentative keeps it.
          ...(input.response === "TENTATIVE" ? {} : { proposedStartsAt: null, proposedEndsAt: null }),
        },
      });
      await recordActivity(tx, context, eventId, "RESPONDED", { response: input.response, email: attendee.email });
    });
    const verb = { ACCEPTED: "accepted", TENTATIVE: "tentatively accepted", DECLINED: "declined" }[input.response];
    await notifyMembers(context, [{ userId: attendee.event.organizer.userId }], {
      category: "responses",
      title: `${attendee.displayName ?? attendee.email} ${verb} “${attendee.event.title}”`,
      body: input.comment ?? describeWhen(attendee.event),
      eventId,
    });
    return this.detail(eventId, context);
  }

  /** Suggest another time. Counts as a tentative yes until the organizer decides. */
  async proposeTime(eventId: string, input: ProposeTimeInput, context: CalendarContext) {
    const attendee = await this.myAttendance(eventId, context);
    const span = normaliseSpan(input.startsAt, input.endsAt, attendee.event.allDay);
    await prisma.$transaction(async (tx) => {
      await tx.eventAttendee.update({
        where: { id: attendee.id, tenantId: context.tenantId },
        data: {
          proposedStartsAt: span.startsAt,
          proposedEndsAt: span.endsAt,
          comment: input.comment ?? null,
          respondedAt: new Date(),
          seenSequence: attendee.event.sequence,
          ...(attendee.response === "NEEDS_ACTION" ? { response: "TENTATIVE" as EventResponse } : {}),
        },
      });
      await recordActivity(tx, context, eventId, "PROPOSED_TIME", {
        email: attendee.email,
        startsAt: span.startsAt.toISOString(),
        endsAt: span.endsAt.toISOString(),
      });
    });
    await notifyMembers(context, [{ userId: attendee.event.organizer.userId }], {
      type: "ACTION_REQUIRED",
      category: "responses",
      title: `${attendee.displayName ?? attendee.email} proposed a new time for “${attendee.event.title}”`,
      body: describeWhen({ ...attendee.event, startsAt: span.startsAt }),
      eventId,
    });
    return this.detail(eventId, context);
  }

  /**
   * The invitations list for one tab, newest event first within the tab's
   * window. "sent" lists events this member organizes that invite anyone.
   */
  async list(tab: InvitationTab, q: string | undefined, context: CalendarContext) {
    const now = new Date();
    const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
    const search: Prisma.CalendarEventWhereInput = q
      ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { location: { contains: q, mode: "insensitive" } }] }
      : {};

    if (tab === "sent") {
      const events = await prisma.calendarEvent.findMany({
        where: {
          tenantId: context.tenantId,
          organizerMembershipId: context.membershipId,
          endsAt: { gt: since },
          attendees: { some: {} },
          ...search,
        },
        orderBy: { startsAt: "asc" },
        take: 200,
        include: {
          organizer: { select: { user: { select: { email: true, displayName: true } } } },
          attendees: { select: { response: true } },
        },
      });
      return events.map((e) => ({
        eventId: e.id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        timeZone: e.timeZone,
        location: e.location,
        videoLink: e.videoLink,
        organizer: { name: nameOf(e.organizer.user), email: e.organizer.user.email },
        attendeeCount: e.attendees.length,
        myResponse: null,
        isNew: false,
        hasUpdate: false,
        receivedAt: e.createdAt,
        responses: tally(e.attendees),
      }));
    }

    const rows = await prisma.eventAttendee.findMany({
      where: {
        tenantId: context.tenantId,
        membershipId: context.membershipId,
        ...(tab === "awaiting" ? { response: "NEEDS_ACTION" } : {}),
        ...(tab === "accepted" ? { response: "ACCEPTED" } : {}),
        event: {
          endsAt: { gt: tab === "all" || tab === "updates" ? since : now },
          ...search,
        },
      },
      take: 500,
      include: {
        event: {
          include: {
            organizer: { select: { user: { select: { email: true, displayName: true } } } },
            attendees: { select: { response: true } },
          },
        },
      },
    });
    const items = rows
      .map((row) => ({
        eventId: row.event.id,
        title: row.event.title,
        startsAt: row.event.startsAt,
        endsAt: row.event.endsAt,
        allDay: row.event.allDay,
        timeZone: row.event.timeZone,
        location: row.event.location,
        videoLink: row.event.videoLink,
        organizer: { name: nameOf(row.event.organizer.user), email: row.event.organizer.user.email },
        attendeeCount: row.event.attendees.length,
        myResponse: row.response,
        isNew: row.seenSequence === null,
        hasUpdate: row.seenSequence !== null && row.seenSequence < row.event.sequence,
        receivedAt: row.createdAt,
        responses: tally(row.event.attendees),
      }))
      .filter((item) => (tab === "updates" ? item.hasUpdate : true));
    items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return items;
  }

  /** The numbers on the tabs and the sidebar badge. */
  async counts(context: CalendarContext) {
    const now = new Date();
    const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
    const [awaiting, mine] = await Promise.all([
      prisma.eventAttendee.count({
        where: { tenantId: context.tenantId, membershipId: context.membershipId, response: "NEEDS_ACTION", event: { endsAt: { gt: now } } },
      }),
      prisma.eventAttendee.findMany({
        where: { tenantId: context.tenantId, membershipId: context.membershipId, seenSequence: { not: null }, event: { endsAt: { gt: since } } },
        select: { seenSequence: true, event: { select: { sequence: true } } },
        take: 500,
      }),
    ]);
    const updates = mine.filter((m) => (m.seenSequence ?? 0) < m.event.sequence).length;
    return { awaiting, updates };
  }

  /** Colleagues to invite, for the attendee field's suggestions. */
  async people(q: string, context: CalendarContext) {
    const term = q.trim();
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: context.tenantId,
        status: "ACTIVE",
        id: { not: context.membershipId },
        ...(term
          ? {
              OR: [
                { user: { email: { contains: term, mode: "insensitive" } } },
                { user: { displayName: { contains: term, mode: "insensitive" } } },
                { mailbox: { address: { contains: term, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: { user: { select: { email: true, displayName: true } }, mailbox: { select: { address: true } } },
      orderBy: { createdAt: "asc" },
      take: 8,
    });
    return members.map((m) => ({ email: m.mailbox?.address ?? m.user.email, name: nameOf(m.user) }));
  }

  /** This member's attendance on the event, or 404. */
  private async myAttendance(eventId: string, context: CalendarContext) {
    const attendee = await prisma.eventAttendee.findFirst({
      where: { eventId, tenantId: context.tenantId, membershipId: context.membershipId },
      include: {
        event: {
          select: {
            title: true,
            sequence: true,
            startsAt: true,
            allDay: true,
            timeZone: true,
            organizer: { select: { userId: true } },
          },
        },
      },
    });
    if (!attendee) throw notFound();
    return attendee;
  }
}

function tally(attendees: Array<{ response: EventResponse }>) {
  const counts = { accepted: 0, tentative: 0, declined: 0, needsAction: 0 };
  for (const a of attendees) {
    if (a.response === "ACCEPTED") counts.accepted++;
    else if (a.response === "TENTATIVE") counts.tentative++;
    else if (a.response === "DECLINED") counts.declined++;
    else counts.needsAction++;
  }
  return counts;
}

export const invitationService = new InvitationService();
