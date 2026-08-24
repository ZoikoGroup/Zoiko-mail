import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { capabilityContext } from "../../common/middleware/requireCapability.js";
import { capabilitySnapshot } from "../../common/capabilities/index.js";
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

/**
 * The capability set for the signed-in member — Security §7.2 step 6.
 *
 * Every workspace gates its UI on this, so the response deliberately carries
 * more than a list of names. `reason` and `heldBy` let a client explain a
 * denial ("an Owner holds this") instead of silently disabling a control, and
 * the `requires*` flags let it prompt for the missing condition rather than
 * hiding a capability the caller does in fact hold.
 *
 * The role is read per request by `tenantContext`, so this reflects a
 * demotion immediately rather than at the caller's next sign-in.
 */
export const getMyCapabilities = asyncHandler(async (req: Request, res: Response) => {
  const decisions = capabilitySnapshot(capabilityContext(req));
  sendSuccess(
    res,
    200,
    {
      role: req.tenantContext!.role,
      // The plain list first, because gating a button is the common case.
      capabilities: decisions.filter((d) => d.allowed).map((d) => d.capability),
      decisions,
    },
    req.requestId
  );
});
