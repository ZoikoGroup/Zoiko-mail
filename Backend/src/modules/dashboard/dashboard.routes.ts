import { Router } from "express";
import {
  authenticate,
  requireCapability,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import { capabilityContext } from "../../common/middleware/requireCapability.js";
import { can } from "../../common/capabilities/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { dashboardQuerySchema } from "./dashboard.schema.js";
import { dashboardService } from "./dashboard.service.js";

export const dashboardRouter = Router();

/**
 * Gated on `people.read`, which is the operator boundary here.
 *
 * Not `workspace.settings.read`: a Member holds that as READ_ONLY, and the
 * resolver allows a read-only hold — so gating on it would have opened
 * workspace-wide counts, connector status and the audit tail to every member
 * of the workspace. `people.read` is held by Owner and Admin and by neither
 * Member nor Support, which is exactly the audience for this screen.
 */
dashboardRouter.use(authenticate, tenantContext, requireCapability("people.read"));

dashboardRouter.get(
  "/dashboard",
  validate(dashboardQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const context = req.tenantContext!;
    const summary = await dashboardService.summary({
      tenantId: context.tenantId,
      role: context.role,
      windowHours: (req.query as unknown as { windowHours: number }).windowHours,
      // Evaluated per section rather than assumed from the route gate: both
      // Owner and Admin hold `audit.read` today, so this is not a live
      // divergence, but the aggregate must not become the one place where a
      // capability check is skipped because it happened to be redundant.
      canReadAudit: can("audit.read", capabilityContext(req)),
    });
    sendSuccess(res, 200, summary, req.requestId);
  })
);
