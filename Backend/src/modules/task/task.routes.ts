import { Router } from "express";
import { authenticate, idempotency, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./task.controller.js";
import {
  checklistItemParamsSchema,
  createChecklistItemSchema,
  createFromMessageSchema,
  createTaskSchema,
  listTasksSchema,
  messageIdParamsSchema,
  reopenTaskSchema,
  reorderChecklistSchema,
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
taskRouter.post("/", validate(createTaskSchema), controller.create);
taskRouter.post("/from-message/:messageId", validate(messageIdParamsSchema, "params"), validate(createFromMessageSchema), controller.createFromMessage);

taskRouter.get("/:taskId", validate(taskIdSchema, "params"), controller.getById);
taskRouter.patch("/:taskId", validate(taskIdSchema, "params"), validate(updateTaskSchema), controller.update);
taskRouter.delete("/:taskId", validate(taskIdSchema, "params"), controller.remove);
taskRouter.post("/:taskId/complete", validate(taskIdSchema, "params"), controller.complete);
taskRouter.post("/:taskId/reopen", validate(taskIdSchema, "params"), validate(reopenTaskSchema), controller.reopen);
taskRouter.post("/:taskId/reschedule", validate(taskIdSchema, "params"), validate(rescheduleTaskSchema), controller.reschedule);

taskRouter.post("/:taskId/checklist", validate(taskIdSchema, "params"), validate(createChecklistItemSchema), controller.addChecklistItem);
taskRouter.put("/:taskId/checklist/order", validate(taskIdSchema, "params"), validate(reorderChecklistSchema), controller.reorderChecklist);
taskRouter.patch("/:taskId/checklist/:itemId", validate(checklistItemParamsSchema, "params"), validate(updateChecklistItemSchema), controller.updateChecklistItem);
taskRouter.delete("/:taskId/checklist/:itemId", validate(checklistItemParamsSchema, "params"), controller.removeChecklistItem);
