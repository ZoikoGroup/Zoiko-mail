import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { cursorArgs, toPage } from "../../common/utils/pagination.js";
import { auditService } from "../audit/audit.service.js";
import { notificationService } from "../notification/notification.service.js";
import { participantSummarySelect, toParticipantSummary } from "../participant/participant.service.js";
import { calendarDaysBetween, dayBounds, type TaskDayBounds } from "./task.dates.js";
import {
  OPEN_STATUSES,
  type CreateFromMessageInput,
  type CreateTaskInput,
  type ListTasksInput,
  type TaskView,
  type UpdateTaskInput,
} from "./task.schema.js";

export interface TaskContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  requestId?: string;
}

const userSummarySelect = { id: true, displayName: true, email: true, avatarUrl: true } satisfies Prisma.AppUserSelect;

const taskInclude = {
  owner: { select: userSummarySelect },
  createdBy: { select: userSummarySelect },
  completedBy: { select: userSummarySelect },
  owedBy: { select: participantSummarySelect },
  owedTo: { select: participantSummarySelect },
  checklist: { select: { id: true, text: true, done: true, position: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.CommitmentInclude;

type TaskRow = Prisma.CommitmentGetPayload<{ include: typeof taskInclude }>;

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

function toTask(row: TaskRow, bounds: TaskDayBounds) {
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
    owner: row.owner,
    createdBy: row.createdBy,
    completedBy: row.completedBy,
    owedBy: row.owedBy ? toParticipantSummary(row.owedBy) : null,
    owedTo: row.owedTo ? toParticipantSummary(row.owedTo) : null,
    checklist: row.checklist,
    checklistProgress: { done: row.checklist.filter((item) => item.done).length, total: row.checklist.length },
  };
}

export type TaskDto = ReturnType<typeof toTask>;

const openStatus = { in: [...OPEN_STATUSES] } satisfies Prisma.EnumCommitmentStatusFilter;

export class TaskService {
  /** The zone "today" is measured in: the client's, then the person's, then the workspace's. */
  private async zone(ctx: TaskContext, requested?: string): Promise<string> {
    if (requested) return requested;
    const user = await prisma.appUser.findUnique({ where: { id: ctx.userId }, select: { timezone: true } });
    if (user?.timezone) return user.timezone;
    const tenant = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { timezone: true } });
    return tenant?.timezone || "UTC";
  }

  /** The filter behind each view. Every view but Completed is the owner's open work. */
  private viewWhere(view: TaskView, ctx: TaskContext, bounds: TaskDayBounds, days?: number): Prisma.CommitmentWhereInput {
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
        return { ...mine, dueAt: { gte: bounds.startOfTomorrow, lt: bounds.dayStart(1 + (days ?? 7)) } };
      case "from_email":
        return { ...mine, OR: [{ messageId: { not: null } }, { threadId: { not: null } }] };
      case "assigned":
        return { ...mine, createdByUserId: { not: ctx.userId } };
      case "completed":
        return {
          tenantId: ctx.tenantId,
          status: "COMPLETED",
          OR: [{ ownerUserId: ctx.userId }, { createdByUserId: ctx.userId }, { completedByUserId: ctx.userId }],
          completedAt: { gte: bounds.dayStart(-(days ?? 30)) },
        };
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
    const where: Prisma.CommitmentWhereInput = { AND: [this.viewWhere(input.view, ctx, bounds, input.days)] };
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
    return { items: page.items.map((row) => toTask(row, bounds)), nextCursor: page.nextCursor, timeZone: bounds.zone };
  }

  /** The figures on the summary cards and the counts beside the menu items. */
  async summary(ctx: TaskContext, tz?: string) {
    const bounds = dayBounds(await this.zone(ctx, tz));
    const mine: Prisma.CommitmentWhereInput = { tenantId: ctx.tenantId, ownerUserId: ctx.userId, status: openStatus };
    const count = (where: Prisma.CommitmentWhereInput) => prisma.commitment.count({ where });
    const [open, overdue, dueToday, next7Days, upcoming, fromEmail, assigned, completedThisWeek] = await Promise.all([
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
    ]);
    return {
      timeZone: bounds.zone,
      today: bounds.today,
      counts: { open, overdue, dueToday, next7Days, upcoming, fromEmail, assigned, completedThisWeek },
    };
  }

  async get(taskId: string, ctx: TaskContext) {
    const row = await this.findVisible(taskId, ctx);
    const bounds = dayBounds(await this.zone(ctx));
    return { ...toTask(row, bounds), linkedEmail: await this.linkedEmail(row, ctx) };
  }

  async create(input: CreateTaskInput, ctx: TaskContext) {
    const ownerUserId = input.ownerUserId ?? ctx.userId;
    if (ownerUserId !== ctx.userId) {
      const owner = await prisma.tenantMembership.findFirst({ where: { tenantId: ctx.tenantId, userId: ownerUserId, status: "ACTIVE" } });
      if (!owner) throw new AppError("Active owner membership not found", 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (input.messageId && !(await this.accessibleMessage(input.messageId, ctx))) {
      throw new AppError("Source message not found", 404, ErrorCodes.NOT_FOUND);
    }
    if (input.threadId && !(await this.accessibleThreadMessage(input.threadId, ctx))) {
      throw new AppError("Source thread not found", 404, ErrorCodes.NOT_FOUND);
    }

    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.commitment.create({
        data: {
          tenantId: ctx.tenantId,
          createdByUserId: ctx.userId,
          ownerUserId,
          text: input.title,
          description: input.description ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
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
        await notificationService.create(
          { tenantId: ctx.tenantId, userId: ownerUserId, type: "ACTION_REQUIRED", title: "New task assigned", body: input.title, linkPath: `/mail/tasks?task=${task.id}` },
          tx
        );
      }
      await auditService.record(
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType: "TASK_CREATED", targetType: "Commitment", targetId: task.id, requestId: ctx.requestId },
        tx
      );
      return task;
    });
    return this.get(created.id, ctx);
  }

  async createFromMessage(messageId: string, input: CreateFromMessageInput, ctx: TaskContext) {
    const message = await this.accessibleMessage(messageId, ctx);
    if (!message) throw new AppError("Source message not found", 404, ErrorCodes.NOT_FOUND);
    const subject = message.subject.trim();
    return this.create(
      {
        ...input,
        title: input.title ?? (subject ? `Follow up: ${subject}`.slice(0, 500) : "Follow up on email"),
        messageId: message.id,
        threadId: message.threadId ?? undefined,
      },
      ctx
    );
  }

  async update(taskId: string, input: UpdateTaskInput, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const data: Prisma.CommitmentUpdateInput = {};
    if (input.title !== undefined) data.text = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.status !== undefined) {
      data.status = input.status;
      data.snoozedUntil = null;
    }
    if (input.dueAt !== undefined) Object.assign(data, this.dueChange(task, input.dueAt ? new Date(input.dueAt) : null));
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({ where: { id: task.id, tenantId: ctx.tenantId }, data });
      await auditService.record(
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType: "TASK_UPDATED", targetType: "Commitment", targetId: task.id, requestId: ctx.requestId, metadata: { fields: Object.keys(input) } },
        tx
      );
    });
    return this.get(task.id, ctx);
  }

  async reschedule(taskId: string, dueAt: string, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const next = new Date(dueAt);
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({ where: { id: task.id, tenantId: ctx.tenantId }, data: { ...this.dueChange(task, next), ...(task.status === "SNOOZED" ? { status: "OPEN", snoozedUntil: null } : {}) } });
      await auditService.record(
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType: "TASK_RESCHEDULED", targetType: "Commitment", targetId: task.id, requestId: ctx.requestId, metadata: { from: task.dueAt?.toISOString() ?? null, to: next.toISOString() } },
        tx
      );
    });
    return this.get(task.id, ctx);
  }

  async complete(taskId: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    if (task.status === "COMPLETED") return this.get(task.id, ctx);
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({
        where: { id: task.id, tenantId: ctx.tenantId },
        data: { status: "COMPLETED", completedAt: new Date(), completedByUserId: ctx.userId, snoozedUntil: null },
      });
      // Whoever handed the work over hears that it is done.
      const notify = [task.ownerUserId, task.createdByUserId].filter((id, i, all) => id !== ctx.userId && all.indexOf(id) === i);
      for (const userId of notify) {
        await notificationService.create(
          { tenantId: ctx.tenantId, userId, type: "INFO", title: "Task completed", body: task.text, linkPath: `/mail/tasks/completed?task=${task.id}` },
          tx
        );
      }
      await auditService.record(
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType: "TASK_COMPLETED", targetType: "Commitment", targetId: task.id, requestId: ctx.requestId },
        tx
      );
    });
    return this.get(task.id, ctx);
  }

  /** Reopening keeps the record honest: it needs a reason, and the reason is kept. */
  async reopen(taskId: string, reason: string, ctx: TaskContext) {
    const task = await this.findVisible(taskId, ctx);
    if (task.status !== "COMPLETED") throw new AppError("Only a completed task can be reopened", 409, ErrorCodes.CONFLICT);
    await prisma.$transaction(async (tx) => {
      await tx.commitment.update({
        where: { id: task.id, tenantId: ctx.tenantId },
        data: { status: "OPEN", completedAt: null, completedByUserId: null },
      });
      await auditService.record(
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType: "TASK_REOPENED", targetType: "Commitment", targetId: task.id, requestId: ctx.requestId, metadata: { reason, completedAt: task.completedAt?.toISOString() ?? null, completedByUserId: task.completedByUserId } },
        tx
      );
    });
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
      await auditService.record(
        { tenantId: ctx.tenantId, actorUserId: ctx.userId, eventType: "TASK_DELETED", targetType: "Commitment", targetId: task.id, requestId: ctx.requestId },
        tx
      );
    });
  }

  async addChecklistItem(taskId: string, text: string, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const last = await prisma.taskChecklistItem.findFirst({ where: { commitmentId: task.id }, orderBy: { position: "desc" }, select: { position: true } });
    const count = await prisma.taskChecklistItem.count({ where: { commitmentId: task.id } });
    if (count >= 100) throw new AppError("A checklist can hold at most 100 items", 400, ErrorCodes.VALIDATION_ERROR);
    await prisma.taskChecklistItem.create({ data: { tenantId: ctx.tenantId, commitmentId: task.id, text, position: (last?.position ?? -1) + 1 } });
    return this.get(task.id, ctx);
  }

  async updateChecklistItem(taskId: string, itemId: string, input: { text?: string; done?: boolean }, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const item = await prisma.taskChecklistItem.findFirst({ where: { id: itemId, commitmentId: task.id } });
    if (!item) throw new AppError("Checklist item not found", 404, ErrorCodes.NOT_FOUND);
    await prisma.taskChecklistItem.update({ where: { id: item.id }, data: { text: input.text, done: input.done } });
    return this.get(task.id, ctx);
  }

  async removeChecklistItem(taskId: string, itemId: string, ctx: TaskContext) {
    const task = await this.findEditable(taskId, ctx);
    const { count } = await prisma.taskChecklistItem.deleteMany({ where: { id: itemId, commitmentId: task.id } });
    if (count === 0) throw new AppError("Checklist item not found", 404, ErrorCodes.NOT_FOUND);
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
    return this.get(task.id, ctx);
  }

  // ── access ────────────────────────────────────────────────────────────────

  /** A task is the owner's and its creator's; to anyone else it does not exist. */
  private async findVisible(taskId: string, ctx: TaskContext): Promise<TaskRow> {
    const row = await prisma.commitment.findFirst({
      where: { id: taskId, tenantId: ctx.tenantId, status: { not: "DISMISSED" }, OR: [{ ownerUserId: ctx.userId }, { createdByUserId: ctx.userId }] },
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

  private async mailboxId(ctx: TaskContext): Promise<string | null> {
    const mailbox = await prisma.mailbox.findFirst({ where: { tenantId: ctx.tenantId, membershipId: ctx.membershipId }, select: { id: true } });
    return mailbox?.id ?? null;
  }

  private linkedMessageSelect(mailboxId: string) {
    return {
      id: true,
      threadId: true,
      subject: true,
      fromName: true,
      fromAddress: true,
      sentAt: true,
      createdAt: true,
      mailboxItems: { where: { mailboxId }, select: { folder: true }, take: 1 },
    } satisfies Prisma.EmailMessageSelect;
  }

  private async accessibleMessage(messageId: string, ctx: TaskContext) {
    const mailboxId = await this.mailboxId(ctx);
    if (!mailboxId) return null;
    return prisma.emailMessage.findFirst({
      where: { id: messageId, tenantId: ctx.tenantId, mailboxItems: { some: { tenantId: ctx.tenantId, mailboxId } } },
      select: this.linkedMessageSelect(mailboxId),
    });
  }

  private async accessibleThreadMessage(threadId: string, ctx: TaskContext) {
    const mailboxId = await this.mailboxId(ctx);
    if (!mailboxId) return null;
    return prisma.emailMessage.findFirst({
      where: { threadId, tenantId: ctx.tenantId, mailboxItems: { some: { tenantId: ctx.tenantId, mailboxId } } },
      orderBy: { createdAt: "desc" },
      select: this.linkedMessageSelect(mailboxId),
    });
  }

  /**
   * The email behind a task, as far as this person may see it. Somebody who
   * was assigned a task from another person's mailbox learns that an email
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
      folder: message.mailboxItems[0]?.folder ?? null,
    };
  }
}

export const taskService = new TaskService();
