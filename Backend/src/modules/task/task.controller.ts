import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { taskService, type TaskContext } from "./task.service.js";
import type { ExportTasksInput, ListTasksInput } from "./task.schema.js";

function context(req: Request): TaskContext {
  const tenant = req.tenantContext!;
  return { tenantId: tenant.tenantId, userId: tenant.userId, membershipId: tenant.membershipId, workspace: tenant.workspace, requestId: req.requestId };
}

/**
 * Spreadsheets run a cell starting with = + - or @ as a formula, and task
 * titles are typed by people; prefixing makes them inert text.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const EXPORT_COLUMNS = ["Title", "Description", "Priority", "Team", "Owner", "Owner email", "Completed by", "Completed at", "Due", "Original due", "Linked email"];

const taskId = (req: Request) => String(req.params.taskId);
const itemId = (req: Request) => String(req.params.itemId);

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.list(req.query as unknown as ListTasksInput, context(req)), req.requestId);
});

export const summary = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.summary(context(req), (req.query as { tz?: string }).tz), req.requestId);
});

export const teams = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.teams(context(req), (req.query as { tz?: string }).tz), req.requestId);
});

export const assignees = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.assignees(context(req), req.query as { teamId?: string; q?: string }), req.requestId);
});

/** Completed tasks as CSV, opening cleanly in Excel (BOM) and safe from formula injection. */
export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const input = req.query as unknown as ExportTasksInput;
  const { zone, rows } = await taskService.exportCompleted(input, context(req));
  const when = (date: Date | null) =>
    date ? new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "";
  const lines = rows.map((task) =>
    [
      task.text,
      task.description,
      task.priority,
      task.teamMailbox ? task.teamMailbox.displayName || task.teamMailbox.address : "",
      task.owner.displayName,
      task.owner.email,
      task.completedBy?.displayName ?? "",
      when(task.completedAt),
      when(task.dueAt),
      when(task.originalDueAt),
      task.messageId || task.threadId ? "Yes" : "No",
    ]
      .map(csvField)
      .join(",")
  );
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="completed-tasks-${stamp}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(`﻿${EXPORT_COLUMNS.join(",")}\n${lines.join("\n")}${lines.length ? "\n" : ""}`);
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query as unknown as { q: string; limit: number };
  sendSuccess(res, 200, await taskService.search(q, limit, context(req)), req.requestId);
});

export const activity = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.activity(taskId(req), context(req)), req.requestId);
});

export const follow = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.follow(taskId(req), context(req)), req.requestId);
});

export const unfollow = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.unfollow(taskId(req), context(req)), req.requestId);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.get(taskId(req), context(req)), req.requestId);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await taskService.create(req.body, context(req)), req.requestId);
});

export const createFromMessage = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await taskService.createFromMessage(String(req.params.messageId), req.body, context(req)), req.requestId);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.update(taskId(req), req.body, context(req)), req.requestId);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await taskService.remove(taskId(req), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const complete = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.complete(taskId(req), context(req)), req.requestId);
});

export const reopen = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.reopen(taskId(req), req.body.reason, context(req)), req.requestId);
});

export const reschedule = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.reschedule(taskId(req), req.body.dueAt, context(req)), req.requestId);
});

export const addChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await taskService.addChecklistItem(taskId(req), req.body.text, context(req)), req.requestId);
});

export const updateChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.updateChecklistItem(taskId(req), itemId(req), req.body, context(req)), req.requestId);
});

export const removeChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.removeChecklistItem(taskId(req), itemId(req), context(req)), req.requestId);
});

export const reorderChecklist = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.reorderChecklist(taskId(req), req.body.itemIds, context(req)), req.requestId);
});
