import { Router } from "express";
import { authenticate, requireCapability, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./policy.controller.js";
import { createPolicySchema, evaluatePolicySchema, listPoliciesSchema, policyIdParamsSchema, retentionExecuteSchema, retentionPreviewSchema, updatePolicySchema } from "./policy.schema.js";

const policyRouter = Router();
policyRouter.use(authenticate, tenantContext);
policyRouter.post("/evaluate", requireRole("OWNER", "ADMIN", "MEMBER"), validate(evaluatePolicySchema), controller.evaluate);
policyRouter.post("/retention/preview", requireRole("OWNER"), validate(retentionPreviewSchema), controller.previewRetention);
policyRouter.post("/retention/execute", requireRole("OWNER"), validate(retentionExecuteSchema), controller.executeRetention);
policyRouter.get("/", requireCapability("policy.write"), validate(listPoliciesSchema, "query"), controller.list);
policyRouter.post("/", requireCapability("policy.write"), validate(createPolicySchema), controller.create);
policyRouter.get("/:policyId", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), controller.get);
policyRouter.patch("/:policyId", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), validate(updatePolicySchema), controller.update);
policyRouter.post("/:policyId/activate", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), controller.activate);
policyRouter.post("/:policyId/deactivate", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), controller.deactivate);
policyRouter.delete("/:policyId", requireCapability("policy.write"), validate(policyIdParamsSchema, "params"), controller.remove);

export { policyRouter };
