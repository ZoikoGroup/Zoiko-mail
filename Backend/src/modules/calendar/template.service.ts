import type { MeetingTemplateStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { accessTo, atLeast } from "./calendar.access.js";
import { notifyMembers } from "./invitation.service.js";
import { sharingService } from "./sharing.service.js";
import type { CalendarContext } from "./calendar.service.js";
import type { TemplateInput, UpdateTemplateInput } from "./calendar.schema.js";

/**
 * Meeting templates: reusable meeting formats (length, location, agenda,
 * default invitees and safeguards) that a new meeting starts from.
 *
 * A personal template is its owner's alone. A team template belongs to a team
 * calendar: its members can use it once it is ready. Team managers (MANAGE on
 * the calendar, or its owner) and workspace Owners and Admins publish team
 * templates directly; anyone else's changes wait in the review queue.
 *
 * A template only fills in a new meeting. Changing or deleting one never
 * changes meetings already made from it.
 */

const MAX_TEMPLATES = 100;

const notFound = () => new AppError("Template not found", 404, ErrorCodes.NOT_FOUND);

function nameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName?.trim() || user.email;
}

function isWorkspaceAdmin(context: CalendarContext): boolean {
  return context.membershipRole === "OWNER" || context.membershipRole === "ADMIN";
}

const templateInclude = {
  owner: { select: { id: true, userId: true, user: { select: { email: true, displayName: true } } } },
  reviewedBy: { select: { user: { select: { email: true, displayName: true } } } },
  teamCalendar: { select: { id: true, name: true, color: true } },
} satisfies Prisma.MeetingTemplateInclude;

type TemplateRow = Prisma.MeetingTemplateGetPayload<{ include: typeof templateInclude }>;

export class TemplateService {
  /**
   * The team calendars the caller can see (VIEW or more) and those whose
   * templates they review.
   */
  private async teamAccess(context: CalendarContext) {
    const accessible = await sharingService.accessibleCalendars(context);
    const team = accessible.filter((c) => c.kind === "TEAM" && atLeast(c.access, "VIEW"));
    const reviewable = new Set(team.filter((c) => atLeast(c.access, "MANAGE")).map((c) => c.id));
    return { visible: new Set(team.map((c) => c.id)), reviewable, editable: new Set(team.filter((c) => atLeast(c.access, "EDIT")).map((c) => c.id)) };
  }

  private async canReview(teamCalendarId: string, context: CalendarContext): Promise<boolean> {
    if (isWorkspaceAdmin(context)) {
      const exists = await prisma.calendar.count({ where: { id: teamCalendarId, tenantId: context.tenantId, kind: "TEAM" } });
      return exists > 0;
    }
    const found = await accessTo(teamCalendarId, context);
    return Boolean(found && found.calendar.kind === "TEAM" && atLeast(found.access, "MANAGE"));
  }

  private view(t: TemplateRow, context: CalendarContext, canReview: boolean) {
    const { owner, reviewedBy, teamCalendar, tenantId: _tenant, ownerMembershipId, reviewedByMembershipId: _r, ...fields } = t;
    const isMine = ownerMembershipId === context.membershipId;
    return {
      ...fields,
      teamCalendar,
      owner: { name: nameOf(owner.user), email: owner.user.email },
      reviewedBy: reviewedBy ? nameOf(reviewedBy.user) : null,
      isMine,
      canEdit: isMine || (t.scope === "TEAM" && canReview),
      canReview: t.scope === "TEAM" && canReview,
    };
  }

  /**
   * Everything the caller can see: their own templates, ready team templates
   * of team calendars they belong to, and team templates they review (those
   * waiting for review, and ready ones).
   */
  async list(context: CalendarContext) {
    const access = await this.teamAccess(context);
    const admin = isWorkspaceAdmin(context);
    const teamIds = Array.from(access.visible);
    const reviewIds = Array.from(access.reviewable);
    const rows = await prisma.meetingTemplate.findMany({
      where: {
        tenantId: context.tenantId,
        OR: [
          { ownerMembershipId: context.membershipId },
          { scope: "TEAM", status: "READY", teamCalendarId: { in: teamIds } },
          admin
            ? { scope: "TEAM", status: { in: ["READY", "PENDING_REVIEW"] } }
            : { scope: "TEAM", status: { in: ["READY", "PENDING_REVIEW"] }, teamCalendarId: { in: reviewIds } },
        ],
      },
      include: templateInclude,
      orderBy: [{ updatedAt: "desc" }],
    });
    return rows.map((t) =>
      this.view(t, context, t.scope === "TEAM" && (admin || (t.teamCalendarId !== null && access.reviewable.has(t.teamCalendarId))))
    );
  }

  async create(input: TemplateInput, context: CalendarContext) {
    const count = await prisma.meetingTemplate.count({ where: { tenantId: context.tenantId, ownerMembershipId: context.membershipId } });
    if (count >= MAX_TEMPLATES) {
      throw new AppError(`You can keep up to ${MAX_TEMPLATES} templates.`, 409, ErrorCodes.CONFLICT, { reason: "TEMPLATE_LIMIT" });
    }
    const { scope, teamCalendarId, status: wanted, ...fields } = input;
    let status: MeetingTemplateStatus = wanted;
    let reviewer = false;
    if (scope === "TEAM") {
      if (!teamCalendarId) {
        throw new AppError("Choose the team calendar this template belongs to.", 400, ErrorCodes.VALIDATION_ERROR, [
          { path: "teamCalendarId", message: "Required for a team template" },
        ]);
      }
      await this.assertTeamMember(teamCalendarId, context);
      reviewer = await this.canReview(teamCalendarId, context);
      if (status === "READY" && !reviewer) status = "PENDING_REVIEW";
    }
    const created = await prisma.meetingTemplate.create({
      data: {
        tenantId: context.tenantId,
        ownerMembershipId: context.membershipId,
        scope,
        teamCalendarId: scope === "TEAM" ? teamCalendarId! : null,
        ...fields,
        status,
        ...(scope === "TEAM" && status === "READY" ? { reviewedByMembershipId: context.membershipId, reviewedAt: new Date() } : {}),
      },
      include: templateInclude,
    });
    if (status === "PENDING_REVIEW") await this.notifyReviewers(created, context);
    return this.view(created, context, reviewer);
  }

  async update(templateId: string, input: UpdateTemplateInput, context: CalendarContext) {
    const { template, reviewer } = await this.editable(templateId, context);
    const { status: wanted, ...fields } = input;
    let status: MeetingTemplateStatus = wanted ?? template.status;
    // A member's change to a team template (or asking to publish one) goes to
    // the review queue; reviewers publish directly.
    if (template.scope === "TEAM" && !reviewer && status === "READY") status = "PENDING_REVIEW";
    const publishing = template.scope === "TEAM" && status === "READY" && reviewer;
    const updated = await prisma.meetingTemplate.update({
      where: { id: template.id, tenantId: context.tenantId },
      data: {
        ...fields,
        status,
        ...(status === "PENDING_REVIEW" ? { reviewNote: null, reviewedByMembershipId: null, reviewedAt: null } : {}),
        ...(publishing ? { reviewNote: null, reviewedByMembershipId: context.membershipId, reviewedAt: new Date() } : {}),
      },
      include: templateInclude,
    });
    if (status === "PENDING_REVIEW" && template.status !== "PENDING_REVIEW") await this.notifyReviewers(updated, context);
    return this.view(updated, context, reviewer);
  }

  async remove(templateId: string, context: CalendarContext) {
    const { template } = await this.editable(templateId, context);
    await prisma.meetingTemplate.delete({ where: { id: template.id, tenantId: context.tenantId } });
  }

  /** A personal draft copy of any template the caller can see. */
  async duplicate(templateId: string, context: CalendarContext) {
    const visible = (await this.list(context)).find((t) => t.id === templateId);
    if (!visible) throw notFound();
    const source = await prisma.meetingTemplate.findFirst({ where: { id: templateId, tenantId: context.tenantId } });
    if (!source) throw notFound();
    return this.create(
      {
        scope: "PERSONAL",
        title: `${source.title} (copy)`.slice(0, 120),
        agenda: source.agenda,
        durationMinutes: source.durationMinutes,
        locationType: source.locationType,
        locationDetail: source.locationDetail,
        defaultAttendees: source.defaultAttendees,
        bufferMinutes: source.bufferMinutes,
        minNoticeHours: source.minNoticeHours,
        externalGuests: source.externalGuests,
        recordingAllowed: source.recordingAllowed,
        status: "DRAFT",
      },
      context
    );
  }

  /** Approve a team template waiting for review, or send it back with a note. */
  async review(templateId: string, approve: boolean, note: string | undefined, context: CalendarContext) {
    const template = await prisma.meetingTemplate.findFirst({ where: { id: templateId, tenantId: context.tenantId, scope: "TEAM" }, include: templateInclude });
    if (!template || !template.teamCalendarId || !(await this.canReview(template.teamCalendarId, context))) throw notFound();
    if (template.status !== "PENDING_REVIEW") {
      throw new AppError("This template is not waiting for review.", 409, ErrorCodes.CONFLICT, { reason: "NOT_PENDING" });
    }
    const updated = await prisma.meetingTemplate.update({
      where: { id: template.id, tenantId: context.tenantId },
      data: {
        status: approve ? "READY" : "DRAFT",
        reviewNote: approve ? null : note?.trim() || null,
        reviewedByMembershipId: context.membershipId,
        reviewedAt: new Date(),
      },
      include: templateInclude,
    });
    await notifyMembers(context, [{ userId: template.owner.userId }], {
      type: "INFO",
      category: "templates",
      title: approve ? `Template approved: ${template.title}` : `Template needs changes: ${template.title}`,
      body: approve
        ? `${template.teamCalendar?.name ?? "The team"} can now use it.`
        : note?.trim() || "A reviewer sent it back for changes.",
      eventId: template.id,
      linkPath: `/mail/calendar/templates?template=${template.id}`,
    });
    return this.view(updated, context, true);
  }

  /** A template the caller may change: their own, or a team one they review. */
  private async editable(templateId: string, context: CalendarContext) {
    const template = await prisma.meetingTemplate.findFirst({ where: { id: templateId, tenantId: context.tenantId } });
    if (!template) throw notFound();
    const reviewer = template.scope === "TEAM" && template.teamCalendarId ? await this.canReview(template.teamCalendarId, context) : false;
    if (template.ownerMembershipId === context.membershipId) {
      // Still a member of the team calendar? Otherwise the template is out of reach.
      if (template.scope === "TEAM" && !reviewer) await this.assertTeamMember(template.teamCalendarId!, context);
      return { template, reviewer };
    }
    if (reviewer) return { template, reviewer };
    // Someone else's: a ready team template the caller can see is read-only for them.
    const visible = template.scope === "TEAM" && template.status === "READY" && (await this.teamAccess(context)).visible.has(template.teamCalendarId!);
    if (visible) throw new AppError("Only the template's owner or a team manager can change it.", 403, ErrorCodes.FORBIDDEN, { reason: "TEMPLATE_ACCESS" });
    throw notFound();
  }

  /** Team templates are for people who can add meetings to the team calendar. */
  private async assertTeamMember(teamCalendarId: string, context: CalendarContext) {
    const found = await accessTo(teamCalendarId, context);
    if (found && found.calendar.kind !== "TEAM") {
      throw new AppError("Choose a team calendar for a team template.", 400, ErrorCodes.VALIDATION_ERROR, [
        { path: "teamCalendarId", message: "Not a team calendar" },
      ]);
    }
    if (found && atLeast(found.access, "EDIT")) return;
    if (await this.canReview(teamCalendarId, context)) return;
    if (found) {
      throw new AppError("You need to be able to add meetings to this team calendar.", 403, ErrorCodes.FORBIDDEN, { reason: "CALENDAR_ACCESS" });
    }
    throw new AppError("Calendar not found", 404, ErrorCodes.NOT_FOUND);
  }

  /** Tell the team calendar's managers (or, failing them, the workspace admins) a template waits. */
  private async notifyReviewers(template: TemplateRow, context: CalendarContext) {
    if (!template.teamCalendarId) return;
    const calendar = await prisma.calendar.findFirst({
      where: { id: template.teamCalendarId, tenantId: context.tenantId },
      select: {
        name: true,
        owner: { select: { userId: true } },
        shares: { where: { access: "MANAGE" }, select: { membership: { select: { userId: true } } } },
      },
    });
    if (!calendar) return;
    let recipients: Array<{ userId: string | null }> = [
      ...(calendar.owner ? [{ userId: calendar.owner.userId }] : []),
      ...calendar.shares.map((s) => ({ userId: s.membership.userId })),
    ];
    if (recipients.every((r) => r.userId === context.userId)) {
      const admins = await prisma.tenantMembership.findMany({
        where: { tenantId: context.tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
        select: { userId: true },
      });
      recipients = admins;
    }
    await notifyMembers(context, recipients, {
      type: "ACTION_REQUIRED",
      category: "templates",
      title: `Template to review: ${template.title}`,
      body: `${nameOf(template.owner.user)} submitted it for ${calendar.name}.`,
      eventId: template.id,
      linkPath: `/mail/calendar/templates?tab=review&template=${template.id}`,
    });
  }
}

export const templateService = new TemplateService();
