import { Router } from "express";
import { authenticate, requireRole, tenantContext } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { guardrails, permissionMatrix } from "./permission.service.js";

/**
 * The authoritative capability matrix and escalation guardrails.
 *
 * Served under /permissions so the admin screen renders the code the server
 * enforces instead of a client-side transcription, which would drift.
 */
export const permissionRouter = Router();
permissionRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER", "SUPPORT"));

permissionRouter.get("/matrix", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { groups: permissionMatrix() }, req.requestId);
}));

permissionRouter.get("/guardrails", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { guardrails: guardrails() }, req.requestId);
}));