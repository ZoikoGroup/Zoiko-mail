import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./tenant.controller.js";
import { updateTenantSchema, updateGeneralSettingsSchema } from "./tenant.schema.js";

const tenantRouter = Router();
tenantRouter.use(authenticate, tenantContext);
tenantRouter.get("/current", requireRole("OWNER", "ADMIN", "MEMBER"), controller.getCurrent);
tenantRouter.get("/onboarding-status", requireRole("OWNER", "ADMIN", "MEMBER"), controller.getOnboardingStatus);
tenantRouter.get("/usage", requireRole("OWNER", "ADMIN"), controller.getUsage);
tenantRouter.patch(
  "/current",
  requireRole("OWNER", "ADMIN"),
  validate(updateTenantSchema),
  controller.updateCurrent
);
tenantRouter.get("/settings/general", requireRole("OWNER", "ADMIN"), controller.getGeneralSettings);
tenantRouter.patch(
  "/settings/general",
  requireRole("OWNER", "ADMIN"),
  validate(updateGeneralSettingsSchema),
  controller.updateGeneralSettings
);

export { tenantRouter };
