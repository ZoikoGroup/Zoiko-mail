import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

/**
 * Authorization guard for the PLATFORM support console.
 *
 * The console is platform-wide staff tooling, so it must only accept genuine
 * Zoiko staff — never a tenant-scoped SUPPORT member. A tenant SUPPORT role is
 * an invitation granted by a workspace Owner; it permits read-only diagnostics
 * inside that ONE tenant on /support (tenantRouter), and it must never reach the
 * global console that can search & investigate ANY tenant.
 *
 * Accepts either authentication shape set by `authenticateStaff`:
 *  - access token: ONLY if platformRole is SUPPORT / SUPER_ADMIN (staff who
 *    also happen to hold a tenant membership). A membership role of SUPPORT
 *    alone is NOT staff and is rejected.
 *  - platform token: platformRole SUPPORT / SUPER_ADMIN (Zoiko staff, no tenant).
 *
 * On success it normalizes the caller into req.staffAuth so route handlers and
 * services never branch on the token type.
 *
 * These routes intentionally do NOT run tenantContext: the console is
 * platform-wide, but every response stays tenant-scoped to the requested
 * resource and privileged actions still require an explicit support grant.
 */
export function requireSupportAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.auth) {
    const { sub, membershipId, platformRole } = req.auth;
    // Tenant support access must be exercised through the /support tenant
    // router (which runs tenantContext + requireRole). Here on the platform
    // router only genuine staff rows are let through.
    if (
      platformRole === "SUPPORT" ||
      platformRole === "SUPER_ADMIN"
    ) {
      req.staffAuth = {
        userId: sub,
        platformRole,
        membershipId,
        type: "access",
      };
      next();
      return;
    }
  }

  if (req.platformAuth) {
    req.staffAuth = {
      userId: req.platformAuth.sub,
      platformRole: req.platformAuth.platformRole,
      membershipId: undefined,
      type: "platform",
    };
    next();
    return;
  }

  if (!req.auth && !req.platformAuth) {
    next(new AppError("Authentication required", 401, ErrorCodes.UNAUTHORIZED));
    return;
  }

  next(new AppError("Support console access requires a SUPPORT role", 403, ErrorCodes.FORBIDDEN));
}
