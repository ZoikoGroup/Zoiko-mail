import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { operationalMetrics } from "../../config/operationalMetrics.js";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  operationalMetrics.requestStarted();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    operationalMetrics.requestFinished(res.statusCode, durationMs);
    const details = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ipAddress: req.ip,
      userAgent: req.header("user-agent"),
    };

    if (res.statusCode >= 500) logger.error(details, "Request completed");
    else if (res.statusCode >= 400) logger.warn(details, "Request completed");
    else logger.info(details, "Request completed");
  });

  next();
}
