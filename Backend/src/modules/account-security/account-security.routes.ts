import { Router, type Request } from "express";
import { z } from "zod";
import {
  authenticate,
  idempotency,
  requireCapability,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { accountSecurityService, type AccountActor } from "./account-security.service.js";

/**
 * /api/v1/account-security — P1 (ZM-05), S2 §09 "Account activity".
 *
 *   GET    /sessions                               your own live sessions
 *   DELETE /sessions/:sessionKey                   sign one of them out
 *   GET    /members/:membershipId/sessions         a member's sessions (owner/admin)
 *   POST   /members/:membershipId/sessions/revoke  contain: sign them out everywhere
 *
 * Every route needs a live session (tenantContext checks it). The member
 * routes need the security responder's capability and then the per-target
 * role ceiling the service applies.
 */

const sessionKeyParams = z.object({ sessionKey: z.string().min(1).max(64) });
const membershipParams = z.object({ membershipId: z.string().uuid() });
const revokeBody = z.object({ note: z.string().trim().max(500).optional() }).strict();

function actor(req: Request): AccountActor {
  const context = req.tenantContext!;
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role,
    sessionId: context.sessionId ?? null,
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export const accountSecurityRouter = Router();
accountSecurityRouter.use(authenticate, tenantContext);

accountSecurityRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    sendSuccess(res, 200, await accountSecurityService.listOwnSessions(actor(req)), req.requestId);
  })
);

accountSecurityRouter.delete(
  "/sessions/:sessionKey",
  idempotency,
  validate(sessionKeyParams, "params"),
  asyncHandler(async (req, res) => {
    const result = await accountSecurityService.revokeOwnSession(actor(req), String(req.params.sessionKey));
    sendSuccess(res, 200, result, req.requestId);
  })
);

accountSecurityRouter.get(
  "/members/:membershipId/sessions",
  requireCapability("security-alert.review"),
  validate(membershipParams, "params"),
  asyncHandler(async (req, res) => {
    const result = await accountSecurityService.listMemberSessions(actor(req), String(req.params.membershipId));
    sendSuccess(res, 200, result, req.requestId);
  })
);

accountSecurityRouter.post(
  "/members/:membershipId/sessions/revoke",
  requireCapability("security-alert.review"),
  idempotency,
  validate(membershipParams, "params"),
  validate(revokeBody),
  asyncHandler(async (req, res) => {
    const result = await accountSecurityService.revokeMemberSessions(
      actor(req),
      String(req.params.membershipId),
      (req.body as z.infer<typeof revokeBody>).note
    );
    sendSuccess(res, 200, result, req.requestId);
  })
);
