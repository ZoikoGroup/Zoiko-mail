import { Router, type Request } from "express";
import { authenticate, idempotency, requireCapability, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import {
  addDomainSchema,
  connectProviderSchema,
  credentialIdSchema,
  domainIdSchema,
  listQuerySchema,
  updateDomainSchema,
} from "./domain.schema.js";
import { domainService } from "./domain.service.js";
import { dnsProviderService } from "./dns-provider.service.js";

export const domainRouter = Router();
domainRouter.use(authenticate, tenantContext, requireCapability("workspace.domains.manage"), idempotency);

const ctx = (req: Request) => ({
  tenantId: req.tenantContext!.tenantId,
  userId: req.tenantContext!.userId,
  requestId: req.requestId,
});
const domainId = (req: Request) => String(req.params.domainId);

domainRouter.get("/", validate(listQuerySchema, "query"), asyncHandler(async (req, res) => {
  const q = req.query as unknown as { limit?: number; cursor?: string };
  const page = await domainService.list(req.tenantContext!.tenantId, q);
  sendSuccess(res, 200, { domains: page.items, nextCursor: page.nextCursor }, req.requestId);
}));
domainRouter.post("/", validate(addDomainSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await domainService.add(req.body, ctx(req)), req.requestId);
}));

// ── DNS provider credentials ────────────────────────────────────────────────
// Declared before /:domainId so "dns-providers" is never read as an id.
//
// Storing or removing an API credential for a customer's DNS host is gated
// on connector.credentials.rotate — RBAC §2 "Rotate provider credentials",
// Step-up. It is the same act: handing the platform, or taking back, a
// credential that writes to a system outside it.
domainRouter.get("/dns-providers", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { credentials: await dnsProviderService.list(req.tenantContext!.tenantId) }, req.requestId);
}));
domainRouter.post("/dns-providers", requireCapability("connector.credentials.rotate"), validate(connectProviderSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await dnsProviderService.connect(req.body, ctx(req)), req.requestId);
}));
domainRouter.post("/dns-providers/:credentialId/verify", validate(credentialIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await dnsProviderService.revalidate(String(req.params.credentialId), ctx(req)), req.requestId);
}));
domainRouter.delete("/dns-providers/:credentialId", requireCapability("connector.credentials.rotate"), validate(credentialIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await dnsProviderService.remove(String(req.params.credentialId), ctx(req)), req.requestId);
}));

// ── one domain ──────────────────────────────────────────────────────────────
domainRouter.get("/:domainId", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.get(domainId(req), req.tenantContext!.tenantId), req.requestId);
}));
domainRouter.patch("/:domainId", validate(domainIdSchema, "params"), validate(updateDomainSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.updateConfig(domainId(req), req.body, ctx(req)), req.requestId);
}));
domainRouter.get("/:domainId/records", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  const domain = await domainService.get(domainId(req), req.tenantContext!.tenantId);
  sendSuccess(res, 200, { records: domain.records, readiness: domain.readiness }, req.requestId);
}));
domainRouter.get("/:domainId/zone-file", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  const { domainName, content } = await domainService.zoneFile(domainId(req), req.tenantContext!.tenantId);
  // attachment() first: it sets the type from the ".zone" extension, which
  // Express does not know, and would otherwise overwrite text/plain.
  res.attachment(`${domainName}.zone`).type("text/plain").send(content);
}));
domainRouter.post("/:domainId/diagnostics", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.diagnostics(domainId(req), ctx(req)), req.requestId);
}));
domainRouter.post("/:domainId/publish", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.publish(domainId(req), ctx(req)), req.requestId);
}));
domainRouter.post("/:domainId/dkim/rotate", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.rotateDkim(domainId(req), ctx(req)), req.requestId);
}));
domainRouter.get("/:domainId/checks", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { checks: await domainService.listChecks(domainId(req), req.tenantContext!.tenantId) }, req.requestId);
}));
domainRouter.post("/:domainId/activate", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.activate(domainId(req), ctx(req)), req.requestId);
}));
domainRouter.post("/:domainId/deactivate", validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.deactivate(domainId(req), ctx(req)), req.requestId);
}));
// Removing a domain is destructive and step-up per RBAC §2; adding and
// verifying one are not, which is why the capability is split rather than
// the whole router being raised.
domainRouter.delete("/:domainId", requireCapability("workspace.domains.remove"), validate(domainIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await domainService.remove(domainId(req), ctx(req)), req.requestId);
}));
