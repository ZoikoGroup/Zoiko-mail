import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { authService } from "./auth.service.js";

function getRequestContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body, getRequestContext(req));
  sendSuccess(res, 201, result, req.requestId);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, getRequestContext(req));

  if ("requiresTenantSelection" in result) {
    sendSuccess(res, 200, result, req.requestId);
    return;
  }

  sendSuccess(res, 200, result, req.requestId);
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refresh(req.body, getRequestContext(req));
  sendSuccess(res, 200, result, req.requestId);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body, getRequestContext(req));
  sendSuccess(res, 200, { message: "Logged out successfully" }, req.requestId);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  await authService.changePassword(
    req.body,
    tenant.userId,
    tenant.tenantId,
    getRequestContext(req)
  );
  sendSuccess(res, 200, { message: "Password changed successfully" }, req.requestId);
});

export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  const revokedSessionCount = await authService.logoutAll(
    tenant.userId,
    tenant.tenantId,
    getRequestContext(req)
  );
  sendSuccess(
    res,
    200,
    { message: "Logged out from all tenant devices", revokedSessionCount },
    req.requestId
  );
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const result = authService.getCurrentUser(req);
  sendSuccess(res, 200, result, req.requestId);
});
