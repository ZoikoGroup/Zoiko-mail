import type { Request, Response, NextFunction } from "express";
import type { MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";

export async function tenantContext(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.auth) {
    next(new AppError("Authentication required", 401, ErrorCodes.UNAUTHORIZED));
    return;
  }

  // `role` is deliberately NOT taken from the token. Security §7.2 requires the
  // role to be read per request so a demotion takes effect on the caller's next
  // call rather than at their next sign-in; it comes from the membership row below.
  const { sub: userId, tenantId, membershipId } = req.auth;

  const membership = await prisma.tenantMembership.findFirst({
    where: {
      id: membershipId,
      tenantId,
      userId,
      status: "ACTIVE",
    },
    include: {
      tenant: true,
      user: true,
    },
  });

  if (!membership) {
    next(
      new AppError(
        "Active tenant membership not found",
        403,
        ErrorCodes.FORBIDDEN
      )
    );
    return;
  }

  if (membership.tenant.status !== "ACTIVE") {
    next(new AppError("Tenant is not active", 403, ErrorCodes.FORBIDDEN));
    return;
  }

  if (membership.user.status !== "ACTIVE") {
    next(new AppError("User account is disabled", 403, ErrorCodes.FORBIDDEN));
    return;
  }

  // One live workspace per account. Signing into a workspace claims it on the
  // user row and revokes the other workspace's refresh tokens, but an access
  // token already in a tab stays cryptographically valid until it expires —
  // so without this check the workspace the user just left would keep working
  // for up to JWT_ACCESS_EXPIRES_IN.
  //
  // Read from the row that was already loaded above, so this costs no extra
  // query. A null activeTenantId means no sign-in has claimed a workspace yet
  // (sessions predating this rule), and is deliberately allowed through.
  const { activeTenantId } = membership.user;
  if (activeTenantId && activeTenantId !== tenantId) {
    next(
      new AppError(
        "This session ended because you signed into another workspace. Sign in again to come back.",
        401,
        ErrorCodes.SESSION_SUPERSEDED
      )
    );
    return;
  }

  req.tenantContext = {
    tenantId: membership.tenantId,
    userId: membership.userId,
    membershipId: membership.id,
    role: membership.role,
    tenant: membership.tenant,
    user: membership.user,
  };

  next();
}

export function requireRole(...allowedRoles: MembershipRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.tenantContext) {
      next(new AppError("Tenant context required", 403, ErrorCodes.FORBIDDEN));
      return;
    }

    const { role } = req.tenantContext;

    if (role === "SUPPORT" && !allowedRoles.includes("SUPPORT")) {
      next(
        new AppError(
          "Support role access is denied by default",
          403,
          ErrorCodes.FORBIDDEN
        )
      );
      return;
    }

    if (!allowedRoles.includes(role)) {
      next(
        new AppError("Insufficient permissions", 403, ErrorCodes.FORBIDDEN)
      );
      return;
    }

    next();
  };
}
