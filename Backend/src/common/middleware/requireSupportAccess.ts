import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

/**
 * Authorization guard for the platform support console.
 *
 * Accepts either authentication shape set by `authenticateStaff`:
 *  - access token: membership role SUPPORT, or platformRole SUPPORT / SUPER_ADMIN
 *  - platform token: platformRole SUPPORT / SUPER_ADMIN (Zoiko staff, no tenant)
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
    const { sub, membershipId, role, platformRole } = req.auth;
    if (
      role === "SUPPORT" ||
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
