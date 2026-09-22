import { Router } from "express";
import { authenticate, idempotency, requireCapability,
  requireCapabilityWhen, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./policy.controller.js";
import { createPolicySchema, evaluatePolicySchema, listPoliciesSchema, policyIdParamsSchema, retentionExecuteSchema, retentionPreviewSchema } from "./policy.schema.js";

const policyRouter = Router();
policyRouter.use(authenticate, tenantContext, idempotency);
policyRouter.post("/evaluate", requireRole("OWNER", "ADMIN", "MEMBER"), validate(evaluatePolicySchema), controller.evaluate);
policyRouter.post("/retention/preview", requireRole("OWNER"), validate(retentionPreviewSchema), controller.previewRetention);
policyRouter.post("/retention/execute", requireRole("OWNER"), validate(retentionExecuteSchema), controller.executeRetention);
policyRouter.get("/", requireCapability("policy.write"), validate(listPoliciesSchema, "query"), controller.list);
// RBAC §2 "Change AI policy": Step-up. Applied to the AI type only — the
// same endpoint writes retention and deletion policy, and demanding a
// fresh password for those would teach people to re-authenticate without
// reading why.
policyRouter.post(
  "/",
  requireCapability("policy.write"),
  validate(createPolicySchema),
  requireCapabilityWhen((req) => (req.body?.type === "AI" ? "policy.ai.write" : null)),
  // The other half of the split the matrix calls out as defining the
  // Owner/Admin boundary: `policy.write` is Admin, `policy.security.write`
  // is Owner. An Admin authors inside a frame the Owner locks — and until
  // this line, authored the frame too.
  requireCapabilityWhen((req) =>
    req.body?.type === "SECURITY" ? "policy.security.write" : null
  ),
  controller.create
);
policyRouter.get("/:policyId", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), controller.get);
policyRouter.post("/:policyId/activate", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), controller.activate);

export { policyRouter };
