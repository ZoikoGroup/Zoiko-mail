import { Prisma, type CalendarAccess } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { ACCESS_RANK, accessTo, atLeast, requireAccess, type EffectiveAccess } from "./calendar.access.js";
import { notifyMembers } from "./invitation.service.js";
import type { CalendarContext } from "./calendar.service.js";
import type { FindTimeInput, FreeBusyInput, RequestAccessInput, ScopedEventsInput, ShareInput } from "./calendar.schema.js";
import { preferenceService } from "./preference.service.js";

/**
 * Sharing: team calendars, calendars shared with colleagues, access requests,
 * and the free/busy view of the workspace.
 *
 * Free/busy is workspace-wide on purpose — any member can see that a colleague
 * is busy (never what with), which is what booking a meeting needs. Anything
 * more than "busy" comes only from a share.
 */

const ACCESS_LABEL: Record<CalendarAccess, string> = {
  FREE_BUSY: "free/busy",
  VIEW: "view",
  EDIT: "edit",
  MANAGE: "manage",
};

const MAX_FREEBUSY_DAYS = 31;
const MAX_FREEBUSY_PEOPLE = 50;

function nameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName?.trim() || user.email;
}

const notFound = (what = "Calendar") => new AppError(`${what} not found`, 404, ErrorCodes.NOT_FOUND);

/** An active member of this workspace, by sign-in or mailbox address. */
async function memberByEmail(email: string, context: CalendarContext) {
  const address = email.trim().toLowerCase();
  const member = await prisma.tenantMembership.findFirst({
    where: {
      tenantId: context.tenantId,
      status: "ACTIVE",
      OR: [
        { user: { email: { equals: address, mode: "insensitive" } } },
        { mailbox: { address: { equals: address, mode: "insensitive" } } },
      ],
    },
    select: { id: true, userId: true, user: { select: { email: true, displayName: true } } },
  });
  if (!member) {
    throw new AppError(`${email} is not a member of this workspace.`, 404, ErrorCodes.NOT_FOUND, { reason: "NOT_A_MEMBER" });
  }
  return member;
}

export class SharingService {
  /**
   * Every calendar the caller can see something of: their own (OWNER), team
   * calendars they belong to, and calendars colleagues shared with them —
   * each with the caller's access and their own show/hide choice.
   */
  async accessibleCalendars(context: CalendarContext) {
    const [own, shares] = await Promise.all([
      prisma.calendar.findMany({
        where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId },
        select: {
          id: true,
          kind: true,
          name: true,
          color: true,
          description: true,
          isDefault: true,
          isVisible: true,
          _count: { select: { shares: true } },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      }),
      prisma.calendarShare.findMany({
        where: { tenantId: context.tenantId, membershipId: context.membershipId },
        select: {
          access: true,
          isVisible: true,
          calendar: {
            select: {
              id: true,
              kind: true,
              name: true,
              color: true,
              description: true,
              isDefault: true,
              _count: { select: { shares: true } },
              owner: { select: { user: { select: { email: true, displayName: true } } } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return [
      ...own.map(({ _count, ...c }) => ({
        ...c,
        access: "OWNER" as EffectiveAccess,
        owner: null as { name: string; email: string } | null,
        sharedWithCount: _count.shares,
      })),
      ...shares.map(({ access, isVisible, calendar: { owner, _count, ...c } }) => ({
        ...c,
        isVisible,
        access: access as EffectiveAccess,
        owner: owner ? { name: nameOf(owner.user), email: owner.user.email } : null,
        sharedWithCount: _count.shares,
      })),
    ];
  }

  /**
   * Events in team calendars, or in calendars shared with the caller, that
   * overlap [from, to). What the caller may not read is reduced to Busy: the
   * whole calendar for free/busy access, and any private event that is not
   * their own.
   */
  async scopedEvents(input: ScopedEventsInput, context: CalendarContext) {
    const accessible = await this.accessibleCalendars(context);
    const wanted = accessible.filter((c) =>
      input.scope === "team" ? c.kind === "TEAM" : c.kind === "PERSONAL" && c.access !== "OWNER"
    );
    if (wanted.length === 0) return [];
    const accessById = new Map(wanted.map((c) => [c.id, c.access]));
    const events = await prisma.calendarEvent.findMany({
      where: {
        tenantId: context.tenantId,
        calendarId: { in: wanted.map((c) => c.id) },
        startsAt: { lt: input.to },
        endsAt: { gt: input.from },
      },
      select: {
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
        organizerMembershipId: true,
        createdAt: true,
        updatedAt: true,
        organizer: { select: { user: { select: { email: true, displayName: true } } } },
        _count: { select: { attendees: true } },
      },
      orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }],
      take: 3000,
    });
    return events.map(({ organizer, _count, organizerMembershipId, ...event }) => {
      const access = accessById.get(event.calendarId)!;
      const hidden =
        access === "FREE_BUSY" ||
        (event.visibility === "PRIVATE" && organizerMembershipId !== context.membershipId && access !== "OWNER");
      const base = {
        ...event,
        source: input.scope === "team" ? ("TEAM" as const) : ("SHARED" as const),
        access,
        canEdit: atLeast(access, "EDIT") && !hidden,
        attendeeCount: _count.attendees,
      };
      if (!hidden) return { ...base, redacted: false, organizerName: nameOf(organizer.user) };
      return {
        ...base,
        title: "Busy",
        description: null,
        location: null,
        videoLink: null,
        organizerName: null,
        attendeeCount: 0,
        redacted: true,
      };
    });
  }

  /** Who can see a calendar and how. Visible to anyone with view access or more. */
  async listShares(calendarId: string, context: CalendarContext) {
    await requireAccess(calendarId, "VIEW", context);
    const calendar = await prisma.calendar.findFirst({
      where: { id: calendarId, tenantId: context.tenantId },
      select: {
        id: true,
        name: true,
        kind: true,
        owner: { select: { id: true, user: { select: { email: true, displayName: true } } } },
        shares: {
          orderBy: { createdAt: "asc" },
          select: { id: true, access: true, membershipId: true, membership: { select: { user: { select: { email: true, displayName: true } } } } },
        },
      },
    });
    if (!calendar) throw notFound();
    return {
      calendarId: calendar.id,
      owner: calendar.owner ? { membershipId: calendar.owner.id, name: nameOf(calendar.owner.user), email: calendar.owner.user.email } : null,
      shares: calendar.shares.map((s) => ({
        id: s.id,
        membershipId: s.membershipId,
        name: nameOf(s.membership.user),
        email: s.membership.user.email,
        access: s.access,
        isMe: s.membershipId === context.membershipId,
      })),
    };
  }

  /** Share a calendar with a colleague, or change what they may do. Owner or manager only. */
  async share(calendarId: string, input: ShareInput, context: CalendarContext) {
    const { calendar } = await requireAccess(calendarId, "MANAGE", context);
    const member = await memberByEmail(input.email, context);
    if (member.id === calendar.ownerMembershipId) {
      throw new AppError("That is the calendar's owner.", 409, ErrorCodes.CONFLICT, { reason: "OWNER" });
    }
    const existing = await prisma.calendarShare.findUnique({
      where: { calendarId_membershipId: { calendarId, membershipId: member.id } },
      select: { id: true },
    });
    await prisma.calendarShare.upsert({
      where: { calendarId_membershipId: { calendarId, membershipId: member.id } },
      create: {
        tenantId: context.tenantId,
        calendarId,
        membershipId: member.id,
        access: input.access,
        grantedByMembershipId: context.membershipId,
      },
      update: { access: input.access, grantedByMembershipId: context.membershipId },
    });
    if (!existing) {
      await notifyMembers(context, [{ userId: member.userId }], {
        category: "sharing",
        title: `${calendar.kind === "TEAM" ? "Added to" : "Shared with you:"} ${calendar.name}`,
        body: `You can ${ACCESS_LABEL[input.access]} this calendar.`,
        eventId: "",
        linkPath: calendar.kind === "TEAM" ? "/mail/calendar/team" : "/mail/calendar/shared",
      });
    }
    return this.listShares(calendarId, context);
  }

  /**
   * Stop sharing with someone. A manager or the owner removes anyone; a
   * member can always remove themselves (leave the calendar).
   */
  async removeShare(calendarId: string, shareId: string, context: CalendarContext) {
    const share = await prisma.calendarShare.findFirst({
      where: { id: shareId, calendarId, tenantId: context.tenantId },
      select: { id: true, membershipId: true },
    });
    if (!share) throw notFound("Share");
    if (share.membershipId !== context.membershipId) await requireAccess(calendarId, "MANAGE", context);
    await prisma.calendarShare.delete({ where: { id: share.id, tenantId: context.tenantId } });
  }

  /** The caller's own show/hide choice for a calendar shared with them. */
  async setMyVisibility(calendarId: string, isVisible: boolean, context: CalendarContext) {
    const found = await accessTo(calendarId, context);
    if (!found) throw notFound();
    if (found.access === "OWNER") {
      await prisma.calendar.update({ where: { id: calendarId, tenantId: context.tenantId }, data: { isVisible } });
    } else {
      await prisma.calendarShare.update({ where: { id: found.share!.id, tenantId: context.tenantId }, data: { isVisible } });
    }
  }

  /**
   * Ask for (more) access. Either to a calendar the caller can already see
   * something of, or — by the colleague's address — to their main calendar.
   */
  async requestAccess(input: RequestAccessInput, context: CalendarContext) {
    let calendarId = input.calendarId ?? null;
    if (!calendarId) {
      const owner = await memberByEmail(input.ownerEmail!, context);
      if (owner.id === context.membershipId) {
        throw new AppError("That is your own calendar.", 409, ErrorCodes.CONFLICT, { reason: "OWN_CALENDAR" });
      }
      const main = await prisma.calendar.findFirst({
        where: { tenantId: context.tenantId, ownerMembershipId: owner.id, isDefault: true },
        select: { id: true },
      });
      if (!main) {
        throw new AppError("That colleague has not started using their calendar yet.", 404, ErrorCodes.NOT_FOUND, {
          reason: "NO_CALENDAR",
        });
      }
      calendarId = main.id;
    } else if (!(await accessTo(calendarId, context))) {
      throw notFound();
    }

    const current = await accessTo(calendarId, context);
    if (current && atLeast(current.access, input.access)) {
      throw new AppError("You already have that access.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_GRANTED" });
    }

    // A member can turn off requests for their personal calendars (Calendar Settings).
    const target = await prisma.calendar.findUniqueOrThrow({ where: { id: calendarId }, select: { kind: true, ownerMembershipId: true } });
    if (target.kind === "PERSONAL" && target.ownerMembershipId && !(await preferenceService.acceptsAccessRequests(context.tenantId, target.ownerMembershipId))) {
      throw new AppError("This colleague is not accepting calendar access requests. Ask them to share it with you.", 403, ErrorCodes.FORBIDDEN, {
        reason: "ACCESS_REQUESTS_OFF",
      });
    }

    const data = { access: input.access, message: input.message ?? null };
    let request;
    try {
      request = await prisma.calendarAccessRequest.create({
        data: { tenantId: context.tenantId, calendarId, requesterMembershipId: context.membershipId, ...data },
        select: { id: true },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      // Already asked: the open request is updated rather than duplicated.
      const open = await prisma.calendarAccessRequest.findFirstOrThrow({
        where: { tenantId: context.tenantId, calendarId, requesterMembershipId: context.membershipId, status: "PENDING" },
        select: { id: true },
      });
      request = await prisma.calendarAccessRequest.update({ where: { id: open.id }, data, select: { id: true } });
    }

    const deciders = await this.deciders(calendarId, context);
    const me = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: context.membershipId },
      select: { user: { select: { email: true, displayName: true } } },
    });
    const calendar = await prisma.calendar.findUniqueOrThrow({ where: { id: calendarId }, select: { name: true } });
    await notifyMembers(context, deciders, {
      type: "ACTION_REQUIRED",
      category: "sharing",
      title: `${nameOf(me.user)} asked for ${ACCESS_LABEL[input.access]} access to ${calendar.name}`,
      body: input.message ?? "Approve or decline it under Shared Calendars.",
      eventId: "",
      linkPath: "/mail/calendar/shared?requests=1",
    });
    return { id: request.id, calendarId, status: "PENDING" as const };
  }

  /** Requests waiting on the caller (incoming), and the caller's own recent ones (outgoing). */
  async listAccessRequests(context: CalendarContext) {
    const manageable = await this.accessibleCalendars(context);
    const decidable = manageable.filter((c) => atLeast(c.access, "MANAGE")).map((c) => c.id);
    const select = {
      id: true,
      access: true,
      message: true,
      status: true,
      createdAt: true,
      decidedAt: true,
      calendar: { select: { id: true, name: true, owner: { select: { user: { select: { email: true, displayName: true } } } } } },
      requester: { select: { user: { select: { email: true, displayName: true } } } },
    } satisfies Prisma.CalendarAccessRequestSelect;
    const [incoming, outgoing] = await Promise.all([
      prisma.calendarAccessRequest.findMany({
        where: { tenantId: context.tenantId, calendarId: { in: decidable }, status: "PENDING" },
        select,
        orderBy: { createdAt: "asc" },
      }),
      prisma.calendarAccessRequest.findMany({
        where: { tenantId: context.tenantId, requesterMembershipId: context.membershipId },
        select,
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);
    const view = (r: (typeof incoming)[number]) => ({
      id: r.id,
      access: r.access,
      message: r.message,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      calendar: { id: r.calendar.id, name: r.calendar.name, ownerName: r.calendar.owner ? nameOf(r.calendar.owner.user) : null },
      requester: { name: nameOf(r.requester.user), email: r.requester.user.email },
    });
    return { incoming: incoming.map(view), outgoing: outgoing.map(view) };
  }

  /** Approve (granting the asked access, or more) or decline. Owner or manager only. */
  async decide(requestId: string, approve: boolean, context: CalendarContext, access?: CalendarAccess) {
    const request = await prisma.calendarAccessRequest.findFirst({
      where: { id: requestId, tenantId: context.tenantId },
      select: {
        id: true,
        calendarId: true,
        access: true,
        status: true,
        requesterMembershipId: true,
        requester: { select: { userId: true } },
        calendar: { select: { name: true, kind: true } },
      },
    });
    if (!request) throw notFound("Request");
    await requireAccess(request.calendarId, "MANAGE", context);
    if (request.status !== "PENDING") {
      throw new AppError("This request was already decided.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_DECIDED" });
    }
    const granted = access ?? request.access;
    await prisma.$transaction(async (tx) => {
      const decided = await tx.calendarAccessRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: { status: approve ? "APPROVED" : "DECLINED", decidedByMembershipId: context.membershipId, decidedAt: new Date() },
      });
      if (decided.count === 0) {
        throw new AppError("This request was already decided.", 409, ErrorCodes.CONFLICT, { reason: "ALREADY_DECIDED" });
      }
      if (!approve) return;
      const existing = await tx.calendarShare.findUnique({
        where: { calendarId_membershipId: { calendarId: request.calendarId, membershipId: request.requesterMembershipId } },
        select: { access: true },
      });
      // Approving never takes access away.
      const finalAccess = existing && ACCESS_RANK[existing.access] > ACCESS_RANK[granted] ? existing.access : granted;
      await tx.calendarShare.upsert({
        where: { calendarId_membershipId: { calendarId: request.calendarId, membershipId: request.requesterMembershipId } },
        create: {
          tenantId: context.tenantId,
          calendarId: request.calendarId,
          membershipId: request.requesterMembershipId,
          access: finalAccess,
          grantedByMembershipId: context.membershipId,
        },
        update: { access: finalAccess, grantedByMembershipId: context.membershipId },
      });
    });
    await notifyMembers(context, [{ userId: request.requester.userId }], {
      category: "sharing",
      title: approve ? `Access granted: ${request.calendar.name}` : `Access declined: ${request.calendar.name}`,
      body: approve ? `You can now ${ACCESS_LABEL[granted]} this calendar.` : "Your request was declined.",
      eventId: "",
      linkPath: request.calendar.kind === "TEAM" ? "/mail/calendar/team" : "/mail/calendar/shared",
    });
    return this.listAccessRequests(context);
  }

  /**
   * When each person is busy in [from, to): events in calendars they own that
   * show them as busy, and meetings they have accepted or tentatively
   * accepted. Times only — never titles.
   */
  async freeBusy(input: FreeBusyInput, context: CalendarContext) {
    if (input.to.getTime() - input.from.getTime() > MAX_FREEBUSY_DAYS * 86_400_000) {
      throw new AppError(`Ask for at most ${MAX_FREEBUSY_DAYS} days at a time.`, 400, ErrorCodes.VALIDATION_ERROR, [
        { path: "to", message: "Range too long" },
      ]);
    }
    const emails = [...new Set(input.emails.map((e) => e.toLowerCase()))].slice(0, MAX_FREEBUSY_PEOPLE);
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: context.tenantId,
        status: "ACTIVE",
        OR: [
          { user: { email: { in: emails, mode: "insensitive" } } },
          { mailbox: { address: { in: emails, mode: "insensitive" } } },
          ...(input.includeMe ? [{ id: context.membershipId }] : []),
        ],
      },
      select: { id: true, user: { select: { email: true, displayName: true } }, mailbox: { select: { address: true } } },
    });
    const ids = members.map((m) => m.id);
    const overlap = { startsAt: { lt: input.to }, endsAt: { gt: input.from } };
    const [owned, attending] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: { tenantId: context.tenantId, showAs: "BUSY", calendar: { ownerMembershipId: { in: ids }, kind: "PERSONAL" }, ...overlap },
        select: { startsAt: true, endsAt: true, calendar: { select: { ownerMembershipId: true } } },
      }),
      prisma.eventAttendee.findMany({
        where: {
          tenantId: context.tenantId,
          membershipId: { in: ids },
          response: { in: ["ACCEPTED", "TENTATIVE"] },
          event: { showAs: "BUSY", ...overlap },
        },
        select: { membershipId: true, event: { select: { startsAt: true, endsAt: true } } },
      }),
    ]);
    const busy = new Map<string, Array<{ start: Date; end: Date }>>(ids.map((id) => [id, []]));
    for (const e of owned) busy.get(e.calendar.ownerMembershipId!)?.push({ start: e.startsAt, end: e.endsAt });
    for (const a of attending) busy.get(a.membershipId!)?.push({ start: a.event.startsAt, end: a.event.endsAt });
    return members.map((m) => ({
      membershipId: m.id,
      name: nameOf(m.user),
      email: m.mailbox?.address ?? m.user.email,
      isMe: m.id === context.membershipId,
      busy: merge(busy.get(m.id) ?? []),
    }));
  }

  /**
   * Slots of `durationMinutes` when everyone (and the caller) is free,
   * within working hours in the caller's time zone, on weekdays, in steps of
   * 30 minutes. The first few that fit, earliest first.
   */
  async findTime(input: FindTimeInput, context: CalendarContext) {
    const people = await this.freeBusy(
      { emails: input.emails, from: input.from, to: input.to, includeMe: true },
      context
    );
    const allBusy = merge(people.flatMap((p) => p.busy));
    const slots: Array<{ start: Date; end: Date }> = [];
    const stepMs = 30 * 60_000;
    const lengthMs = input.durationMinutes * 60_000;
    const now = Date.now();
    for (let t = Math.ceil(input.from.getTime() / stepMs) * stepMs; t + lengthMs <= input.to.getTime() && slots.length < input.limit; t += stepMs) {
      if (t < now) continue;
      const start = new Date(t);
      const end = new Date(t + lengthMs);
      if (!withinWorkingHours(start, end, input.timeZone, input.dayStartHour, input.dayEndHour)) continue;
      if (allBusy.some((b) => b.start < end && b.end > start)) continue;
      slots.push({ start, end });
    }
    return {
      people: people.map(({ membershipId, name, email, isMe }) => ({ membershipId, name, email, isMe })),
      slots,
    };
  }

  /** The owner and managers of a calendar, who decide on access requests. */
  private async deciders(calendarId: string, context: CalendarContext) {
    const calendar = await prisma.calendar.findFirstOrThrow({
      where: { id: calendarId, tenantId: context.tenantId },
      select: {
        owner: { select: { userId: true } },
        shares: { where: { access: "MANAGE" }, select: { membership: { select: { userId: true } } } },
      },
    });
    return [
      ...(calendar.owner ? [{ userId: calendar.owner.userId }] : []),
      ...calendar.shares.map((s) => ({ userId: s.membership.userId })),
    ];
  }
}

/** Overlapping or touching busy intervals merged into one, sorted. */
function merge(intervals: Array<{ start: Date; end: Date }>) {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Array<{ start: Date; end: Date }> = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: new Date(i.start), end: new Date(i.end) });
    }
  }
  return out;
}

/** Whether [start, end) falls on a weekday between dayStart and dayEnd, in `zone`. */
function withinWorkingHours(start: Date, end: Date, zone: string, dayStart: number, dayEnd: number): boolean {
  const parts = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
    return { weekday: get("weekday"), day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  };
  const s = parts(start);
  const e = parts(new Date(end.getTime() - 1));
  if (s.weekday === "Sat" || s.weekday === "Sun" || s.day !== e.day) return false;
  return s.minutes >= dayStart * 60 && e.minutes + 1 <= dayEnd * 60;
}

export const sharingService = new SharingService();
