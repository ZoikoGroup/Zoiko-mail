import { Router } from "express";
import { authenticate, authenticateStaff, requireSupportAccess, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import {
  createStaffTicketSchema,
  createTenantTicketSchema,
  createTicketCommentSchema,
  ticketIdParamSchema,
  ticketListQuerySchema,
  updateTicketSchema,
} from "./ticket.schema.js";
import { ticketService } from "./ticket.service.js";

/**
 * Tenant-facing ticket routes. Mounted at /support/tickets BEFORE the generic
 * /support router so tenantContext applies and every ACTIVE member may open a
 * ticket regardless of role; MEMBERs only ever see their own, while
 * OWNER/ADMIN/SUPPORT see the tenant's whole board.
 */
export const ticketRouter = Router();
ticketRouter.use(authenticate, tenantContext);

ticketRouter.get("/", validate(ticketListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const q = req.query;
  const result = await ticketService.listTenant(
    { kind: "tenant", tenantId: c.tenantId, userId: c.userId, membershipId: c.membershipId, role: c.role, platformRole: c.user.platformRole },
    {
      status: typeof q.status === "string" && q.status.trim() ? (q.status as never) : undefined,
      q: typeof q.q === "string" ? q.q : undefined,
      limit: typeof q.limit === "string" && q.limit.trim() ? Number(q.limit) : 50,
    },
  );
  sendSuccess(res, 200, result, req.requestId);
}));

ticketRouter.post("/", validate(createTenantTicketSchema), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const result = await ticketService.createTenant(
    req.body,
    { kind: "tenant", tenantId: c.tenantId, userId: c.userId, membershipId: c.membershipId, role: c.role, platformRole: c.user.platformRole },
  );
  sendSuccess(res, 201, result, req.requestId);
}));

ticketRouter.get("/:ticketId", validate(ticketIdParamSchema, "params"), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const result = await ticketService.getTenantTicket(
    String(req.params.ticketId),
    { kind: "tenant", tenantId: c.tenantId, userId: c.userId, membershipId: c.membershipId, role: c.role, platformRole: c.user.platformRole },
  );
  sendSuccess(res, 200, result, req.requestId);
}));

ticketRouter.post("/:ticketId/comments", validate(ticketIdParamSchema, "params"), validate(createTicketCommentSchema), asyncHandler(async (req, res) => {
  const c = req.tenantContext!;
  const result = await ticketService.commentTenant(
    String(req.params.ticketId),
    req.body.body,
    { kind: "tenant", tenantId: c.tenantId, userId: c.userId, membershipId: c.membershipId, role: c.role, platformRole: c.user.platformRole },
  );
  sendSuccess(res, 201, result, req.requestId);
}));

/**
 * Staff-facing ticket routes. Mounted at /support/platform/tickets BEFORE the
 * generic /support/platform router. Only genuine platform staff reach these
 * (authenticateStaff + requireSupportAccess).
 */
export const ticketPlatformRouter = Router();
ticketPlatformRouter.use(authenticateStaff, requireSupportAccess);

ticketPlatformRouter.get("/", validate(ticketListQuerySchema, "query"), asyncHandler(async (req, res) => {
  const staff = req.staffAuth!;
  const q = req.query;
  const assigned = typeof q.assigned === "string" ? q.assigned : undefined;
  let result;
  if (assigned === "me") {
    result = await ticketService.listPlatformMine({ kind: "staff", userId: staff.userId, platformRole: staff.platformRole, membershipId: staff.membershipId });
  } else {
    result = await ticketService.listPlatform({
      tenantId: typeof q.tenantId === "string" && q.tenantId.trim() ? q.tenantId : undefined,
      status: typeof q.status === "string" && q.status.trim() ? (q.status as never) : undefined,
      severity: typeof q.severity === "string" && q.severity.trim() ? (q.severity as never) : undefined,
      assigned,
      overdue: (q as { overdue?: unknown }).overdue === true,
      q: typeof q.q === "string" ? q.q : undefined,
      limit: typeof q.limit === "string" && q.limit.trim() ? Number(q.limit) : 50,
    });
  }
  sendSuccess(res, 200, result, req.requestId);
}));

ticketPlatformRouter.get("/staff", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await ticketService.listStaff(), req.requestId);
}));

ticketPlatformRouter.get("/:ticketId", validate(ticketIdParamSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await ticketService.getPlatformTicket(String(req.params.ticketId)), req.requestId);
}));

ticketPlatformRouter.post("/", validate(createStaffTicketSchema), asyncHandler(async (req, res) => {
  const staff = req.staffAuth!;
  const result = await ticketService.createPlatform(req.body, { kind: "staff", userId: staff.userId, platformRole: staff.platformRole, membershipId: staff.membershipId });
  sendSuccess(res, 201, result, req.requestId);
}));

ticketPlatformRouter.patch("/:ticketId", validate(ticketIdParamSchema, "params"), validate(updateTicketSchema), asyncHandler(async (req, res) => {
  const staff = req.staffAuth!;
  const result = await ticketService.updatePlatform(String(req.params.ticketId), req.body, { kind: "staff", userId: staff.userId, platformRole: staff.platformRole, membershipId: staff.membershipId });
  sendSuccess(res, 200, result, req.requestId);
}));

ticketPlatformRouter.post("/:ticketId/comments", validate(ticketIdParamSchema, "params"), validate(createTicketCommentSchema), asyncHandler(async (req, res) => {
  const staff = req.staffAuth!;
  const result = await ticketService.commentPlatform(
    String(req.params.ticketId),
    req.body.body,
    Boolean(req.body.internal),
    { kind: "staff", userId: staff.userId, platformRole: staff.platformRole, membershipId: staff.membershipId },
  );
  sendSuccess(res, 201, result, req.requestId);
}));