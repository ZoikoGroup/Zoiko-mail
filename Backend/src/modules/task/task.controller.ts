import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { taskService, type TaskContext } from "./task.service.js";
import type { ListTasksInput } from "./task.schema.js";

function context(req: Request): TaskContext {
  const tenant = req.tenantContext!;
  return { tenantId: tenant.tenantId, userId: tenant.userId, membershipId: tenant.membershipId, requestId: req.requestId };
}

const taskId = (req: Request) => String(req.params.taskId);
const itemId = (req: Request) => String(req.params.itemId);

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.list(req.query as unknown as ListTasksInput, context(req)), req.requestId);
});

export const summary = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await taskService.summary(context(req), (req.query as { tz?: string }).tz), req.requestId);
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
