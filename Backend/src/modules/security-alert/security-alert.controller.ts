import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { securityAlertService } from "./security-alert.service.js";

export const listAlerts = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  const result = await securityAlertService.list(tenant.tenantId, req.query as never);
  sendSuccess(res, 200, result, req.requestId);
});

export const getAlert = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  const alertId = Array.isArray(req.params.alertId)
    ? req.params.alertId[0]
    : req.params.alertId;
  const result = await securityAlertService.getById(tenant.tenantId, alertId);
  sendSuccess(res, 200, result, req.requestId);
});

export const reviewAlert = asyncHandler(async (req: Request, res: Response) => {
  const tenant = req.tenantContext!;
  const alertId = Array.isArray(req.params.alertId)
    ? req.params.alertId[0]
    : req.params.alertId;
  const result = await securityAlertService.review(tenant.tenantId, alertId, req.body, {
    userId: tenant.userId,
  });
  sendSuccess(res, 200, result, req.requestId);
});