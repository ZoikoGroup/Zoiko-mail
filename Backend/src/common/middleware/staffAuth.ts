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
 * Authentication for the support console. Accepts EITHER a tenant-scoped
 * access token (support members, or staff who also hold a membership) OR a
 * platform token (staff without a tenant membership, minted on STAFF_CONSOLE
 * login). Populates req.auth / req.platformAuth accordingly; the downstream
 * `requireSupportAccess` guard normalizes both into req.staffAuth.
 *
 * Unlike `authenticate` + `authenticatePlatform`, a single verify handles the
 * bearer, so a platform token isn't rejected as an "invalid access token".
 */
export function authenticateStaff(
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

    if (isAccessTokenPayload(decoded)) {
      req.auth = {
        sub: decoded.sub,
        tenantId: decoded.tenantId,
        membershipId: decoded.membershipId,
        role: decoded.role,
        // Older tokens minted before Phase 4 may lack platformRole; default NONE.
        platformRole: decoded.platformRole ?? "NONE",
        type: "access",
      };
      next();
      return;
    }

    if (isPlatformTokenPayload(decoded)) {
      req.platformAuth = {
        sub: decoded.sub,
        platformRole: decoded.platformRole,
        type: "platform",
      };
      next();
      return;
    }

    next(new AppError("Invalid access token", 401, ErrorCodes.TOKEN_INVALID));
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
