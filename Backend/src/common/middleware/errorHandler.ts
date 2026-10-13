import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { logger } from "../../config/logger.js";

/**
 * Connection failures, as opposed to query failures: the client could not
 * start (P1001 unreachable, P1002 timed out, P1017 server closed the
 * connection) or every pooled connection stayed busy (P2024).
 */
const DATABASE_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1017", "P2024"]);

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return DATABASE_UNAVAILABLE_CODES.has(error.code);
  }
  // A failed connection inside a query can surface as an unknown-request
  // error whose only signal is the message.
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /Can't reach database server|Timed out fetching a new connection/i.test(error.message);
  }
  return false;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
    requestId: req.requestId,
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      requestId: req.requestId,
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Validation failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      requestId: req.requestId,
    });
    return;
  }

  // The database being unreachable is an outage, not a bug in the request,
  // and Prisma's message for it names the host, port and source file. Shown
  // as-is it read as a sign-in failure to the person at the form. Answered as
  // a 503 with a plain sentence; the full error still goes to the log.
  if (isDatabaseUnavailable(error)) {
    logger.error({
      requestId: req.requestId,
      err: error,
      method: req.method,
      path: req.path,
    }, "Database unavailable");
    res.status(503).json({
      success: false,
      error: {
        code: ErrorCodes.DATABASE_UNAVAILABLE,
        message: "Zoiko Mail can't reach its database right now. Please try again in a moment.",
      },
      requestId: req.requestId,
    });
    return;
  }

  logger.error({
    requestId: req.requestId,
    err: error,
    method: req.method,
    path: req.path,
  }, "Unhandled request error");

  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message:
        env.NODE_ENV === "production"
          ? "Internal server error"
          : error instanceof Error
            ? error.message
            : "Internal server error",
    },
    requestId: req.requestId,
  });
}
