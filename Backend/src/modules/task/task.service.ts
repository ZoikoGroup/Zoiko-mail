import { Prisma, type MembershipRole, type NotificationType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { cursorArgs, toPage } from "../../common/utils/pagination.js";
import { sseManager } from "../../common/sse/sse.manager.js";
import { auditService } from "../audit/audit.service.js";
import { notificationService } from "../notification/notification.service.js";
import { participantSummarySelect, toParticipantSummary } from "../participant/participant.service.js";
import { calendarDaysBetween, dayBounds, type TaskDayBounds } from "./task.dates.js";
import {
  OPEN_STATUSES,
  type CreateFromMessageInput,
  type CreateTaskInput,
  type ExportTasksInput,
  type ListTasksInput,
  type TaskView,
  type UpdateTaskInput,
} from "./task.schema.js";

export interface TaskContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  /** The console the session was opened for; shared mailboxes are scoped to consoles. */
  workspace?: MembershipRole;
  requestId?: string;
}

const userSummarySelect = { id: true, displayName: true, email: true, avatarUrl: true } satisfies Prisma.AppUserSelect;
const teamSelect = { id: true, address: true, displayName: true, type: true } satisfies Prisma.MailboxSelect;

const taskInclude = {
  owner: { select: userSummarySelect },
  createdBy: { select: userSummarySelect },
  completedBy: { select: userSummarySelect },
  teamMailbox: { select: teamSelect },
  owedBy: { select: participantSummarySelect },
  owedTo: { select: participantSummarySelect },
  checklist: { select: { id: true, text: true, done: true, position: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
  followers: { select: { userId: true } },
} satisfies Prisma.CommitmentInclude;

type TaskRow = Prisma.CommitmentGetPayload<{ include: typeof taskInclude }>;
type TeamRow = Prisma.MailboxGetPayload<{ select: typeof teamSelect }>;

/** Mailbox types that are a team's, not a person's. */
const TEAM_MAILBOX_TYPES = ["SHARED", "DISTRIBUTION"] as const;

/** "Client Operations", else "support" from support@acme.test. */
function teamName(team: Pick<TeamRow, "address" | "displayName">): string {
  return team.displayName?.trim() || team.address.split("@")[0] || team.address;
}

function toTeam(team: TeamRow) {
  return { id: team.id, name: teamName(team), address: team.address, type: team.type };
}

/** Where the task sits relative to today, in the person's zone. */
export type DueState = "overdue" | "today" | "upcoming" | "none";

function dueState(task: { dueAt: Date | null }, bounds: TaskDayBounds): DueState {
  if (!task.dueAt) return "none";
  if (task.dueAt < bounds.startOfToday) return "overdue";
  if (task.dueAt < bounds.startOfTomorrow) return "today";
  return "upcoming";
}

function isOpen(status: string) {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

function toTask(row: TaskRow, bounds: TaskDayBounds, meId: string) {
  const open = isOpen(row.status);
  const state = open ? dueState(row, bounds) : "none";
  return {
    id: row.id,
    title: row.text,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt,
    originalDueAt: row.originalDueAt,
    snoozedUntil: row.snoozedUntil,
    reminderAt: row.reminderAt,
    reminderSentAt: row.reminderSentAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    dueState: state,
    daysOverdue: state === "overdue" && row.dueAt ? calendarDaysBetween(row.dueAt, bounds.now, bounds.zone) : 0,
    messageId: row.messageId,
    threadId: row.threadId,
    hasLinkedEmail: Boolean(row.messageId || row.threadId),
    /** Somebody else put this on the owner's list. */
    isAssigned: row.ownerUserId !== row.createdByUserId,
    fromAi: row.sourceAiActionId !== null,
    team: row.teamMailbox ? toTeam(row.teamMailbox) : null,
    owner: row.owner,
    createdBy: row.createdBy,
    completedBy: row.completedBy,
    owedBy: row.owedBy ? toParticipantSummary(row.owedBy) : null,
    owedTo: row.owedTo ? toParticipantSummary(row.owedTo) : null,
    checklist: row.checklist,
    checklistProgress: { done: row.checklist.filter((item) => item.done).length, total: row.checklist.length },
    isFollowing: row.followers.some((f) => f.userId === meId),
    followerCount: row.followers.length,
  };
}

export type TaskDto = ReturnType<typeof toTask>;

const openStatus = { in: [...OPEN_STATUSES] } satisfies Prisma.EnumCommitmentStatusFilter;

/** A notification to send once the write that caused it has committed. */
interface Notice {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string;
}

const taskLink = (taskId: string, page = "") => `/mail/tasks${page}?task=${taskId}`;

export class TaskService {
  /** The zone "today" is measured in: the client's, then the person's, then the workspace's. */
  private async zone(ctx: TaskContext, requested?: string): Promise<string> {
    if (requested) return requested;
    const user = await prisma.appUser.findUnique({ where: { id: ctx.userId }, select: { timezone: true } });
    if (user?.timezone) return user.timezone;
    const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
    return tenant?.timezone || "UTC";
  }

  // ── teams ─────────────────────────────────────────────────────────────────

  /**
   * The teams this person is on: the shared and distribution mailboxes they
   * can read, in the console this session opened — the same mailboxes the
   * webmail lists as their shared inboxes.
   */
  private async myTeams(ctx: TaskContext): Promise<TeamRow[]> {
    const rows = await prisma.mailboxAccess.findMany({
      where: {
        tenantId: ctx.tenantId,
        membershipId: ctx.membershipId,
        canRead: true,
        mailbox: { type: { in: [...TEAM_MAILBOX_TYPES] }, ...(ctx.workspace ? { workspaces: { has: ctx.workspace } } : {}) },
      },
      select: { mailbox: { select: teamSelect } },
      orderBy: { mailbox: { address: "asc" } },
    });
    return rows.map((row) => row.mailbox);
  }

  private async myTeamIds(ctx: TaskContext): Promise<string[]> {
    return (await this.myTeams(ctx)).map((team) => team.id);
  }

  /** A team this person is on, or 404: a team they are not on does not exist to them. */
  private async requireTeam(teamId: string, ctx: TaskContext): Promise<TeamRow> {
    const team = (await this.myTeams(ctx)).find((t) => t.id === teamId);
    if (!team) throw new AppError("Team not found", 404, ErrorCodes.NOT_FOUND);
    return team;
  }

  /** The people on a team, as user ids: everyone active who can read its mailbox. */
  private async teamMemberIds(teamId: string, tenantId: string, db: Prisma.TransactionClient = prisma): Promise<string[]> {
    const rows = await db.mailboxAccess.findMany({
      where: { tenantId, mailboxId: teamId, canRead: true, membership: { status: "ACTIVE" } },
      select: { membership: { select: { userId: true } } },
    });
    return rows.map((row) => row.membership.userId);
  }

  /** Teams with their open work, for the sidebar and each team's page. */
  async teams(ctx: TaskContext, tz?: string) {
    const bounds = dayBounds(await this.zone(ctx, tz));
    const teams = await this.myTeams(ctx);
    return Promise.all(
      teams.map(async (team) => {
        const open: Prisma.CommitmentWhereInput = { tenantId: ctx.tenantId, teamMailboxId: team.id, status: openStatus };
        const [openCount, dueSoon, overdue, assignedToMe, completedThisWeek, members] = await Promise.all([
          prisma.commitment.count({ where: open }),
          prisma.commitment.count({ where: { ...open, dueAt: { gte: bounds.startOfToday, lt: bounds.dayStart(3) } } }),
          prisma.commitment.count({ where: { ...open, dueAt: { lt: bounds.startOfToday } } }),
          prisma.commitment.count({ where: { ...open, ownerUserId: ctx.userId } }),
          prisma.commitment.count({ where: { tenantId: ctx.tenantId, teamMailboxId: team.id, status: "COMPLETED", completedAt: { gte: bounds.startOfWeek } } }),
          this.teamMemberIds(team.id, ctx.tenantId),
        ]);
        return {
          ...toTeam(team),
          memberCount: members.length,
          counts: { open: openCount, dueNext3Days: dueSoon, overdue, assignedToMe, completedThisWeek },
        };
      })
    );
  }

  /**
   * Who a task can be given to. On a team, its members; otherwise anyone
   * active in the workspace, narrowed by a search.
   */
  async assignees(ctx: TaskContext, input: { teamId?: string; q?: string }) {
    const term = input.q?.trim();
    const search: Prisma.AppUserWhereInput | undefined = term
      ? { OR: [{ displayName: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }] }
      : undefined;
    let userIds: string[] | undefined;
    if (input.teamId) {
      await this.requireTeam(input.teamId, ctx);
      userIds = await this.teamMemberIds(input.teamId, ctx.tenantId);
    }
    const members = await prisma.tenantMembership.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "ACTIVE",
        ...(userIds ? { userId: { in: userIds } } : {}),
        ...(search ? { user: search } : {}),
      },
      select: { user: { select: userSummarySelect } },
      orderBy: { user: { displayName: "asc" } },
      take: userIds ? 200 : 20,
    });
    return members.map((m) => ({ ...m.user, isMe: m.user.id === ctx.userId }));
  }

  /**
   * Who may own a task: someone active in the workspace and, on a team, a
   * member of that team. Giving work to someone who cannot see it would leave
   * it with nobody.
   */
  private async checkOwner(ownerUserId: string, teamId: string | null, ctx: TaskContext) {
    if (ownerUserId === ctx.userId && !teamId) return;
    const membership = await prisma.tenantMembership.findFirst({ where: { tenantId: ctx.tenantId, userId: ownerUserId, status: "ACTIVE" } });
    if (!membership) throw new AppError("Active owner membership not found", 400, ErrorCodes.VALIDATION_ERROR);
    if (teamId && !(await this.teamMemberIds(teamId, ctx.tenantId)).includes(ownerUserId)) {
      throw new AppError("The owner is not a member of this team", 400, ErrorCodes.VALIDATION_ERROR);
    }
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /** The filter behind each view. My views are the owner's open work; Team is a team's. */
  private viewWhere(
    view: TaskView,
    ctx: TaskContext,
    bounds: TaskDayBounds,
    opts: { days?: number; teamId?: string; scope?: "mine" | "team"; teamIds?: string[] } = {}
  ): Prisma.CommitmentWhereInput {
    const mine: Prisma.CommitmentWhereInput = { tenantId: ctx.tenantId, ownerUserId: ctx.userId, status: openStatus };
    switch (view) {
      case "all":
        return mine;
      case "today":
        // Today's queue carries what is overdue as well as what is due today.
        return { ...mine, dueAt: { lt: bounds.startOfTomorrow } };
      case "overdue":
        return { ...mine, dueAt: { lt: bounds.startOfToday } };
      case "upcoming":
        return { ...mine, dueAt: { gte: bounds.startOfTomorrow, lt: bounds.dayStart(1 + (opts.days ?? 7)) } };
      case "from_email":
        return { ...mine, OR: [{ messageId: { not: null } }, { threadId: { not: null } }] };
      case "following":
        return {
          tenantId: ctx.tenantId,
          status: openStatus,
          followers: { some: { userId: ctx.userId } },
          OR: this.visibleOr(ctx, opts.teamIds ?? []),
        };
      case "assigned":
        return { ...mine, createdByUserId: { not: ctx.userId } };
      case "team":
        return { tenantId: ctx.tenantId, teamMailboxId: opts.teamId!, status: openStatus };
      case "completed": {
        const since = { gte: bounds.dayStart(-(opts.days ?? 30)) };
        if (opts.scope === "team") {
          return { tenantId: ctx.tenantId, status: "COMPLETED", teamMailboxId: { in: opts.teamIds ?? [] }, completedAt: since };
        }
        return {
          tenantId: ctx.tenantId,
          status: "COMPLETED",
          OR: [{ ownerUserId: ctx.userId }, { createdByUserId: ctx.userId }, { completedByUserId: ctx.userId }],
          completedAt: since,
        };
      }
    }
  }

  private orderBy(sort: ListTasksInput["sort"], view: TaskView): Prisma.CommitmentOrderByWithRelationInput[] {
    const tieBreak: Prisma.CommitmentOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "asc" }];
    switch (sort ?? (view === "completed" ? "completed_desc" : "due_asc")) {
      case "due_desc":
        return [{ dueAt: { sort: "desc", nulls: "last" } }, ...tieBreak];
      case "priority":
        return [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }, ...tieBreak];
      case "created_desc":
        return tieBreak;
      case "completed_desc":
        return [{ completedAt: { sort: "desc", nulls: "last" } }, ...tieBreak];
      default:
        return [{ dueAt: { sort: "asc", nulls: "last" } }, ...tieBreak];
    }
  }

  async list(input: ListTasksInput, ctx: TaskContext) {
    const bounds = dayBounds(await this.zone(ctx, input.tz));
    if (input.view === "team") await this.requireTeam(input.teamId!, ctx);
    const teamIds = (input.view === "completed" && input.scope === "team") || input.view === "following" ? await this.myTeamIds(ctx) : undefined;
    const where: Prisma.CommitmentWhereInput = {
      AND: [this.viewWhere(input.view, ctx, bounds, { days: input.days, teamId: input.teamId, scope: input.scope, teamIds })],
    };
    const and = where.AND as Prisma.CommitmentWhereInput[];
    if (input.priority) and.push({ priority: input.priority });
    if (input.q) {
      and.push({
        OR: [
          { text: { contains: input.q, mode: "insensitive" } },
          { description: { contains: input.q, mode: "insensitive" } },
        ],
      });
    }
    const rows = await prisma.commitment.findMany({
      where,
      include: taskInclude,
      orderBy: this.orderBy(input.sort, input.view),
      ...cursorArgs(input.limit, input.cursor),
    });
    const page = toPage(rows, input.limit);
    return { items: page.items.map((row) => toTask(row, bounds, ctx.userId)), nextCursor: page.nextCursor, timeZone: bounds.zone };
  }

  /** The figures on the summary cards and the counts beside the menu items. */
  async summary(ctx: TaskContext, tz?: string) {
    const bounds = dayBounds(await this.zone(ctx, tz));
    const teamIds = await this.myTeamIds(ctx);
    const mine: Prisma.CommitmentWhereInput = { tenantId: ctx.tenantId, ownerUserId: ctx.userId, status: openStatus };
    const count = (where: Prisma.CommitmentWhereInput) => prisma.commitment.count({ where });
    const [open, overdue, dueToday, next7Days, upcoming, fromEmail, assigned, completedThisWeek, teamCompletionsThisWeek, following] = await Promise.all([
      count(mine),
      count({ ...mine, dueAt: { lt: bounds.startOfToday } }),
      count({ ...mine, dueAt: { gte: bounds.startOfToday, lt: bounds.startOfTomorrow } }),
      count({ ...mine, dueAt: { gte: bounds.startOfTomorrow, lt: bounds.dayStart(8) } }),
      count({ ...mine, dueAt: { gte: bounds.startOfTomorrow } }),
      count(this.viewWhere("from_email", ctx, bounds)),
      count(this.viewWhere("assigned", ctx, bounds)),
      count({
        tenantId: ctx.tenantId,
        status: "COMPLETED",
        completedAt: { gte: bounds.startOfWeek },
        OR: [{ ownerUserId: ctx.userId }, { completedByUserId: ctx.userId }],
      }),
      teamIds.length
        ? count({ tenantId: ctx.tenantId, status: "COMPLETED", teamMailboxId: { in: teamIds }, completedAt: { gte: bounds.startOfWeek } })
        : Promise.resolve(0),
      count(this.viewWhere("following", ctx, bounds, { teamIds })),
    ]);
    return {
      timeZone: bounds.zone,
      today: bounds.today,
      counts: { open, overdue, dueToday, next7Days, upcoming, fromEmail, assigned, completedThisWeek, teamCompletionsThisWeek, following },
    };
  }

  async get(taskId: string, ctx: TaskContext) {
    const row = await this.findVisible(taskId, ctx);
    const bounds = dayBounds(await this.zone(ctx));
    return { ...toTask(row, bounds, ctx.userId), linkedEmail: await this.linkedEmail(row, ctx) };
  }

  /** Completed work as rows for a spreadsheet: the same tasks the Completed view lists. */
  async exportCompleted(input: ExportTasksInput, ctx: TaskContext) {
    const bounds = dayBounds(await this.zone(ctx, input.tz));
    const teamIds = input.scope === "team" ? await this.myTeamIds(ctx) : undefined;
    const rows = await prisma.commitment.findMany({
      where: this.viewWhere("completed", ctx, bounds, { days: input.days, scope: input.scope, teamIds }),
      include: taskInclude,
      orderBy: this.orderBy("completed_desc", "completed"),
      take: 5000,
    });
    await auditService.record({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      eventType: "TASKS_EXPORTED",
      targetType: "Commitment",
      requestId: ctx.requestId,
      metadata: { scope: input.scope, days: input.days, rows: rows.length },
    });
    return { zone: bounds.zone, rows };
  }

  // ── writing ───────────────────────────────────────────────────────────────

  async create(input: CreateTaskInput, ctx: TaskContext) {
    const teamId = input.teamId ?? null;
    if (teamId) await this.requireTeam(teamId, ctx);
    const ownerUserId = input.ownerUserId ?? ctx.userId;
    await this.checkOwner(ownerUserId, teamId, ctx);
    if (input.messageId && !(await this.accessibleMessage(input.messageId, ctx))) {
      throw new AppError("Source message not found", 404, ErrorCodes.NOT_FOUND);
    }
    if (input.threadId && !(await this.accessibleThreadMessage(input.threadId, ctx))) {
      throw new AppError("Source thread not found", 404, ErrorCodes.NOT_FOUND);
    }

    const notices: Notice[] = [];
    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.commitment.create({
        data: {
          tenantId: ctx.tenantId,
          createdByUserId: ctx.userId,
          ownerUserId,
          teamMailboxId: teamId,
          text: input.title,
          description: input.description ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
          priority: input.priority,
          status: input.status,
          messageId: input.messageId,
          threadId: input.threadId,
          checklist: {
            create: input.checklist.map((text, position) => ({ tenantId: ctx.tenantId, text, position })),
          },
        },
      });
      if (ownerUserId !== ctx.userId) {
        notices.push({ userId: ownerUserId, type: "ACTION_REQUIRED", title: "New task assigned", body: input.title, linkPath: taskLink(task.id) });
      }
      await this.record(tx, notices, ctx, "TASK_CREATED", task.id, teamId ? { teamId } : undefined);
      return task;
    });
    await this.announce(created.id, ctx, notices);
    return this.get(created.id, ctx);
  }

  async createFromMessage(messageId: string, input: CreateFromMessageInput, ctx: TaskContext) {
    const message = await this.accessibleMessage(messageId, ctx);
    if (!message) throw new AppError("Source message not found", 404, ErrorCodes.NOT_FOUND);
    // Read in a team's shared inbox, it is that team's work unless told otherwise.
    let teamId = input.teamId;
    if (teamId === undefined && input.mailboxId) {
      const teams = await this.myTeamIds(ctx);
      if (teams.includes(input.mailboxId)) teamId = input.mailboxId;
    }
    const subject = message.subject.trim();
    const { mailboxId: _readIn, ...rest } = input;
    return this.create(
      {
        ...rest,
        teamId,
        title: input.title ?? (subject ? `Follow up: ${subject}`.slice(0, 500) : "Follow up on email"),
        messageId: message.id,
        threadId: message.threadId ?? undefined,
      },
      ctx
    );
  }

  async update(taskId: string, input: UpdateTaskInput, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const data: Prisma.CommitmentUncheckedUpdateInput = {};
    if (input.title !== undefined) data.text = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.status !== undefined) {
      data.status = input.status;
      data.snoozedUntil = null;
    }
    if (input.dueAt !== undefined) Object.assign(data, this.dueChange(task, input.dueAt ? new Date(input.dueAt) : null));
    if (input.reminderAt !== undefined) {
      data.reminderAt = input.reminderAt ? new Date(input.reminderAt) : null;
      data.reminderSentAt = null;
    }

    const teamId = input.teamId !== undefined ? input.teamId : task.teamMailboxId;
    if (input.teamId !== undefined && input.teamId !== task.teamMailboxId) {
      if (input.teamId) await this.requireTeam(input.teamId, ctx);
      data.teamMailboxId = input.teamId;
    }
    const ownerUserId = input.ownerUserId ?? task.ownerUserId;
    if (input.ownerUserId !== undefined || input.teamId !== undefined) await this.checkOwner(ownerUserId, teamId, ctx);
    const reassigned = ownerUserId !== task.ownerUserId;
    if (reassigned) data.ownerUserId = ownerUserId;

    const notices: Notice[] = [];
    if (reassigned) {
      notices.push(...this.followerNotices(task, ctx, [ownerUserId], "Task handed over", `${task.text} has a new owner`));
    }
    if (reassigned && ownerUserId !== ctx.userId) {
      notices.push({ userId: ownerUserId, type: "ACTION_REQUIRED", title: "Task assigned to you", body: task.text, linkPath: taskLink(task.id) });
    }
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({ where: { id: task.id, tenantId: ctx.tenantId }, data });
      await this.record(tx, notices, ctx, reassigned ? "TASK_REASSIGNED" : "TASK_UPDATED", task.id, {
        fields: Object.keys(input),
        ...(reassigned ? { from: task.ownerUserId, to: ownerUserId } : {}),
      });
    });
    await this.announce(task.id, ctx, notices, [task.ownerUserId, task.teamMailboxId ? { teamId: task.teamMailboxId } : null]);
    return this.get(task.id, ctx);
  }

  async reschedule(taskId: string, dueAt: string, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const next = new Date(dueAt);
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({ where: { id: task.id, tenantId: ctx.tenantId }, data: { ...this.dueChange(task, next), ...(task.status === "SNOOZED" ? { status: "OPEN", snoozedUntil: null } : {}) } });
      await this.record(tx, [], ctx, "TASK_RESCHEDULED", task.id, { from: task.dueAt?.toISOString() ?? null, to: next.toISOString() });
    });
    await this.announce(task.id, ctx, []);
    return this.get(task.id, ctx);
  }

  async complete(taskId: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    if (task.status === "COMPLETED") return this.get(task.id, ctx);
    // Whoever handed the work over, or owned it, hears that it is done.
    const notices: Notice[] = [task.ownerUserId, task.createdByUserId]
      .filter((id, i, all) => id !== ctx.userId && all.indexOf(id) === i)
      .map((userId): Notice => ({ userId, type: "INFO", title: "Task completed", body: task.text, linkPath: taskLink(task.id, "/completed") }));
    notices.push(...this.followerNotices(task, ctx, [task.ownerUserId, task.createdByUserId], "Task completed", task.text, "/completed"));
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({
        where: { id: task.id, tenantId: ctx.tenantId },
        data: { status: "COMPLETED", completedAt: new Date(), completedByUserId: ctx.userId, snoozedUntil: null },
      });
      await this.record(tx, notices, ctx, "TASK_COMPLETED", task.id);
    });
    await this.announce(task.id, ctx, notices);
    return this.get(task.id, ctx);
  }

  /** Reopening keeps the record honest: it needs a reason, and the reason is kept. */
  async reopen(taskId: string, reason: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    if (task.status !== "COMPLETED") throw new AppError("Only a completed task can be reopened", 409, ErrorCodes.CONFLICT);
    const notices = this.followerNotices(task, ctx, [], "Task reopened", `${task.text}: ${reason}`);
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({
        where: { id: task.id, tenantId: ctx.tenantId },
        data: { status: "OPEN", completedAt: null, completedByUserId: null },
      });
      await this.record(tx, notices, ctx, "TASK_REOPENED", task.id, {
        reason,
        completedAt: task.completedAt?.toISOString() ?? null,
        completedByUserId: task.completedByUserId,
      });
    });
    await this.announce(task.id, ctx, notices, [task.completedByUserId]);
    return this.get(task.id, ctx);
  }

  /** Deleting dismisses: the row stays for the audit trail but leaves every view. */
  async remove(taskId: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    if (task.createdByUserId !== ctx.userId) {
      throw new AppError("Only the person who created this task can delete it", 403, ErrorCodes.FORBIDDEN);
    }
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({ where: { id: task.id, tenantId: ctx.tenantId }, data: { status: "DISMISSED" } });
      await this.record(tx, [], ctx, "TASK_DELETED", task.id);
    });
    await this.announce(task.id, ctx, []);
  }

  async addChecklistItem(taskId: string, text: string, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const last = await prisma.taskChecklistItem.findFirst({ where: { commitmentId: task.id }, orderBy: { position: "desc" }, select: { position: true } });
    const count = await prisma.taskChecklistItem.count({ where: { commitmentId: task.id } });
    if (count >= 100) throw new AppError("A checklist can hold at most 100 items", 400, ErrorCodes.VALIDATION_ERROR);
    await prisma.taskChecklistItem.create({ data: { tenantId: ctx.tenantId, commitmentId: task.id, text, position: (last?.position ?? -1) + 1 } });
    await this.announce(task.id, ctx, []);
    return this.get(task.id, ctx);
  }

  async updateChecklistItem(taskId: string, itemId: string, input: { text?: string; done?: boolean }, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const item = await prisma.taskChecklistItem.findFirst({ where: { id: itemId, commitmentId: task.id } });
    if (!item) throw new AppError("Checklist item not found", 404, ErrorCodes.NOT_FOUND);
    await prisma.$transaction(async (tx) => {
      await tx.taskChecklistItem.update({ where: { id: item.id }, data: { text: input.text, done: input.done } });
      if (input.done !== undefined && input.done !== item.done) {
        await this.record(tx, [], ctx, "TASK_CHECKLIST_UPDATED", task.id, { item: input.text ?? item.text, done: input.done });
      }
    });
    await this.announce(task.id, ctx, []);
    return this.get(task.id, ctx);
  }

  async removeChecklistItem(taskId: string, itemId: string, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const { count } = await prisma.taskChecklistItem.deleteMany({ where: { id: itemId, commitmentId: task.id } });
    if (count === 0) throw new AppError("Checklist item not found", 404, ErrorCodes.NOT_FOUND);
    await this.announce(task.id, ctx, []);
    return this.get(task.id, ctx);
  }

  /** The new order must name every item exactly once. */
  async reorderChecklist(taskId: string, itemIds: string[], ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const existing = await prisma.taskChecklistItem.findMany({ where: { commitmentId: task.id }, select: { id: true } });
    const known = new Set(existing.map((item) => item.id));
    if (new Set(itemIds).size !== itemIds.length || itemIds.length !== known.size || !itemIds.every((id) => known.has(id))) {
      throw new AppError("The new order must list every checklist item once", 400, ErrorCodes.VALIDATION_ERROR);
    }
    await prisma.$transaction(itemIds.map((id, position) => prisma.taskChecklistItem.update({ where: { id }, data: { position } })));
    await this.announce(task.id, ctx, []);
    return this.get(task.id, ctx);
  }

  // ── following ─────────────────────────────────────────────────────────────

  /** Follow a task you can see. Following is how you hear about work you do not own. */
  async follow(taskId: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    await prisma.taskFollower.upsert({
      where: { commitmentId_userId: { commitmentId: task.id, userId: ctx.userId } },
      create: { commitmentId: task.id, userId: ctx.userId, tenantId: ctx.tenantId },
      update: {},
    });
    return this.get(task.id, ctx);
  }

  async unfollow(taskId: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    await prisma.taskFollower.deleteMany({ where: { commitmentId: task.id, userId: ctx.userId } });
    return this.get(task.id, ctx);
  }

  /**
   * Followers hear about the moments that matter — done, handed over,
   * reopened — not every edit. Never the person acting, and never twice for
   * someone already being told as owner or creator.
   */
  private followerNotices(task: TaskRow, ctx: TaskContext, alreadyTold: string[], title: string, body: string, page = ""): Notice[] {
    const skip = new Set([ctx.userId, ...alreadyTold]);
    return task.followers
      .filter((f) => !skip.has(f.userId))
      .map((f) => ({ userId: f.userId, type: "INFO" as const, title, body, linkPath: taskLink(task.id, page) }));
  }

  // ── activity ──────────────────────────────────────────────────────────────

  /**
   * A task's history, oldest first, in words: read from the audit log, which
   * already records every change, so the timeline can never disagree with it.
   */
  async activity(taskId: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    const zone = await this.zone(ctx);
    const events = await prisma.auditEvent.findMany({
      where: {
        tenantId: ctx.tenantId,
        OR: [
          { targetType: "Commitment", targetId: task.id },
          ...(task.sourceAiActionId ? [{ targetType: "AIAction", targetId: task.sourceAiActionId, eventType: "COMMITMENT_CREATED_FROM_AI" }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 300,
      select: { id: true, eventType: true, createdAt: true, actorUserId: true, metadata: true },
    });
    const meta = (value: Prisma.JsonValue | null) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
    const ids = new Set<string>();
    for (const e of events) {
      if (e.actorUserId) ids.add(e.actorUserId);
      const m = meta(e.metadata);
      for (const key of ["from", "to"]) if (e.eventType === "TASK_REASSIGNED" && typeof m[key] === "string") ids.add(m[key] as string);
    }
    const users = await prisma.appUser.findMany({ where: { id: { in: [...ids] } }, select: { id: true, displayName: true, email: true } });
    const name = (id: unknown) => {
      const user = users.find((u) => u.id === id);
      return user ? user.displayName || user.email : "someone";
    };
    const when = (iso: unknown) => (typeof iso === "string" ? this.formatInZone(new Date(iso), zone) : "no date");
    const FIELD: Record<string, string> = {
      title: "title", description: "description", dueAt: "due date", priority: "priority", status: "status",
      reminderAt: "reminder", teamId: "team workspace", ownerUserId: "owner",
    };

    const items = events.flatMap((e) => {
      const m = meta(e.metadata);
      let label: string | null;
      switch (e.eventType) {
        case "TASK_CREATED":
        case "COMMITMENT_CREATED":
          label = "Created the task";
          break;
        case "COMMITMENT_CREATED_FROM_AI":
          label = "Confirmed a task Alet found in an email";
          break;
        case "TASK_UPDATED": {
          const fields = (Array.isArray(m.fields) ? (m.fields as string[]) : []).map((f) => FIELD[f] ?? f);
          label = fields.length ? `Changed the ${fields.join(", ")}` : "Edited the task";
          break;
        }
        case "TASK_REASSIGNED":
          label = `Handed over from ${name(m.from)} to ${name(m.to)}`;
          break;
        case "TASK_RESCHEDULED":
          label = `Moved the due date from ${when(m.from)} to ${when(m.to)}`;
          break;
        case "TASK_COMPLETED":
          label = "Marked complete";
          break;
        case "COMMITMENT_STATUS_CHANGED":
          label = m.status === "COMPLETED" ? "Marked complete" : `Set the status to ${String(m.status ?? "").toLowerCase().replace(/_/g, " ")}`;
          break;
        case "TASK_REOPENED":
          label = `Reopened: “${String(m.reason ?? "")}”`;
          break;
        case "TASK_CHECKLIST_UPDATED":
          label = `${m.done ? "Ticked" : "Unticked"} “${String(m.item ?? "")}”`;
          break;
        default:
          label = null;
      }
      if (!label) return [];
      return [{ id: e.id, type: e.eventType, at: e.createdAt, actor: e.actorUserId ? { id: e.actorUserId, displayName: name(e.actorUserId) } : null, label }];
    });
    // Reminders are sent by the system, not done by a person, so they are not audited.
    if (task.reminderSentAt) {
      items.push({ id: `reminder-${task.id}`, type: "REMINDER_SENT", at: task.reminderSentAt, actor: null, label: `Reminder sent to ${task.owner.displayName}` });
      items.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    return items;
  }

  // ── search ────────────────────────────────────────────────────────────────

  /** Tasks matching a phrase, for the top bar's search: open work first, then the newest. */
  async search(q: string, limit: number, ctx: TaskContext) {
    const term = q.trim();
    if (!term) return [];
    const [teamIds, bounds] = await Promise.all([this.myTeamIds(ctx), this.zone(ctx).then((zone) => dayBounds(zone))]);
    const rows = await prisma.commitment.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { not: "DISMISSED" },
        AND: [
          { OR: this.visibleOr(ctx, teamIds) },
          { OR: [{ text: { contains: term, mode: "insensitive" } }, { description: { contains: term, mode: "insensitive" } }] },
        ],
      },
      include: taskInclude,
      orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { updatedAt: "desc" }],
      take: limit,
    });
    return rows.map((row) => toTask(row, bounds, ctx.userId));
  }

  // ── reminders ─────────────────────────────────────────────────────────────

  /**
   * Send every reminder that has come due, across workspaces. Each one is
   * claimed before it is sent, so two workers running at once never send the
   * same reminder twice; a reminder for work already finished is not sent.
   */
  async processDueReminders(now = new Date()) {
    return withCrossTenant(async () => {
      const due = await prisma.commitment.findMany({
        where: { reminderAt: { lte: now }, reminderSentAt: null, status: openStatus },
        select: { id: true, tenantId: true, ownerUserId: true, text: true, dueAt: true, owner: { select: { timezone: true } } },
        orderBy: { reminderAt: "asc" },
        take: 200,
      });
      let sent = 0;
      for (const task of due) {
        const claimed = await prisma.commitment.updateMany({ where: { id: task.id, reminderSentAt: null }, data: { reminderSentAt: now } });
        if (claimed.count === 0) continue;
        const body = task.dueAt ? `Due ${this.formatInZone(task.dueAt, task.owner.timezone)}` : "No due date set";
        try {
          await notificationService.create({ tenantId: task.tenantId, userId: task.ownerUserId, type: "ACTION_REQUIRED", title: `Reminder: ${task.text}`.slice(0, 300), body, linkPath: taskLink(task.id) });
          sseManager.sendToUser(task.ownerUserId, { type: "NOTIFICATION", tenantId: task.tenantId, userId: task.ownerUserId, payload: { title: `Reminder: ${task.text}`, body, kind: "task", taskId: task.id } });
          sseManager.sendToUser(task.ownerUserId, { type: "TASK_UPDATED", tenantId: task.tenantId, userId: task.ownerUserId, payload: { taskId: task.id } });
          sent += 1;
        } catch (error) {
          logger.warn({ err: error, taskId: task.id }, "Could not send a task reminder");
        }
      }
      return { sent };
    });
  }

  private formatInZone(date: Date, zone: string | null): string {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: zone || "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(date);
    } catch {
      return date.toISOString();
    }
  }

  // ── after a write ─────────────────────────────────────────────────────────

  /** The audit entry and the notifications, inside the write's transaction. */
  private async record(tx: Prisma.TransactionClient, notices: Notice[], ctx: TaskContext, eventType: string, taskId: string, metadata?: Prisma.InputJsonObject) {
    for (const notice of notices) await notificationService.create({ tenantId: ctx.tenantId, ...notice }, tx);
    await auditService.record({ tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType, targetType: "Commitment", targetId: taskId, requestId: ctx.requestId, metadata }, tx);
  }

  /**
   * After the write commits: the bell for whoever was notified, and a live
   * refresh for everyone the task concerns — its owner, its creator, whoever
   * finished it, and its team. `also` names people it concerned before the
   * write (a previous owner, a previous team) who must see it leave.
   */
  private async announce(taskId: string, ctx: TaskContext, notices: Notice[], also: Array<string | { teamId: string } | null> = []) {
    try {
      for (const notice of notices) {
        sseManager.sendToUser(notice.userId, { type: "NOTIFICATION", tenantId: ctx.tenantId, userId: notice.userId, payload: { title: notice.title, body: notice.body, kind: "task", taskId } });
      }
      const task = await prisma.commitment.findFirst({
        where: { id: taskId, tenantId: ctx.tenantId },
        select: { ownerUserId: true, createdByUserId: true, completedByUserId: true, teamMailboxId: true, followers: { select: { userId: true } } },
      });
      const people = new Set<string>();
      const teams = new Set<string>();
      for (const id of [task?.ownerUserId, task?.createdByUserId, task?.completedByUserId, ...(task?.followers ?? []).map((f) => f.userId)]) if (id) people.add(id);
      if (task?.teamMailboxId) teams.add(task.teamMailboxId);
      for (const entry of also) {
        if (typeof entry === "string") people.add(entry);
        else if (entry) teams.add(entry.teamId);
      }
      for (const teamId of teams) for (const id of await this.teamMemberIds(teamId, ctx.tenantId)) people.add(id);
      for (const userId of people) {
        sseManager.sendToUser(userId, { type: "TASK_UPDATED", tenantId: ctx.tenantId, userId, payload: { taskId } });
      }
    } catch (error) {
      // A missed live update costs a refresh; it must never fail the write.
      logger.warn({ err: error, taskId }, "Could not announce a task change");
    }
  }

  // ── access ────────────────────────────────────────────────────────────────

  /**
   * A task is its owner's, its creator's, and — for team work — everyone on
   * that team. To anyone else it does not exist.
   */
  private visibleOr(ctx: TaskContext, teamIds: string[]): Prisma.CommitmentWhereInput[] {
    return [{ ownerUserId: ctx.userId }, { createdByUserId: ctx.userId }, ...(teamIds.length ? [{ teamMailboxId: { in: teamIds } }] : [])];
  }

  private async findVisible(taskId: string, ctx: TaskContext): Promise<TaskRow> {
    const teamIds = await this.myTeamIds(ctx);
    const row = await prisma.commitment.findFirst({
      where: {
        id: taskId,
        tenantId: ctx.tenantId,
        status: { not: "DISMISSED" },
        OR: this.visibleOr(ctx, teamIds),
      },
      include: taskInclude,
    });
    if (!row) throw new AppError("Task not found", 404, ErrorCodes.NOT_FOUND);
    return row;
  }

  /** Completed work is a record; changing it starts with reopening it. */
  private async findEditable(taskId: string, ctx: TaskContext): Promise<TaskRow> {
    const row = await this.findVisible(taskId, ctx);
    if (row.status === "COMPLETED") throw new AppError("Reopen the task before changing it", 409, ErrorCodes.CONFLICT);
    return row;
  }

  /** A new due date, remembering the first one the first time it moves. */
  private dueChange(task: { dueAt: Date | null; originalDueAt: Date | null }, next: Date | null) {
    const moved = (task.dueAt?.getTime() ?? null) !== (next?.getTime() ?? null);
    return {
      dueAt: next,
      ...(moved && task.dueAt && !task.originalDueAt ? { originalDueAt: task.dueAt } : {}),
    };
  }

  /**
   * The mailboxes whose mail this person may read: their own first, then the
   * shared and delegated ones they have access to in this console.
   */
  private async readableMailboxes(ctx: TaskContext): Promise<{ own: string | null; all: string[] }> {
    const [own, shared] = await Promise.all([
      prisma.mailbox.findFirst({ where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId }, select: { id: true } }),
      prisma.mailboxAccess.findMany({
        where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId, canRead: true, ...(ctx.workspace ? { mailbox: { workspaces: { has: ctx.workspace } } } : {}) },
        select: { mailboxId: true },
      }),
    ]);
    return { own: own?.id ?? null, all: [...(own ? [own.id] : []), ...shared.map((row) => row.mailboxId)] };
  }

  private linkedMessageSelect(mailboxIds: string[]) {
    return {
      id: true,
      threadId: true,
      subject: true,
      fromName: true,
      fromAddress: true,
      sentAt: true,
      createdAt: true,
      mailboxItems: { where: { mailboxId: { in: mailboxIds } }, select: { folder: true, mailboxId: true } },
    } satisfies Prisma.EmailMessageSelect;
  }

  private async accessibleMessage(messageId: string, ctx: TaskContext) {
    const mailboxes = await this.readableMailboxes(ctx);
    if (mailboxes.all.length === 0) return null;
    const message = await prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId: ctx.tenantId, mailboxItems: { some: { tenantId: ctx.tenantId, mailboxId: { in: mailboxes.all } } } },
      select: this.linkedMessageSelect(mailboxes.all),
    });
    return message ? { ...message, ...this.placement(message.mailboxItems, mailboxes.own) } : null;
  }

  private async accessibleThreadMessage(threadId: string, ctx: TaskContext) {
    const mailboxes = await this.readableMailboxes(ctx);
    if (mailboxes.all.length === 0) return null;
    const message = await prisma.emailMessage.findFirst({
      where: { threadId, tenantId: ctx.tenantId, mailboxItems: { some: { tenantId: ctx.tenantId, mailboxId: { in: mailboxes.all } } } },
      orderBy: { createdAt: "desc" },
      select: this.linkedMessageSelect(mailboxes.all),
    });
    return message ? { ...message, ...this.placement(message.mailboxItems, mailboxes.own) } : null;
  }

  /** Where to open a message: in one's own mailbox if it is there, else the first shared one. */
  private placement(items: Array<{ folder: string; mailboxId: string }>, own: string | null) {
    const item = items.find((i) => i.mailboxId === own) ?? items[0];
    return { folder: item?.folder ?? null, openInMailboxId: item && item.mailboxId !== own ? item.mailboxId : null };
  }

  /**
   * The email behind a task, as far as this person may see it. Somebody who
   * was assigned a task from a mailbox they cannot read learns that an email
   * exists, not what it says.
   */
  private async linkedEmail(row: TaskRow, ctx: TaskContext) {
    if (!row.messageId && !row.threadId) return null;
    const message = row.messageId
      ? await this.accessibleMessage(row.messageId, ctx)
      : await this.accessibleThreadMessage(row.threadId!, ctx);
    if (!message) return { accessible: false as const, messageId: row.messageId, threadId: row.threadId };
    return {
      accessible: true as const,
      messageId: message.id,
      threadId: message.threadId,
      subject: message.subject,
      fromName: message.fromName,
      fromAddress: message.fromAddress,
      sentAt: message.sentAt ?? message.createdAt,
      folder: message.folder,
      /** Set when the message is in a shared inbox rather than one's own. */
      mailboxId: message.openInMailboxId,
    };
  }
}

export const taskService = new TaskService();
