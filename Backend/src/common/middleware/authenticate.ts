import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import type { AccessTokenPayload, PlatformTokenPayload } from "../types/jwt.js";
import type { PlatformRole } from "@prisma/client";

const roles = new Set(["OWNER", "ADMIN", "MEMBER", "SUPPORT"]);
const platformRoles = new Set<PlatformRole>(["SUPPORT", "SUPER_ADMIN"]);

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    typeof payload.tenantId === "string" &&
    typeof payload.membershipId === "string" &&
    typeof payload.role === "string" &&
    roles.has(payload.role) &&
    payload.type === "access"
  );
}

function isPlatformTokenPayload(value: unknown): value is PlatformTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    typeof payload.platformRole === "string" &&
    platformRoles.has(payload.platformRole as PlatformRole) &&
    payload.type === "platform"
  );
}

function extractBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Tenant-scoped authentication. Populates req.auth from an access token.
 * Use for the customer/tenant surface (mail, memberships, etc.).
 */
export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);

  if (!token) {
    next(new AppError("Authentication required", 401, ErrorCodes.UNAUTHORIZED));
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);

    if (!isAccessTokenPayload(decoded)) {
      next(new AppError("Invalid access token", 401, ErrorCodes.TOKEN_INVALID));
      return;
    }

    req.auth = {
      sub: decoded.sub,
      tenantId: decoded.tenantId,
      membershipId: decoded.membershipId,
      role: decoded.role,
      // Older tokens minted before Phase 4 may lack platformRole; default NONE.
      platformRole: decoded.platformRole ?? "NONE",
      type: decoded.type,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError("Access token expired", 401, ErrorCodes.TOKEN_EXPIRED));
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError("Invalid access token", 401, ErrorCodes.TOKEN_INVALID));
      return;
    }

    next(error);
  }
}

/**
 * Platform-scoped authentication for Zoiko staff (Support / Super-admin).
 * Populates req.platformAuth from a "platform" token. These sessions carry
 * no tenant, so tenant middleware (tenantContext/requireRole) must NOT be
 * used on staff routes — gate them with requirePlatformRole instead.
 */
export function authenticatePlatform(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);

  if (!token) {
    next(new AppError("Platform authentication required", 401, ErrorCodes.UNAUTHORIZED));
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);

    if (!isPlatformTokenPayload(decoded)) {
      next(new AppError("Invalid platform token", 401, ErrorCodes.TOKEN_INVALID));
      return;
    }

    req.platformAuth = {
      sub: decoded.sub,
      platformRole: decoded.platformRole,
      type: decoded.type,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError("Platform token expired", 401, ErrorCodes.TOKEN_EXPIRED));
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError("Invalid platform token", 401, ErrorCodes.TOKEN_INVALID));
      return;
    }

    next(error);
  }
}

/**
 * Authorization guard for staff routes. Requires an authenticated platform
 * session whose role is in the allowed set. Use after authenticatePlatform.
 */
export function requirePlatformRole(
  ...allowed: Array<Exclude<PlatformRole, "NONE">>
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.platformAuth) {
      next(new AppError("Platform authentication required", 401, ErrorCodes.UNAUTHORIZED));
      return;
    }
    if (!allowed.includes(req.platformAuth.platformRole)) {
      next(new AppError("Insufficient platform privilege", 403, ErrorCodes.FORBIDDEN));
      return;
    }
    next();
  };
}