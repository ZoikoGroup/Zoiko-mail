import { Router } from "express";
import {
  authenticate,
  idempotency,
  requireCapability,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import {
  securityAlertParamsSchema,
  securityAlertQuerySchema,
  securityAlertRemediationSchema,
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

// Containment from an alert (P1, ZMT-19). Same capability as review — it is
// the responder's half — plus an idempotency key, since it signs people out
// and suspends rules and a retried click must not do either twice.
securityAlertRouter.post(
  "/:alertId/remediate",
  requireCapability("security-alert.review"),
  idempotency,
  validate(securityAlertParamsSchema, "params"),
  validate(securityAlertRemediationSchema),
  controller.remediateAlert
);

export { securityAlertRouter };