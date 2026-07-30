import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { userService } from "./user.service.js";

function context(req: Request) {
  return {
    tenantId: req.tenantContext!.tenantId,
    userId: req.tenantContext!.userId,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await userService.getProfile(context(req)), req.requestId);
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await userService.updateProfile(req.body, context(req)), req.requestId);
});
