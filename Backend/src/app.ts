import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import compression from "compression";
import { env } from "./config/env.js";
import {
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLogger,
} from "./common/middleware/index.js";
import { apiRouter } from "./routes/index.js";
import { openApiDocument } from "./config/openapi.js";
import { prisma } from "./config/prisma.js";
import { asyncHandler } from "./common/middleware/asyncHandler.js";
import { attachmentStorage } from "./modules/mail/attachment.storage.js";
import { exportStorage } from "./modules/lifecycle/export.storage.js";
import { operationalMetrics } from "./config/operationalMetrics.js";
import { timingSafeEqual } from "node:crypto";
import { imapSmtpAdapter } from "./modules/provider-mail/imap-smtp.adapter.js";
import { providerMailService } from "./modules/provider-mail/provider-mail.service.js";

function operationsKeyValid(value: string | undefined) {
  if (!value) return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(env.OPERATIONS_KEY);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createApp() {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(helmet());
  app.use(compression({ threshold: env.COMPRESSION_THRESHOLD }));
  app.use(
    cors({
      // Security §6 requires an allow-list, not a single origin: several
      // developers run the app on different ports (Next falls back to 3001 when
      // 3000 is taken), and each needs to reach the same API. Comma-separated,
      // trimmed, blanks dropped — never a wildcard.
      origin: env.CORS_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      credentials: true,
    })
  );
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests, please try again later",
          },
          requestId: req.requestId,
        });
      },
    })
  );

  app.get("/", (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        name: "Zoiko Mail API",
        version: "1.0.0",
      },
    });
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        status: "UP",
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.get(
    "/api/ready",
    asyncHandler(async (_req, res) => {
      await Promise.all([
        prisma.$queryRaw`SELECT 1`,
        attachmentStorage.check(),
        exportStorage.check(),
      ]);
      res.status(200).json({
        success: true,
        data: {
          status: "READY",
          database: "UP",
          attachmentStorage: "UP",
          exportStorage: "UP",
          timestamp: new Date().toISOString(),
        },
      });
    })
  );

  app.get(
    "/api/metrics",
    asyncHandler(async (req, res) => {
      if (!operationsKeyValid(req.header("x-operations-key"))) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Operations authentication required" },
          requestId: req.requestId,
        });
        return;
      }
      const [pendingJobs, dueScheduledMail, pendingProviderEvents, deadLetterProviderEvents] = await prisma.$transaction([
        prisma.backgroundJob.count({ where: { status: { in: ["PENDING", "RETRY"] } } }),
        prisma.emailMessage.count({ where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } } }),
        prisma.providerEvent.count({ where: { processingStatus: { in: ["RECEIVED", "RETRY"] } } }),
        prisma.providerEvent.count({ where: { processingStatus: "DEAD_LETTER" } }),
      ]);
      res.type("text/plain; version=0.0.4").status(200)
        .send(operationalMetrics.render({ pendingJobs, dueScheduledMail, pendingProviderEvents, deadLetterProviderEvents }));
    })
  );

  app.get(
    "/api/provider-mail/health",
    asyncHandler(async (req, res) => {
      if (!operationsKeyValid(req.header("x-operations-key"))) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Operations authentication required" },
          requestId: req.requestId,
        });
        return;
      }
      const status = imapSmtpAdapter.status();
      const data = req.query.probe === "true" && status.configured
        ? { ...status, connectivity: await imapSmtpAdapter.verify() }
        : status;
      res.status(200).json({ success: true, data, requestId: req.requestId });
    })
  );

  app.post(
    "/api/provider-mail/sync",
    asyncHandler(async (req, res) => {
      if (!operationsKeyValid(req.header("x-operations-key"))) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Operations authentication required" },
          requestId: req.requestId,
        });
        return;
      }
      const job = await providerMailService.enqueueSync();
      res.status(202).json({
        success: true,
        data: { jobId: job.id, status: job.status },
        requestId: req.requestId,
      });
    })
  );

  app.get("/api/docs.json", (_req, res) => res.status(200).json(openApiDocument));
  app.use(
    "/api/docs",
    (_req: Request, res: Response, next: NextFunction) => {
      res.removeHeader("Content-Security-Policy");
      next();
    },
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, { customSiteTitle: "Zoiko Mail API Docs" })
  );

  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
