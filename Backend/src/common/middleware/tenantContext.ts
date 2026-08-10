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

  const { sub: userId, tenantId, membershipId, role } = req.auth;

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
