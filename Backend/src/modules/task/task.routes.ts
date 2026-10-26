import { Router } from "express";
import { authenticate, idempotency, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./task.controller.js";
import {
  assigneesQuerySchema,
  exportTasksSchema,
  checklistItemParamsSchema,
  createChecklistItemSchema,
  createFromMessageSchema,
  createTaskSchema,
  listTasksSchema,
  messageIdParamsSchema,
  reopenTaskSchema,
  reorderChecklistSchema,
  searchTasksSchema,
  rescheduleTaskSchema,
  summaryQuerySchema,
  taskIdSchema,
  updateChecklistItemSchema,
  updateTaskSchema,
} from "./task.schema.js";

export const taskRouter = Router();

// Tasks are commitments, so the same capability governs them: OWN for Owner,
// Admin and Member, absent for Support.
taskRouter.use(authenticate, tenantContext, requireCapability("commitments.own.manage"), idempotency);

taskRouter.get("/", validate(listTasksSchema, "query"), controller.list);
taskRouter.get("/summary", validate(summaryQuerySchema, "query"), controller.summary);
taskRouter.get("/teams", validate(summaryQuerySchema, "query"), controller.teams);
taskRouter.get("/assignees", validate(assigneesQuerySchema, "query"), controller.assignees);
taskRouter.get("/export", validate(exportTasksSchema, "query"), controller.exportCsv);
taskRouter.get("/search", validate(searchTasksSchema, "query"), controller.search);
taskRouter.post("/", validate(createTaskSchema), controller.create);
taskRouter.post("/from-message/:messageId", validate(messageIdParamsSchema, "params"), validate(createFromMessageSchema), controller.createFromMessage);

taskRouter.get("/:taskId", validate(taskIdSchema, "params"), controller.getById);
taskRouter.patch("/:taskId", validate(taskIdSchema, "params"), validate(updateTaskSchema), controller.update);
taskRouter.delete("/:taskId", validate(taskIdSchema, "params"), controller.remove);
taskRouter.get("/:taskId/activity", validate(taskIdSchema, "params"), controller.activity);
taskRouter.post("/:taskId/follow", validate(taskIdSchema, "params"), controller.follow);
taskRouter.delete("/:taskId/follow", validate(taskIdSchema, "params"), controller.unfollow);
taskRouter.post("/:taskId/complete", validate(taskIdSchema, "params"), controller.complete);
taskRouter.post("/:taskId/reopen", validate(taskIdSchema, "params"), validate(reopenTaskSchema), controller.reopen);
taskRouter.post("/:taskId/reschedule", validate(taskIdSchema, "params"), validate(rescheduleTaskSchema), controller.reschedule);

taskRouter.post("/:taskId/checklist", validate(taskIdSchema, "params"), validate(createChecklistItemSchema), controller.addChecklistItem);
taskRouter.put("/:taskId/checklist/order", validate(taskIdSchema, "params"), validate(reorderChecklistSchema), controller.reorderChecklist);
taskRouter.patch("/:taskId/checklist/:itemId", validate(checklistItemParamsSchema, "params"), validate(updateChecklistItemSchema), controller.updateChecklistItem);
taskRouter.delete("/:taskId/checklist/:itemId", validate(checklistItemParamsSchema, "params"), controller.removeChecklistItem);
