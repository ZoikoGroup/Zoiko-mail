import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./mail.controller.js";
import { attachmentUpload } from "./attachment.middleware.js";
import { attachmentParamsSchema, bulkMailboxActionSchema, createDraftSchema, createLabelSchema, forwardSchema, labelIdParamsSchema, listMailSchema, mailboxIdParamsSchema, messageIdParamsSchema, messageLabelParamsSchema, replySchema, scheduleDraftSchema, updateDraftSchema, updateLabelSchema, updateMailboxItemSchema, updateSendingStatusSchema } from "./mail.schema.js";

const mailRouter = Router();
mailRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"));
mailRouter.get("/", validate(listMailSchema, "query"), controller.list);
mailRouter.post("/drafts", validate(createDraftSchema), controller.createDraft);
mailRouter.patch("/bulk", validate(bulkMailboxActionSchema), controller.bulkAction);
mailRouter.get("/labels", controller.listLabels);
mailRouter.post("/labels", validate(createLabelSchema), controller.createLabel);
mailRouter.patch("/labels/:labelId", validate(labelIdParamsSchema, "params"), validate(updateLabelSchema), controller.updateLabel);
mailRouter.delete("/labels/:labelId", validate(labelIdParamsSchema, "params"), controller.deleteLabel);
mailRouter.delete("/trash", controller.emptyTrash);
mailRouter.post("/drafts/:messageId/attachments", validate(messageIdParamsSchema, "params"), attachmentUpload, controller.addAttachment);
mailRouter.get("/:messageId/attachments/:attachmentId", validate(attachmentParamsSchema, "params"), controller.downloadAttachment);
mailRouter.delete("/drafts/:messageId/attachments/:attachmentId", validate(attachmentParamsSchema, "params"), controller.deleteAttachment);
mailRouter.get("/:messageId/delivery-events", validate(messageIdParamsSchema, "params"), controller.listDeliveryEvents);
mailRouter.post("/:messageId/reply", validate(messageIdParamsSchema, "params"), validate(replySchema), controller.reply);
mailRouter.post("/:messageId/reply-all", validate(messageIdParamsSchema, "params"), validate(replySchema), controller.replyAll);
mailRouter.post("/:messageId/forward", validate(messageIdParamsSchema, "params"), validate(forwardSchema), controller.forward);
mailRouter.put("/:messageId/labels/:labelId", validate(messageLabelParamsSchema, "params"), controller.assignLabel);
mailRouter.delete("/:messageId/labels/:labelId", validate(messageLabelParamsSchema, "params"), controller.removeLabel);

// ─── Admin: Mailbox management (must be before /:messageId wildcard) ──────────
mailRouter.get("/admin/mailboxes", requireRole("OWNER", "ADMIN"), controller.listAllMailboxes);
mailRouter.post("/admin/mailboxes", requireRole("OWNER", "ADMIN"), controller.adminCreateMailbox);
mailRouter.delete("/admin/mailboxes/:mailboxId", requireRole("OWNER", "ADMIN"), validate(mailboxIdParamsSchema, "params"), controller.adminDeleteMailbox);
mailRouter.patch(
  "/admin/mailboxes/:mailboxId/sending",
  requireRole("OWNER", "ADMIN"),
  validate(mailboxIdParamsSchema, "params"),
  validate(updateSendingStatusSchema),
  controller.updateSendingStatus
);

mailRouter.get("/:messageId", validate(messageIdParamsSchema, "params"), controller.get);
mailRouter.patch("/:messageId", validate(messageIdParamsSchema, "params"), validate(updateMailboxItemSchema), controller.updateMailboxItem);
mailRouter.delete("/:messageId", validate(messageIdParamsSchema, "params"), controller.permanentlyDelete);
mailRouter.patch("/drafts/:messageId", validate(messageIdParamsSchema, "params"), validate(updateDraftSchema), controller.updateDraft);
mailRouter.delete("/drafts/:messageId", validate(messageIdParamsSchema, "params"), controller.deleteDraft);
mailRouter.post("/drafts/:messageId/send", validate(messageIdParamsSchema, "params"), controller.send);
mailRouter.post("/drafts/:messageId/schedule", validate(messageIdParamsSchema, "params"), validate(scheduleDraftSchema), controller.schedule);
mailRouter.delete("/drafts/:messageId/schedule", validate(messageIdParamsSchema, "params"), controller.cancelSchedule);

export { mailRouter };
