import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { billingService } from "./billing.service.js";

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

export const listPlans = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.listPlans(), _req.requestId);
});

export const getSubscription = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.getSubscription(req.tenantContext!.tenantId), req.requestId);
});

export const createCheckout = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.createCheckout(req.body, context(req)), req.requestId);
});

export const getPortalUrl = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.getPortalUrl(context(req)), req.requestId);
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.cancel(context(req)), req.requestId);
});

export const reactivate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.reactivate(context(req)), req.requestId);
});

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await billingService.listInvoices(req.tenantContext!.tenantId), req.requestId);
});

export const webhook = asyncHandler(async (req: Request, res: Response) => {
  // With express.raw mounted on the webhook route, req.body is the raw Buffer.
  const rawBody = (req.body as Buffer) ?? Buffer.from("");
  const signature = req.header("stripe-signature");
  const result = await billingService.handleWebhook(rawBody, signature);
  res.status(200).json({ success: true, data: result });
});

export const billingController = {
  listPlans,
  getSubscription,
  createCheckout,
  getPortalUrl,
  cancel,
  reactivate,
  listInvoices,
  webhook,
};
