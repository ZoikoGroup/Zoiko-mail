import type { Request } from "express";
import { Router } from "express";
import { authenticate, authenticateStaff, requireCapability, requireRole, requireSupportAccess, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { createGrantSchema, domainParamSchema, grantIdSchema, mailboxParamSchema, platformListQuerySchema, tenantParamSchema } from "./support.schema.js";
import { supportService } from "./support.service.js";

export const supportRouter = Router();
supportRouter.use(authenticate, tenantContext);
supportRouter.get("/overview", requireRole("OWNER", "ADMIN", "SUPPORT"), asyncHandler(async (req, res) => {
  const result = await supportService.overview(req.tenantContext!.tenantId);
  sendSuccess(res, 200, result, req.requestId);
}));
supportRouter.get("/diagnostics", asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const grantId = req.header("x-support-grant-id");
  const result = await supportService.diagnostics(grantId, c.tenantId, c.membershipId, c.userId);
  sendSuccess(res, 200, result, req.requestId);
}));
supportRouter.get("/access-grants", requireRole("OWNER", "ADMIN"), asyncHandler(async(req,res)=>{sendSuccess(res,200,{grants:await supportService.list(req.tenantContext!.tenantId)},req.requestId);}));
supportRouter.post("/access-grants", requireRole("OWNER"), validate(createGrantSchema), asyncHandler(async(req,res)=>{const c=req.tenantContext!;sendSuccess(res,201,await supportService.create(req.body,c.tenantId,c.userId),req.requestId);}));
supportRouter.delete("/access-grants/:grantId", requireCapability("support.grant.end"), validate(grantIdSchema,"params"), asyncHandler(async(req,res)=>{const c=req.tenantContext!;sendSuccess(res,200,await supportService.revoke(String(req.params.grantId),c.tenantId,c.userId),req.requestId);}));

// ---------------------------------------------------------------------------
// Platform support console (read-only operational investigation).
// Mounted at /support/platform BEFORE /support so these requests never enter
// supportRouter, which runs tenantContext (requires an ACTIVE membership and
// ACTIVE tenant). Gate is requireSupportAccess (role SUPPORT / platform
// SUPPORT / SUPER_ADMIN) on the signed token claims, authenticated via
// authenticateStaff so both tenant-scoped access tokens and staff platform
// tokens are accepted. Responses stay tenant-scoped to the requested
// resource; privileged data needs a grant.
// ---------------------------------------------------------------------------

type ListQuery = {
  tenantId?: string;
  provider?: string;
  status?: string;
  type?: string;
  q?: string;
  limit: number;
};

function listQuery(req: Request): ListQuery {
  const str = (k: "tenantId" | "provider" | "status" | "type" | "q"): string | undefined => {
    const v = req.query[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  const rawLimit = req.query.limit;
  const limit = typeof rawLimit === "number"
    ? rawLimit
    : typeof rawLimit === "string" && rawLimit.trim() !== ""
      ? (Number(rawLimit) || 50)
      : 50;
  return {
    tenantId: str("tenantId"),
    provider: str("provider"),
    status: str("status"),
    type: str("type"),
    q: str("q"),
    limit: Math.max(1, Math.min(Math.floor(limit), 200)),
  };
}

export const supportPlatformRouter = Router();
supportPlatformRouter.use(authenticateStaff, requireSupportAccess);

supportPlatformRouter.get("/overview", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await supportService.platformOverview(), req.requestId);
}));

supportPlatformRouter.get("/diagnostics", asyncHandler(async (req, res) => {
  const grantId = (req.query.grantId as string | undefined) ?? req.header("x-support-grant-id") ?? undefined;
  const staff = req.staffAuth!;
  const result = await supportService.platformDiagnostics(grantId, staff.userId, staff.platformRole);
  sendSuccess(res, 200, result, req.requestId);
}));

supportPlatformRouter.get("/tenants", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const q = listQuery(req).q ?? "";
  sendSuccess(res, 200, { tenants: await supportService.searchTenants(q, listQuery(req).limit) }, req.requestId);
}));
supportPlatformRouter.get("/tenants/:tenantId", validate(tenantParamSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await supportService.tenantOverview(String(req.params.tenantId)), req.requestId);
}));
supportPlatformRouter.get("/tenants/:tenantId/domains/:domainId", validate(domainParamSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await supportService.domainDetail(String(req.params.tenantId), String(req.params.domainId)), req.requestId);
}));
supportPlatformRouter.get("/tenants/:tenantId/mailboxes/:mailboxId", validate(mailboxParamSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await supportService.mailboxDetail(String(req.params.tenantId), String(req.params.mailboxId)), req.requestId);
}));

supportPlatformRouter.get("/mailboxes", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const q = listQuery(req).q ?? "";
  sendSuccess(res, 200, { mailboxes: await supportService.searchMailboxes(q, listQuery(req).limit) }, req.requestId);
}));
supportPlatformRouter.get("/domains", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const q = listQuery(req).q ?? "";
  sendSuccess(res, 200, { domains: await supportService.searchDomains(q, listQuery(req).limit) }, req.requestId);
}));

supportPlatformRouter.get("/provider-events", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { events: await supportService.listProviderEvents(listQuery(req)) }, req.requestId);
}));
supportPlatformRouter.get("/delivery-events", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { events: await supportService.listDeliveryEvents(listQuery(req)) }, req.requestId);
}));
supportPlatformRouter.get("/jobs", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { jobs: await supportService.listJobs(listQuery(req)) }, req.requestId);
}));
supportPlatformRouter.get("/suppressions", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { suppressions: await supportService.listSuppressions(listQuery(req)) }, req.requestId);
}));
supportPlatformRouter.get("/audit", validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { events: await supportService.listAudit(listQuery(req)) }, req.requestId);
}));

supportPlatformRouter.get("/grants", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { grants: await supportService.listGrants() }, req.requestId);
}));
supportPlatformRouter.delete("/grants/:grantId", validate(grantIdSchema, "params"), asyncHandler(async (req, res) => {
  const staff = req.staffAuth!;
  const updated = await supportService.revokeGrant(String(req.params.grantId), { userId: staff.userId, membershipId: staff.membershipId, platformRole: staff.platformRole });
  sendSuccess(res, 200, updated, req.requestId);
}));
