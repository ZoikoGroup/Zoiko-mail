import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { policyService } from "./policy.service.js";
import { retentionService } from "./retention.service.js";

function context(req: Request) {
  const tenant = req.tenantContext!;
  return { tenantId: tenant.tenantId, userId: tenant.userId, role: tenant.role, requestId: req.requestId, ipAddress: req.ip ?? null, userAgent: req.header("user-agent") ?? null };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, { policies: await policyService.list(req.tenantContext!.tenantId, req.query as never) }, req.requestId);
});
export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await policyService.get(req.tenantContext!.tenantId, String(req.params.policyId)), req.requestId);
});
export const create = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await policyService.create(req.body, context(req)), req.requestId);
});
export const activate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await policyService.activate(String(req.params.policyId), context(req)), req.requestId);
});
export const evaluate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await policyService.evaluate(req.body, context(req)), req.requestId);
});
export const previewRetention = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await retentionService.preview(req.body.asOf, context(req)), req.requestId);
});
export const executeRetention = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await retentionService.execute(req.body.asOf, context(req)), req.requestId);
});
