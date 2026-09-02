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

  // One live workspace per account, enforced on every request.
  //
  // Access tokens are stateless: signing out or signing into another workspace
  // revokes refresh tokens, but the token already in a tab stays
  // cryptographically valid until it expires. Nothing but a server-side check
  // can stop it, so this is that check, and it is deliberately strict —
  // the claim must name *this* tenant, and anything else is refused:
  //
  //   - a different tenant: a newer sign-in moved the claim, so this token
  //     belongs to a workspace the user has left.
  //   - null: the claim was released by signing out. Treating null as
  //     "unclaimed, allow" would have let a signed-out access token keep
  //     working until it expired, which is the hole this closes.
  //
  // Read from the user row the membership query already loaded, so it costs
  // no extra query. Sessions issued before claiming existed have no claim and
  // are refused too; those users sign in once more and are then unaffected.
  const { activeTenantId } = membership.user;
  if (activeTenantId !== tenantId) {
    next(
      new AppError(
        activeTenantId
          ? "This session ended because you signed into another workspace. Sign in again to come back."
          : "This session has ended. Please sign in again.",
        401,
        // The same code for both: in each case this token is no longer the
        // account's current session, and the client must stop trying to
        // refresh it and send the user to sign in.
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
