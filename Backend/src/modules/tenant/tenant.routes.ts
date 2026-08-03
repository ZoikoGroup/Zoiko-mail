import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./tenant.controller.js";
import { updateTenantSchema } from "./tenant.schema.js";

const tenantRouter = Router();
tenantRouter.use(authenticate, tenantContext);
tenantRouter.get("/current", requireRole("OWNER", "ADMIN", "MEMBER"), controller.getCurrent);
tenantRouter.patch(
  "/current",
  requireRole("OWNER", "ADMIN"),
  validate(updateTenantSchema),
  controller.updateCurrent
);

export { tenantRouter };
