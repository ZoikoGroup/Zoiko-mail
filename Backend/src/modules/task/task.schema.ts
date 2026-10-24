import { z } from "zod";
import { paginationQuerySchema } from "../../common/utils/pagination.js";

/**
 * Tasks are commitments (see the `Commitment` model) seen through the Tasks
 * section of the webmail. `text` is the title; the API calls it that.
 */

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
/** Statuses a person sets directly. Completing and reopening have their own routes. */
export const EDITABLE_STATUSES = ["OPEN", "PLANNED", "IN_PROGRESS"] as const;
/** Everything that still needs doing. Snoozed work is postponed, not done. */
export const OPEN_STATUSES = ["OPEN", "PLANNED", "IN_PROGRESS", "SNOOZED"] as const;

export const TASK_VIEWS = ["all", "today", "upcoming", "overdue", "completed", "from_email", "assigned"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_SORTS = ["due_asc", "due_desc", "priority", "created_desc", "completed_desc"] as const;

/** An IANA zone the runtime knows, e.g. "Europe/London". */
export const timeZoneSchema = z.string().trim().min(1).max(64).refine((zone) => {
  try {
    return Boolean(new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}, "Unknown time zone");

const title = z.string().trim().min(1).max(500);
const description = z.string().trim().max(10_000).nullable();
const checklistText = z.string().trim().min(1).max(500);

export const taskIdSchema = z.object({ taskId: z.string().uuid() });
export const checklistItemParamsSchema = z.object({ taskId: z.string().uuid(), itemId: z.string().uuid() });
export const messageIdParamsSchema = z.object({ messageId: z.string().uuid() });

export const listTasksSchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  view: z.enum(TASK_VIEWS).default("all"),
  q: z.string().trim().max(200).optional(),
  priority: z.enum(PRIORITIES).optional(),
  sort: z.enum(TASK_SORTS).optional(),
  /** Upcoming: how many days ahead (default 7). Completed: how far back (default 30). */
  days: z.coerce.number().int().min(1).max(365).optional(),
  /** The zone the client displays in; "today" is a calendar day there. */
  tz: timeZoneSchema.optional(),
});

export const summaryQuerySchema = z.object({ tz: timeZoneSchema.optional() });

export const createTaskSchema = z.object({
  title,
  description: description.optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  status: z.enum(EDITABLE_STATUSES).default("OPEN"),
  ownerUserId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  checklist: z.array(checklistText).max(50).default([]),
});

/** From an email: the title falls back to the message's subject. */
export const createFromMessageSchema = createTaskSchema
  .omit({ messageId: true, threadId: true })
  .extend({ title: title.optional() });

export const updateTaskSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(EDITABLE_STATUSES).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), "Nothing to update");

export const rescheduleTaskSchema = z.object({ dueAt: z.iso.datetime() });

export const reopenTaskSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const createChecklistItemSchema = z.object({ text: checklistText });

export const updateChecklistItemSchema = z
  .object({ text: checklistText.optional(), done: z.boolean().optional() })
  .refine((value) => value.text !== undefined || value.done !== undefined, "Nothing to update");

export const reorderChecklistSchema = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(100) });

export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateFromMessageInput = z.infer<typeof createFromMessageSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
