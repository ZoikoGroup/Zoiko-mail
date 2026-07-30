import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { notificationService } from "./notification.service.js";
import { jobService } from "../job/job.service.js";
export const notificationRouter = Router();
notificationRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"));
notificationRouter.get("/", validate(z.object({ unreadOnly: z.stringbool().default(false) }), "query"), asyncHandler(async (req, res) => { sendSuccess(res, 200, { notifications: await notificationService.list(req.tenantContext!.tenantId, req.tenantContext!.userId, Boolean(req.query.unreadOnly)) }, req.requestId); }));
notificationRouter.post("/digests", validate(z.object({ idempotencyKey: z.string().trim().min(8).max(120) })), asyncHandler(async (req, res) => {
  const context = req.tenantContext!;
  const job = await jobService.enqueue({
    tenantId: context.tenantId,
    userId: context.userId,
    type: "NOTIFICATION_DIGEST",
    payload: { userId: context.userId },
    idempotencyKey: `digest:${context.userId}:${req.body.idempotencyKey}`,
  });
  sendSuccess(res, 202, job, req.requestId);
}));
notificationRouter.patch("/:notificationId/read", validate(z.object({ notificationId: z.string().uuid() }), "params"), asyncHandler(async (req, res) => { sendSuccess(res, 200, await notificationService.markRead(String(req.params.notificationId), req.tenantContext!.tenantId, req.tenantContext!.userId), req.requestId); }));
