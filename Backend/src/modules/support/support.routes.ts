import type { Request } from "express";
import type { MailFolder } from "@prisma/client";
import { Router } from "express";
import { authenticate, idempotency, authenticateStaff, requireCapability, requireRole, requireSupportAccess, requireTenantGrant, logSupportAccess, logTenantSupportAccess, tenantContext, validate, crossTenantScope} from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { createGrantSchema, domainParamSchema, grantIdSchema, mailboxParamSchema, platformListQuerySchema, tenantParamSchema, requestAccessSchema, approveRequestSchema, denyRequestSchema, requestIdSchema, listRequestsSchema, mailboxMessagesParamsSchema, mailboxMessagesQuerySchema } from "./support.schema.js";
import { supportService } from "./support.service.js";

export const supportRouter = Router();
supportRouter.use(authenticate, tenantContext, idempotency, logTenantSupportAccess);
supportRouter.get("/overview", requireCapability("support.console.read"), asyncHandler(async (req, res) => {
  const result = await supportService.overview(req.tenantContext!.tenantId);
  sendSuccess(res, 200, result, req.requestId);
}));
supportRouter.get("/diagnostics", asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const grantId = req.header("x-support-grant-id");
  const result = await supportService.diagnostics(grantId, c.tenantId, c.membershipId, c.userId);
  sendSuccess(res, 200, result, req.requestId);
}));
supportRouter.get("/access-grants", requireCapability("support.grant.read"), asyncHandler(async(req,res)=>{sendSuccess(res,200,{grants:await supportService.list(req.tenantContext!.tenantId)},req.requestId);}));
supportRouter.post("/access-grants", requireCapability("support.grant.create"), validate(createGrantSchema), asyncHandler(async(req,res)=>{const c=req.tenantContext!;sendSuccess(res,201,await supportService.create(req.body,c.tenantId,c.userId),req.requestId);}));
supportRouter.delete("/access-grants/:grantId", requireCapability("support.grant.end"), validate(grantIdSchema,"params"), asyncHandler(async(req,res)=>{const c=req.tenantContext!;sendSuccess(res,200,await supportService.revoke(String(req.params.grantId),c.tenantId,c.userId),req.requestId);}));

// ---------------------------------------------------------------------------
// Tenant-scoped read lists for the support console.
//
// A workspace SUPPORT member (or an OWNER/ADMIN reading the same surface)
// needs the same sections as the staff console — mailboxes, domains,
// provider events, delivery events, jobs, suppressions and audit — but scoped
// to their OWN tenant. These routes reuse the platform service functions with
// tenantId forced from the session; the client can never pick another tenant,
// so there is no cross-tenant read even if a caller tampers with query params.
// ---------------------------------------------------------------------------

function tenantListQuery(req: Request): {
  provider?: string;
  status?: string;
  type?: string;
  q?: string;
  limit: number;
} {
  const str = (k: "provider" | "status" | "type" | "q"): string | undefined => {
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
    provider: str("provider"),
    status: str("status"),
    type: str("type"),
    q: str("q"),
    limit: Math.max(1, Math.min(Math.floor(limit), 200)),
  };
}

/* ── asking for access, and deciding on it — Runbook §7 ─────────────────
 *
 * The request endpoint is the one thing here a SUPPORT seat may reach with no
 * grant, because it is how a grant comes to exist. Everything else on this
 * router already needs `support.console.read`, which is GRANT for Support —
 * so without this, a support member holding no grant could not ask for one.
 *
 * Approving carries `support.grant.create`: STEP_UP and Owner-only, matching
 * RBAC §2 ("Approve support access: Owner Yes, Admin No"). Denying carries
 * `support.grant.end`, which Admin holds too — refusing access is not the
 * same decision as opening it.
 */
supportRouter.post(
  "/access-requests",
  requireRole("SUPPORT"),
  validate(requestAccessSchema),
  asyncHandler(async (req, res) => {
    const c = req.tenantContext!;
    sendSuccess(
      res,
      201,
      await supportService.requestAccess(req.body, c.tenantId, c.membershipId, c.userId),
      req.requestId
    );
  })
);

supportRouter.get(
  "/access-requests",
  requireCapability("support.grant.read"),
  validate(listRequestsSchema, "query"),
  asyncHandler(async (req, res) => {
    const status = (req.query as { status?: "PENDING" | "APPROVED" | "DENIED" | "WITHDRAWN" }).status;
    sendSuccess(
      res,
      200,
      { requests: await supportService.listRequests(req.tenantContext!.tenantId, status) },
      req.requestId
    );
  })
);

supportRouter.post(
  "/access-requests/:requestId/approve",
  requireCapability("support.grant.create"),
  validate(requestIdSchema, "params"),
  validate(approveRequestSchema),
  asyncHandler(async (req, res) => {
    const c = req.tenantContext!;
    sendSuccess(
      res,
      200,
      await supportService.approveRequest(
        String(req.params.requestId),
        c.tenantId,
        c.userId,
        (req.body as { minutes?: number }).minutes
      ),
      req.requestId
    );
  })
);

supportRouter.post(
  "/access-requests/:requestId/deny",
  requireCapability("support.grant.end"),
  validate(requestIdSchema, "params"),
  validate(denyRequestSchema),
  asyncHandler(async (req, res) => {
    const c = req.tenantContext!;
    sendSuccess(
      res,
      200,
      await supportService.denyRequest(
        String(req.params.requestId),
        c.tenantId,
        c.userId,
        (req.body as { note?: string }).note
      ),
      req.requestId
    );
  })
);

supportRouter.post(
  "/access-requests/:requestId/withdraw",
  requireRole("SUPPORT"),
  validate(requestIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const c = req.tenantContext!;
    sendSuccess(
      res,
      200,
      await supportService.withdrawRequest(String(req.params.requestId), c.tenantId, c.membershipId, c.userId),
      req.requestId
    );
  })
);

supportRouter.get("/tenant", requireCapability("support.console.read"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await supportService.tenantOverview(req.tenantContext!.tenantId), req.requestId);
}));

/**
 * RBAC §2 "View tenant configuration" — how the workspace is set up, as
 * opposed to /tenant, which is what it contains. Same capability, because
 * both are the console read that Support holds only as a grant.
 */
supportRouter.get("/configuration", requireCapability("support.console.read"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await supportService.tenantConfiguration(req.tenantContext!.tenantId), req.requestId);
}));

/**
 * RBAC §2 "Read private user mailbox" — the one route in the platform that
 * reaches a member's own mail, and the only capability in the matrix that
 * allows it. `mail.other.read` is GRANT for Support and held by nobody else
 * in any form, so an Owner calling this is refused as firmly as a stranger.
 * The service adds the second condition the capability cannot express: the
 * live grant has to carry MAIL_CONTENT.
 */
supportRouter.get(
  "/mailboxes/:mailboxId/messages",
  requireCapability("mail.other.read"),
  validate(mailboxMessagesParamsSchema, "params"),
  validate(mailboxMessagesQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const c = req.tenantContext!;
    const q = req.query as { folder?: MailFolder; q?: string; limit?: number };
    sendSuccess(
      res,
      200,
      await supportService.mailboxMessages({
        tenantId: c.tenantId,
        mailboxId: String(req.params.mailboxId),
        actorUserId: c.userId,
        folder: q.folder,
        q: q.q,
        limit: q.limit,
      }),
      req.requestId
    );
  })
);
supportRouter.get("/mailboxes", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const q = tenantListQuery(req).q ?? "";
  sendSuccess(res, 200, { mailboxes: await supportService.searchMailboxes(q, tenantListQuery(req).limit, c.tenantId) }, req.requestId);
}));
supportRouter.get("/domains", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const q = tenantListQuery(req).q ?? "";
  sendSuccess(res, 200, { domains: await supportService.searchDomains(q, tenantListQuery(req).limit, c.tenantId) }, req.requestId);
}));
supportRouter.get("/provider-events", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const f = tenantListQuery(req);
  sendSuccess(res, 200, { events: await supportService.listProviderEvents({ tenantId: c.tenantId, provider: f.provider, status: f.status, q: f.q, limit: f.limit }) }, req.requestId);
}));
supportRouter.get("/delivery-events", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const f = tenantListQuery(req);
  sendSuccess(res, 200, { events: await supportService.listDeliveryEvents({ tenantId: c.tenantId, type: f.type, q: f.q, limit: f.limit }) }, req.requestId);
}));
supportRouter.get("/jobs", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const f = tenantListQuery(req);
  sendSuccess(res, 200, { jobs: await supportService.listJobs({ tenantId: c.tenantId, type: f.type, status: f.status, q: f.q, limit: f.limit }) }, req.requestId);
}));
supportRouter.get("/suppressions", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const f = tenantListQuery(req);
  sendSuccess(res, 200, { suppressions: await supportService.listSuppressions({ tenantId: c.tenantId, status: f.status, limit: f.limit }) }, req.requestId);
}));
supportRouter.get("/audit", requireCapability("support.console.read"), validate(platformListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const f = tenantListQuery(req);
  sendSuccess(res, 200, { events: await supportService.listAudit({ tenantId: c.tenantId, q: f.q, limit: f.limit }) }, req.requestId);
}));

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
// The platform console reads across every workspace by design (AC-006), so it
// declares that rather than being refused by the row-level policies.
//
// logSupportAccess writes an audit row for every read that succeeds, and
// requireTenantGrant refuses any read narrowed to one workspace unless an
// active, unexpired grant names this staff member for it (Runbook §7). Both
// sit on the router rather than on each route so a new endpoint inherits them
// instead of having to remember them — which is how eleven of these reads came
// to be unaudited and ungated in the first place.
//
// Order matters: the log reads req.supportGrant, so the gate runs first, and
// the log itself is registered before either so its finish handler is attached
// even for a request the gate refuses.
supportPlatformRouter.use(
  crossTenantScope,
  authenticateStaff,
  requireSupportAccess,
  logSupportAccess,
  requireTenantGrant
);

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
