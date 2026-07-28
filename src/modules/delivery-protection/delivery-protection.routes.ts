import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { createSuppressionSchema, suppressionIdSchema, warmupMailboxSchema } from "./delivery-protection.schema.js";
import { deliveryProtectionService } from "./delivery-protection.service.js";

export const deliveryProtectionRouter = Router();
deliveryProtectionRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN"));

deliveryProtectionRouter.get("/suppressions", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { entries: await deliveryProtectionService.listSuppressions(req.tenantContext!.tenantId) }, req.requestId);
}));
deliveryProtectionRouter.post("/suppressions", validate(createSuppressionSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await deliveryProtectionService.suppress(
    req.tenantContext!.tenantId, req.body.email, req.body.reason, req.tenantContext!.userId
  ), req.requestId);
}));
deliveryProtectionRouter.delete("/suppressions/:suppressionId", validate(suppressionIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await deliveryProtectionService.unsuppress(
    req.tenantContext!.tenantId, String(req.params.suppressionId), req.tenantContext!.userId
  ), req.requestId);
}));
deliveryProtectionRouter.get("/mailboxes/:mailboxId/warmup", validate(warmupMailboxSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await deliveryProtectionService.warmupStatus(
    req.tenantContext!.tenantId, String(req.params.mailboxId)
  ), req.requestId);
}));
deliveryProtectionRouter.post("/mailboxes/:mailboxId/warmup/evaluate", validate(warmupMailboxSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await deliveryProtectionService.evaluateWarmup(
    req.tenantContext!.tenantId, String(req.params.mailboxId), req.tenantContext!.userId
  ), req.requestId);
}));

