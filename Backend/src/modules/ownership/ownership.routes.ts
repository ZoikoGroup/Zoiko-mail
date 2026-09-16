import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { createTransferSchema, transferIdParamsSchema } from "./ownership.schema.js";
import { ownershipService } from "./ownership.service.js";

export const ownershipRouter = Router();
ownershipRouter.use(authenticate, tenantContext, requireRole("OWNER"));

ownershipRouter.get("/", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { transfers: await ownershipService.list(req.tenantContext!.tenantId) }, req.requestId);
}));

ownershipRouter.post("/transfers", validate(createTransferSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await ownershipService.initiate(req.tenantContext!.tenantId, req.tenantContext!.userId, req.body.targetMembershipId), req.requestId);
}));

ownershipRouter.post("/transfers/:transferId/approve", validate(transferIdParamsSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await ownershipService.approve(req.tenantContext!.tenantId, req.tenantContext!.userId, String(req.params.transferId)), req.requestId);
}));

ownershipRouter.post("/transfers/:transferId/cancel", validate(transferIdParamsSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await ownershipService.cancel(req.tenantContext!.tenantId, req.tenantContext!.userId, String(req.params.transferId)), req.requestId);
}));