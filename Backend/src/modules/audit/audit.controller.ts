import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { sendSuccess } from "../../common/utils/response.js";
import { auditService } from "./audit.service.js";
import type { AuditEventQuery } from "./audit.schema.js";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await auditService.list(
    req.tenantContext!.tenantId,
    req.query as unknown as AuditEventQuery
  );
  sendSuccess(res, 200, result, req.requestId);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const event = await auditService.getById(
    req.tenantContext!.tenantId,
    String(req.params.eventId)
  );
  if (!event) throw new AppError("Audit event not found", 404, ErrorCodes.NOT_FOUND);
  sendSuccess(res, 200, event, req.requestId);
});
