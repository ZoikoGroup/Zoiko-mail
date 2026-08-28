import { Router } from "express";
import {
  authenticate,
  requireCapability,
  requireRole,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import * as controller from "./billing.controller.js";
import { checkoutSchema } from "./billing.schema.js";

const billingRouter = Router();
billingRouter.use(authenticate, tenantContext);

// Plans and read-only subscription state — any OWNER/ADMIN may view.
billingRouter.get("/plans", requireRole("OWNER", "ADMIN"), controller.listPlans);
billingRouter.get(
  "/subscription",
  requireRole("OWNER", "ADMIN"),
  controller.getSubscription
);
billingRouter.get("/invoices", requireRole("OWNER", "ADMIN"), controller.listInvoices);

// Mutations are Owner-only (billing.plan.write is OWNER-only in the matrix).
billingRouter.post(
  "/checkout",
  requireCapability("billing.plan.write"),
  validate(checkoutSchema),
  controller.createCheckout
);
billingRouter.get(
  "/portal",
  requireCapability("billing.plan.write"),
  controller.getPortalUrl
);
billingRouter.post(
  "/cancel",
  requireCapability("billing.plan.write"),
  controller.cancel
);
billingRouter.patch(
  "/reactivate",
  requireCapability("billing.plan.write"),
  controller.reactivate
);

// NOTE: POST /billing/webhook is mounted in app.ts with express.raw BEFORE the
// global JSON parser so the raw body is available for signature verification.

export { billingRouter };
