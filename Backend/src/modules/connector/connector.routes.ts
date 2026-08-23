import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";
import { authenticate, requireCapability, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import {
  callbackParamsSchema,
  connectedAccountIdSchema,
  createConnectedAccountSchema,
  listProviderEventsQuerySchema,
  providerCallbackSchema,
  providerEventIdSchema,
} from "./connector.schema.js";
import { connectorService } from "./connector.service.js";

const verifyCallbackSignature: RequestHandler = (req, res, next) => {
  const supplied = req.header("x-provider-signature");
  const expected = `sha256=${createHmac("sha256", env.PROVIDER_CALLBACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex")}`;
  const suppliedBuffer = Buffer.from(supplied ?? "");
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    res.status(401).json({
      success: false,
      error: { code: "UNAUTHORIZED", message: "Invalid provider callback signature" },
      requestId: req.requestId,
    });
    return;
  }
  next();
};

export const connectorRouter = Router();

connectorRouter.post(
  "/callbacks/:provider",
  rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }),
  validate(callbackParamsSchema, "params"),
  verifyCallbackSignature,
  validate(providerCallbackSchema),
  asyncHandler(async (req, res) => {
    const result = await connectorService.receiveEvent(
      req.params.provider as "GMAIL" | "MICROSOFT_365",
      req.body,
      req.requestId
    );
    sendSuccess(res, result.duplicate ? 200 : 202, result, req.requestId);
  })
);

connectorRouter.use(authenticate, tenantContext, requireRole("OWNER", "ADMIN", "MEMBER"));

connectorRouter.get("/", asyncHandler(async (req, res) => {
  sendSuccess(res, 200, {
    accounts: await connectorService.list(
      req.tenantContext!.tenantId,
      req.tenantContext!.membershipId
    ),
  }, req.requestId);
}));

// The workspace-wide view for the admin provider-sync surface. Declared before
// the "/:accountId" routes so "admin" is not read as an account id.
connectorRouter.get(
  "/admin",
  requireCapability("workspace.mailboxes.manage"),
  asyncHandler(async (req, res) => {
    sendSuccess(res, 200, {
      accounts: await connectorService.listForTenant(req.tenantContext!.tenantId),
    }, req.requestId);
  })
);

connectorRouter.post("/", validate(createConnectedAccountSchema), asyncHandler(async (req, res) => {
  sendSuccess(res, 201, await connectorService.create(req.body, {
    tenantId: req.tenantContext!.tenantId,
    membershipId: req.tenantContext!.membershipId,
    userId: req.tenantContext!.userId,
    requestId: req.requestId,
  }), req.requestId);
}));

connectorRouter.get("/health", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await connectorService.health(req.tenantContext!.tenantId), req.requestId);
}));

connectorRouter.get("/dead-letter", requireRole("OWNER", "ADMIN"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, {
    events: await connectorService.listDeadLetters(req.tenantContext!.tenantId),
  }, req.requestId);
}));

connectorRouter.get(
  "/provider-events",
  requireRole("OWNER", "ADMIN"),
  validate(listProviderEventsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    sendSuccess(res, 200, {
      events: await connectorService.listProviderEvents(
        req.query as { status?: string; provider?: string; limit?: number },
        req.tenantContext!.tenantId
      ),
    }, req.requestId);
  })
);

connectorRouter.post(
  "/dead-letter/:eventId/replay",
  requireRole("OWNER", "ADMIN"),
  validate(providerEventIdSchema, "params"),
  asyncHandler(async (req, res) => {
    sendSuccess(res, 200, await connectorService.replayDeadLetter(
      String(req.params.eventId),
      req.tenantContext!.tenantId,
      req.tenantContext!.userId,
      req.requestId
    ), req.requestId);
  })
);

connectorRouter.get("/:accountId/events", validate(connectedAccountIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, {
    events: await connectorService.listEvents(
      String(req.params.accountId),
      req.tenantContext!.tenantId,
      req.tenantContext!.membershipId
    ),
  }, req.requestId);
}));

connectorRouter.delete("/:accountId", validate(connectedAccountIdSchema, "params"), asyncHandler(async (req, res) => {
  sendSuccess(res, 200, await connectorService.disconnect(String(req.params.accountId), {
    tenantId: req.tenantContext!.tenantId,
    membershipId: req.tenantContext!.membershipId,
    userId: req.tenantContext!.userId,
    requestId: req.requestId,
  }), req.requestId);
}));
