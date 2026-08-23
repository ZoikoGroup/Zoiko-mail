import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { mailService } from "./mail.service.js";

function context(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    membershipId: tenant.membershipId,
    role: tenant.role,
    email: tenant.user.email,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const createDraft = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await mailService.createDraft(req.body, context(req)), req.requestId);
});
export const updateDraft = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.updateDraft(String(req.params.messageId), req.body, context(req)), req.requestId);
});
export const deleteDraft = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.deleteDraft(String(req.params.messageId), context(req)), req.requestId);
});
export const send = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.send(String(req.params.messageId), context(req)), req.requestId);
});
export const schedule = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 202, await mailService.schedule(String(req.params.messageId), req.body.scheduledAt, context(req)), req.requestId);
});
export const cancelSchedule = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.cancelSchedule(String(req.params.messageId), context(req)), req.requestId);
});
export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.list(req.query as never, context(req)), req.requestId);
});
export const unreadCounts = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.unreadCounts(context(req)), req.requestId);
});
export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.get(String(req.params.messageId), context(req)), req.requestId);
});
export const updateMailboxItem = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.updateMailboxItem(String(req.params.messageId), req.body, context(req)), req.requestId);
});
export const permanentlyDelete = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.permanentlyDelete(String(req.params.messageId), context(req)), req.requestId);
});
export const emptyTrash = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.emptyTrash(context(req)), req.requestId);
});
export const bulkAction = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.bulkAction(req.body, context(req)), req.requestId);
});
export const listLabels = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, { labels: await mailService.listLabels(context(req)) }, req.requestId);
});
export const createLabel = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await mailService.createLabel(req.body, context(req)), req.requestId);
});
export const updateLabel = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.updateLabel(String(req.params.labelId), req.body, context(req)), req.requestId);
});
export const deleteLabel = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.deleteLabel(String(req.params.labelId), context(req)), req.requestId);
});
export const assignLabel = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.assignLabel(String(req.params.messageId), String(req.params.labelId), context(req)), req.requestId);
});
export const removeLabel = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.removeLabel(String(req.params.messageId), String(req.params.labelId), context(req)), req.requestId);
});
export const addAttachment = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    201,
    await mailService.addAttachment(String(req.params.messageId), req.file!, context(req)),
    req.requestId
  );
});
export const downloadAttachment = asyncHandler(async (req: Request, res: Response) => {
  const attachment = await mailService.downloadAttachment(
    String(req.params.messageId),
    String(req.params.attachmentId),
    context(req)
  );
  res.setHeader("Content-Type", attachment.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`
  );
  res.setHeader("Content-Length", attachment.data.length);
  res.status(200).send(attachment.data);
});
export const deleteAttachment = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    await mailService.deleteAttachment(
      String(req.params.messageId),
      String(req.params.attachmentId),
      context(req)
    ),
    req.requestId
  );
});
export const listDeliveryEvents = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    { events: await mailService.listDeliveryEvents(String(req.params.messageId), context(req)) },
    req.requestId
  );
});
export const adminListDeliveryEvents = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    { events: await mailService.adminListDeliveryEvents(req.query as { type?: string; limit?: number }, context(req)) },
    req.requestId
  );
});
export const updateSendingStatus = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    await mailService.updateSendingStatus(String(req.params.mailboxId), req.body, context(req)),
    req.requestId
  );
});
export const reply = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await mailService.createReply(String(req.params.messageId), req.body, false, context(req)), req.requestId);
});
export const replyAll = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await mailService.createReply(String(req.params.messageId), req.body, true, context(req)), req.requestId);
});
export const forward = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await mailService.createForward(String(req.params.messageId), req.body, context(req)), req.requestId);
});

// ─── Admin: Mailbox management ────────────────────────────────────────────────

export const listAllMailboxes = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  sendSuccess(res, 200, await mailService.listAllMailboxes(tenant.tenantId), req.requestId);
});

export const adminCreateMailbox = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await mailService.adminCreateMailbox(req.tenantContext!.tenantId, req.body.membershipId, context(req)), req.requestId);
});

export const adminDeleteMailbox = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await mailService.adminDeleteMailbox(req.tenantContext!.tenantId, String(req.params.mailboxId), context(req)), req.requestId);
});
