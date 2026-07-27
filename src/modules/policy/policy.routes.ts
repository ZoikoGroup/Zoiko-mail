import { Router } from "express";
import { authenticate, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import * as controller from "./policy.controller.js";
import { createPolicySchema, evaluatePolicySchema, listPoliciesSchema, policyIdParamsSchema, retentionExecuteSchema, retentionPreviewSchema } from "./policy.schema.js";

const policyRouter = Router();
policyRouter.use(authenticate, tenantContext);
policyRouter.post("/evaluate", requireRole("OWNER", "ADMIN", "MEMBER"), validate(evaluatePolicySchema), controller.evaluate);
policyRouter.post("/retention/preview", requireRole("OWNER"), validate(retentionPreviewSchema), controller.previewRetention);
policyRouter.post("/retention/execute", requireRole("OWNER"), validate(retentionExecuteSchema), controller.executeRetention);
policyRouter.get("/", requireRole("OWNER", "ADMIN"), validate(listPoliciesSchema, "query"), controller.list);
policyRouter.post("/", requireRole("OWNER", "ADMIN"), validate(createPolicySchema), controller.create);
policyRouter.get("/:policyId", requireRole("OWNER", "ADMIN"), validate(policyIdParamsSchema, "params"), controller.get);
policyRouter.post("/:policyId/activate", requireRole("OWNER", "ADMIN"), validate(policyIdParamsSchema, "params"), controller.activate);

export { policyRouter };
