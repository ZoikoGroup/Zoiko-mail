import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { sendSuccess } from "../../common/utils/response.js";
import { auditService } from "./audit.service.js";
import type { AuditEventQuery } from "./audit.schema.js";

// The role comes from tenantContext, which re-reads the membership row on every
// request — so a demotion narrows what the caller can read on their next call
// rather than at their next sign-in.
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.list(
    req.tenantContext!.tenantId,
    req.query as unknown as AuditEventQuery,
    req.tenantContext!.role
  );
  sendSuccess(res, 200, result, req.requestId);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const event = await auditService.getById(
    req.tenantContext!.tenantId,
    String(req.params.eventId),
    req.tenantContext!.role
  );
  if (!event) throw new AppError("Audit event not found", 404, ErrorCodes.NOT_FOUND);
  sendSuccess(res, 200, event, req.requestId);
});
