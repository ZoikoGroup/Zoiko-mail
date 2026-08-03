import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import type { AccessTokenPayload } from "../types/jwt.js";

const roles = new Set(["OWNER", "ADMIN", "MEMBER", "SUPPORT"]);

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

function extractBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

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
