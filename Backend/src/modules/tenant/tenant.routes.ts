import { Router } from "express";
import { authenticate, idempotency, requireCapability, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./tenant.controller.js";
import { updateTenantSchema, updateGeneralSettingsSchema } from "./tenant.schema.js";

const tenantRouter = Router();
tenantRouter.use(authenticate, tenantContext, idempotency);
tenantRouter.get("/current", requireRole("OWNER", "ADMIN", "MEMBER"), controller.getCurrent);
tenantRouter.get("/onboarding-status", requireRole("OWNER", "ADMIN", "MEMBER"), controller.getOnboardingStatus);
tenantRouter.get("/usage", requireRole("OWNER", "ADMIN"), controller.getUsage);
tenantRouter.patch(
  "/current",
  requireCapability("workspace.settings.write"),
  validate(updateTenantSchema),
  controller.updateCurrent
);
/**
 * Deliberately a role list, and deliberately NOT `workspace.settings.read`.
 *
 * The matrix holds that capability as READ_ONLY for a Member, so gating this
 * route on it would let a Member read workspace settings — and RBAC §2's
 * "View tenant configuration" row says Owner Yes, Admin Yes, **Member No**.
 * The capability and the route disagree, and the spec sides with the route.
 *
 * That disagreement is real and still open: `workspace.settings.read` is a
 * Member capability that nothing enforces, which is either a matrix row that
 * should be narrowed or a read surface that was never built. It is left here
 * as it shipped rather than resolved by widening access, because opening a
 * workspace-level read to every Member is a product decision and not a
 * tidying-up. tests/tenant-settings.test.ts pins the current answer.
 */
tenantRouter.get("/settings/general", requireRole("OWNER", "ADMIN"), controller.getGeneralSettings);
tenantRouter.patch(
  "/settings/general",
  requireCapability("workspace.settings.write"),
  validate(updateGeneralSettingsSchema),
  controller.updateGeneralSettings
);

export { tenantRouter };
