import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCodes } from "../errors/errorCodes.js";
import { logger } from "../../config/logger.js";

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
