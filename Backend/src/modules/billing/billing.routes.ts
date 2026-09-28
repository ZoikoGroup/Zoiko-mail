import { Router } from "express";
import {
  authenticate,
  idempotency,
  requireCapability,
  tenantContext,
  validate,
} from "../../common/middleware/index.js";
import * as controller from "./billing.controller.js";
import { checkoutSchema } from "./billing.schema.js";

const billingRouter = Router();
billingRouter.use(authenticate, tenantContext, idempotency);

// Plans and read-only subscription state — any OWNER/ADMIN may view.
/*
 * Billing reads carry `billing.read`, which the matrix gives to Owner and to
 * nobody else: "Owner holds the liability capabilities — billing, export,
 * ownership transfer, deletion — and Admin holds none of them."
 *
 * These three ran on requireRole("OWNER", "ADMIN"), so an Admin could read
 * the plan, the subscription and the invoices. That is not a missing gate,
 * it is the wrong answer — the role list and the matrix disagreed, and the
 * role list was winning.
 */
billingRouter.get("/plans", requireCapability("billing.read"), controller.listPlans);
billingRouter.get(
  "/subscription",
  requireCapability("billing.read"),
  controller.getSubscription
);
billingRouter.get("/invoices", requireCapability("billing.read"), controller.listInvoices);

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
