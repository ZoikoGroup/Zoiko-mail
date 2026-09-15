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
tenantRouter.get("/settings/general", requireRole("OWNER", "ADMIN"), controller.getGeneralSettings);
tenantRouter.patch(
  "/settings/general",
  requireCapability("workspace.settings.write"),
  validate(updateGeneralSettingsSchema),
  controller.updateGeneralSettings
);

export { tenantRouter };
