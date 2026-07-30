import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { tenantService } from "./tenant.service.js";

function context(req: Request) {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    role: tenant.role,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const getCurrent = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await tenantService.getCurrent(context(req)), req.requestId);
});

export const updateCurrent = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await tenantService.updateCurrent(req.body, context(req)), req.requestId);
});
