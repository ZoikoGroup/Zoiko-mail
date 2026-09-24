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
 * Gated on the capability, which now says what the role list used to.
 *
 * This read `requireRole("OWNER", "ADMIN")` while the matrix held
 * `workspace.settings.read` as READ_ONLY for a Member — a capability that
 * resolved open against a route that refused. The matrix row was the wrong
 * half: RBAC §2's "View tenant configuration" reads Member **No**. With that
 * row removed the two agree, and the route can name the capability instead of
 * re-listing the roles that happen to hold it.
 *
 * Writing stays on workspace.settings.write, which no Member holds either.
 */
tenantRouter.get(
  "/settings/general",
  requireCapability("workspace.settings.read"),
  controller.getGeneralSettings
);
tenantRouter.patch(
  "/settings/general",
  requireCapability("workspace.settings.write"),
  validate(updateGeneralSettingsSchema),
  controller.updateGeneralSettings
);

export { tenantRouter };
