import type { NextFunction, Request, Response } from "express";

import { prisma } from "../../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { auditService } from "../../modules/audit/audit.service.js";
import { SYSTEM_TENANT_ID } from "../../modules/auth/auth.types.js";

/**
 * The two controls Runbook §7 asks of the platform support console, applied
 * where every request passes rather than inside nineteen service methods.
 *
 *   Audit    "Every access attempt, grant, use, and expiry must create audit
 *            events" — and §8 sets audit completeness at 100% for support
 *            events. Five of nineteen support reads recorded anything, so a
 *            staff member could page through every workspace's mailboxes,
 *            domains, audit trail and delivery history and leave no trace.
 *
 *   Grants   "Zoiko support has no default right"; "any elevated support
 *            access must have an expiry". Only /diagnostics asked for a
 *            grant. Everything tenant-specific beside it was standing access
 *            for anyone holding a staff row.
 *
 * Doing this in middleware rather than per service method is deliberate. The
 * gap was not that someone forgot one call — it is that the rule lived in
 * nineteen places and was written in two of them. One place can be read, and
 * a new route inherits it instead of having to remember it.
 */

/**
 * Where a tenant id can appear on a platform support request.
 *
 * Read out of the path rather than req.params, because router-level
 * middleware runs before Express has matched a route and populated them —
 * so a gate that trusted req.params saw nothing on /tenants/:tenantId and
 * waved through exactly the reads it exists to stop. The access log runs from
 * a finish handler, by which time params *are* populated, which is why the
 * logging looked right while the gate silently did nothing.
 */
const TENANT_IN_PATH = /^\/tenants\/([0-9a-fA-F-]{36})(?:\/|$)/;

function tenantIdOf(req: Request): string | undefined {
  const inPath = TENANT_IN_PATH.exec(req.path);
  if (inPath?.[1]) return inPath[1];
  const fromParams = req.params?.tenantId;
  if (typeof fromParams === "string" && fromParams.trim() !== "") return fromParams.trim();
  const fromQuery = req.query?.tenantId;
  if (typeof fromQuery === "string" && fromQuery.trim() !== "") return fromQuery.trim();
  return undefined;
}

/**
 * An active grant naming this staff member for this workspace.
 *
 * Matched through the SUPPORT membership the grant was approved for, which is
 * how platformDiagnostics has always matched them — a Zoiko support person holds a
 * SUPPORT seat in the workspace, and the Owner approves a grant against it.
 */
async function activeGrantFor(userId: string, tenantId: string) {
  return prisma.supportAccessGrant.findFirst({
    where: {
      tenantId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      supportMembership: { userId },
    },
    select: { id: true, reason: true, ticketId: true, scopes: true, expiresAt: true },
  });
}

/**
 * Refuse a tenant-scoped read without an active grant for that tenant.
 *
 * SUPER_ADMIN passes without one, because §7 allows break-glass — but it is
 * recorded as break-glass rather than as ordinary access, so "reviewed after
 * use" has something to review. A refusal is audited too: an attempt is one
 * of the four things §7 names, and it is the one worth seeing.
 */
export async function requireTenantGrant(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const staff = req.staffAuth;
  if (!staff) {
    next(new AppError("Support console access required", 403, ErrorCodes.FORBIDDEN));
    return;
  }

  const tenantId = tenantIdOf(req);
  // No tenant named: this is a platform-wide read, covered by the access log
  // rather than by a grant. Narrowing to one workspace is what needs approval.
  if (!tenantId) {
    next();
    return;
  }

  try {
    const grant = await activeGrantFor(staff.userId, tenantId);
    if (grant) {
      req.supportGrant = { id: grant.id, ticketId: grant.ticketId, breakGlass: false };
      next();
      return;
    }

    if (staff.platformRole === "SUPER_ADMIN") {
      req.supportGrant = { id: null, ticketId: null, breakGlass: true };
      next();
      return;
    }

    await auditService.record({
      tenantId,
      actorUserId: staff.userId,
      actorType: "SUPPORT",
      eventType: "SUPPORT_ACCESS_DENIED",
      targetType: "Tenant",
      targetId: tenantId,
      requestId: req.requestId,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? undefined,
      metadata: { path: req.originalUrl.split("?")[0], method: req.method },
    });

    next(
      new AppError(
        "Reading this workspace needs an active support access grant. Ask the workspace owner to approve one.",
        403,
        ErrorCodes.FORBIDDEN
      )
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Record what support looked at, once the read has actually succeeded.
 *
 * Hung off the response rather than run before the handler, so the log says
 * what was served rather than what was asked for — a 404 or a validation
 * failure is not an access. The write is fire-and-forget on purpose: an audit
 * failure must not turn a successful read into an error for the person using
 * the console, and the error is logged where it can be seen.
 */
export function logSupportAccess(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const staff = req.staffAuth;
    if (!staff) return;

    const tenantId = tenantIdOf(req);
    const grant = req.supportGrant;

    void auditService
      .record({
        // Platform-wide reads belong to no workspace, so they are recorded
        // against the system tenant rather than dropped.
        tenantId: tenantId ?? SYSTEM_TENANT_ID,
        actorUserId: staff.userId,
        actorType: "SUPPORT",
        eventType: grant?.breakGlass ? "SUPPORT_BREAK_GLASS_ACCESS" : "SUPPORT_ACCESS_USED",
        targetType: tenantId ? "Tenant" : "Platform",
        targetId: tenantId ?? null,
        requestId: req.requestId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
        metadata: {
          path: req.originalUrl.split("?")[0],
          method: req.method,
          platformRole: staff.platformRole,
          grantId: grant?.id ?? null,
          ticketId: grant?.ticketId ?? null,
          ...(grant?.breakGlass ? { breakGlass: true } : {}),
        },
      })
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.error("support access audit failed", error);
      });
  });
  next();
}
