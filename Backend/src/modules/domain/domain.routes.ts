import { Router } from "express";
import { authenticate, idempotency, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { addDomainSchema, domainIdSchema, listQuerySchema } from "./domain.schema.js";
import { domainService } from "./domain.service.js";
export const domainRouter = Router();
domainRouter.use(authenticate, tenantContext, requireCapability("workspace.domains.manage"), idempotency);
domainRouter.get("/", validate(listQuerySchema, "query"), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { limit?: number; cursor?: string };
  const page = await domainService.list(req.tenantContext!.tenantId, q);
  sendSuccess(res, 200, { domains: page.items, nextCursor: page.nextCursor }, req.requestId);
}));
domainRouter.post("/", validate(addDomainSchema), asyncHandler(async (req, res) => { sendSuccess(res, 201, await domainService.add(req.body.domainName, req.tenantContext!.tenantId, req.tenantContext!.userId), req.requestId); }));
domainRouter.post("/:domainId/diagnostics", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => { sendSuccess(res, 200, await domainService.diagnostics(String(req.params.domainId), req.tenantContext!.tenantId, req.tenantContext!.userId), req.requestId); }));
domainRouter.get("/:domainId/checks", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => { sendSuccess(res, 200, { checks: await domainService.listChecks(String(req.params.domainId), req.tenantContext!.tenantId) }, req.requestId); }));
domainRouter.post("/:domainId/activate", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => { sendSuccess(res, 200, await domainService.activate(String(req.params.domainId), req.tenantContext!.tenantId, req.tenantContext!.userId), req.requestId); }));
// Removing a domain is destructive and step-up per RBAC §2; adding and
// verifying one are not, which is why the capability is split rather than
// the whole router being raised.
domainRouter.delete("/:domainId", requireCapability("workspace.domains.remove"), validate(domainIdSchema, "params"), asyncHandler(async (req, res) => { sendSuccess(res, 200, await domainService.remove(String(req.params.domainId), req.tenantContext!.tenantId, req.tenantContext!.userId), req.requestId); }));
