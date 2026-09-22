import { Router } from "express";
import {
  authenticate,
  requireCapability,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import {
  securityAlertParamsSchema,
  securityAlertQuerySchema,
  securityAlertReviewSchema,
} from "./security-alert.schema.js";
import * as controller from "./security-alert.controller.js";

const securityAlertRouter = Router();

// Read is for everyone who can see the audit log; review (acknowledge,
// resolve, dismiss) is the mutation half and needs its own capability.
securityAlertRouter.use(
  "/",
  authenticate,
  tenantContext,
  requireCapability("security-alert.read")
);

securityAlertRouter.get("/", validate(securityAlertQuerySchema, "query"), controller.listAlerts);

securityAlertRouter.get(
  "/:alertId",
  validate(securityAlertParamsSchema, "params"),
  controller.getAlert
);

securityAlertRouter.post(
  "/:alertId/review",
  requireCapability("security-alert.review"),
  validate(securityAlertParamsSchema, "params"),
  validate(securityAlertReviewSchema),
  controller.reviewAlert
);

export { securityAlertRouter };