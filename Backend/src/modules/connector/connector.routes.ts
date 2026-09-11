import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { authenticate, requireCapability, requireRole, tenantContext, validate } from "../../common/middleware/index.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import {
  callbackParamsSchema,
  connectedAccountIdSchema,
  createConnectedAccountSchema,
  googleAuthQuerySchema,
  googleCallbackQuerySchema,
  listProviderEventsQuerySchema,
  providerCallbackSchema,
  providerEventIdSchema,
} from "./connector.schema.js";
import { logger } from "../../config/logger.js";
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

// ─── Google OAuth (unauthenticated — placed before authenticate middleware) ───

connectorRouter.get(
  "/auth/google",
  authenticate,
  tenantContext,
  requireRole("OWNER", "ADMIN", "MEMBER"),
  validate(googleAuthQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const statePayload = {
      tenantId: req.tenantContext!.tenantId,
      membershipId: req.tenantContext!.membershipId,
      userId: req.tenantContext!.userId,
    };
    const state = jwt.sign(statePayload, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
    const url = connectorService.getGoogleAuthUrl(state);
    sendSuccess(res, 200, { url }, req.requestId);
  })
);

connectorRouter.get(
  "/callback/google",
  validate(googleCallbackQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { code, state, error, error_description } = req.query as {
      code?: string; state?: string; error?: string; error_description?: string;
    };

    const frontendUrl = env.APP_URL || "http://localhost:3000";

    if (error) {
      const desc = error_description || error;
      res.redirect(`${frontendUrl}/connected-accounts?error=${encodeURIComponent(desc)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}/connected-accounts?error=missing_parameters`);
      return;
    }

    // Verify state token
    let payload: { tenantId: string; membershipId: string; userId: string };
    try {
      payload = jwt.verify(state, env.JWT_ACCESS_SECRET) as { tenantId: string; membershipId: string; userId: string };
    } catch {
      res.redirect(`${frontendUrl}/connected-accounts?error=invalid_state`);
      return;
    }

    await connectorService.handleGoogleCallback(code, {
      tenantId: payload.tenantId,
      membershipId: payload.membershipId,
      userId: payload.userId,
      requestId: req.requestId,
    });

    res.redirect(`${frontendUrl}/connected-accounts?connected=true&provider=GMAIL`);
  })
);

// ─── Microsoft 365 OAuth (unauth until the callback, which carries a state JWT) ──

const verifyStateToken = (state: unknown): { valid: boolean; payload: { tenantId: string; membershipId: string; userId: string } } => {
  try {
    return {
      valid: true,
      payload: jwt.verify(String(state), env.JWT_ACCESS_SECRET) as { tenantId: string; membershipId: string; userId: string },
    };
  } catch {
    return { valid: false, payload: { tenantId: "", membershipId: "", userId: "" } };
  }
};

connectorRouter.get(
  "/auth/microsoft",
  authenticate,
  tenantContext,
  requireRole("OWNER", "ADMIN", "MEMBER"),
  asyncHandler(async (req, res) => {
    const statePayload = {
      tenantId: req.tenantContext!.tenantId,
      membershipId: req.tenantContext!.membershipId,
      userId: req.tenantContext!.userId,
    };
    const state = jwt.sign(statePayload, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
    const url = await connectorService.getMicrosoftAuthUrl(state);
    sendSuccess(res, 200, { url }, req.requestId);
  })
);

connectorRouter.get(
  "/callback/microsoft",
  validate(googleCallbackQuerySchema, "query"), // same { code, state, error } shape
  asyncHandler(async (req, res) => {
    const { code, state, error, error_description } = req.query as {
      code?: string; state?: string; error?: string; error_description?: string;
    };
    const frontendUrl = env.APP_URL || "http://localhost:3000";

    if (error) {
      const desc = error_description || error;
      res.redirect(`${frontendUrl}/connected-accounts?error=${encodeURIComponent(desc)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}/connected-accounts?error=missing_parameters`);
      return;
    }

    const verified = verifyStateToken(state);
    if (!verified.valid) {
      res.redirect(`${frontendUrl}/connected-accounts?error=invalid_state`);
      return;
    }

    await connectorService.handleMicrosoftCallback(code, {
      tenantId: verified.payload.tenantId,
      membershipId: verified.payload.membershipId,
      userId: verified.payload.userId,
      requestId: req.requestId,
    });

    res.redirect(`${frontendUrl}/connected-accounts?connected=true&provider=MICROSOFT_365`);
  })
);

// ─── Gmail Pub/Sub push (unauthenticated — receives history notifications) ───

connectorRouter.post(
  "/hooks/gmail",
  rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }),
  asyncHandler(async (req, res) => {
    // Google Pub/Sub push format: { message: { data, messageId, publishTime }, subscription }
    // or a plain verification request with `challenge` (handled inline).
    if (req.body.challenge) {
      sendSuccess(res, 200, { challenge: req.body.challenge }, req.requestId);
      return;
    }

    const messageData = req.body?.message?.data as string | undefined;
    if (!messageData) {
      // Ack unrecognized payloads so Google stops retrying.
      sendSuccess(res, 200, {}, req.requestId);
      return;
    }

    try {
      const decoded = JSON.parse(Buffer.from(messageData, "base64url").toString("utf8")) as {
        emailAddress?: string;
        historyId?: string;
      };
      const email = decoded.emailAddress;
      const historyId = decoded.historyId;
      if (!email || !historyId) {
        sendSuccess(res, 200, {}, req.requestId);
        return;
      }

      // Find the connected Gmail account for this email address.
      const { prisma } = await import("../../config/prisma.js");
      const account = await prisma.connectedAccount.findFirst({
        where: { provider: "GMAIL", email, status: { not: "DISCONNECTED" } },
        select: { id: true, tenantId: true, providerAccountId: true },
      });
      if (!account) {
        sendSuccess(res, 200, {}, req.requestId);
        return;
      }

      await connectorService.receiveEvent(
        "GMAIL",
        {
          providerAccountId: account.providerAccountId,
          eventType: "MAILBOX_CHANGED",
          resourceType: "MESSAGE",
          resourceId: historyId,
          providerReference: historyId,
          occurredAt: new Date().toISOString(),
          cursor: historyId,
        },
        req.requestId
      );
    } catch (error) {
      logger.warn({ error }, "Failed to process Gmail Pub/Sub push");
    }

    // Always respond 200 — Google requires fast ack.
    sendSuccess(res, 200, {}, req.requestId);
  })
);

// ─── Microsoft Graph change notifications (unauth — client-state verified) ───

connectorRouter.get("/hooks/microsoft", asyncHandler(async (req, res) => {
  // Microsoft validates subscription URLs with a GET carrying ?validationToken.
  const token = String(req.query.validationToken ?? "");
  res.status(200).send(token);
}));

connectorRouter.post(
  "/hooks/microsoft",
  rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }),
  asyncHandler(async (req, res) => {
    const notification: {
      value?: Array<{
        subscriptionId?: string;
        clientState?: string;
        changeType?: string;
        resource?: string;
        tenantId?: string;
      }>;
      lifecycleEvent?: string;
    } = req.body ?? {};

    if (notification.lifecycleEvent) {
      const { microsoftConnector } = await import("./m365/m365.connector.js");
      if (notification.lifecycleEvent === "reauthorizationRequired" || notification.lifecycleEvent === "subscriptionRemoved") {
        for (const item of notification.value ?? []) {
          const account = await (await import("../../config/prisma.js")).prisma.connectedAccount.findFirst({
            where: { provider: "MICROSOFT_365", microsoftSubscriptionId: item.subscriptionId },
            select: { id: true, tenantId: true },
          });
          if (!account) continue;
          try {
            await microsoftConnector.resubscribe(account.id, account.tenantId);
          } catch (error) {
            logger.warn({ subscriptionId: item.subscriptionId, error }, "Graph lifecycle resubscribe failed");
          }
        }
      }
      sendSuccess(res, 200, {}, req.requestId);
      return;
    }

    for (const item of notification.value ?? []) {
      if (item.clientState && item.clientState !== env.MICROSOFT_NOTIFICATION_CLIENT_STATE) {
        res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid clientState" } });
        return;
      }
      if (!item.subscriptionId || !item.changeType) continue;
      const account = await (await import("../../config/prisma.js")).prisma.connectedAccount.findFirst({
        where: { provider: "MICROSOFT_365", microsoftSubscriptionId: item.subscriptionId },
        select: { providerAccountId: true, tenantId: true },
      });
      if (!account) continue;

      const eventType = item.changeType === "deleted" ? "MESSAGE_DELETED" : "MAILBOX_CHANGED";
      await connectorService.receiveEvent(
        "MICROSOFT_365",
        {
          providerAccountId: account.providerAccountId,
          eventType,
          resourceType: "MESSAGE",
          resourceId: item.resource ?? undefined,
          providerReference: item.resource ?? undefined,
          occurredAt: new Date().toISOString(),
        },
        req.requestId
      );
    }

    // Ack promptly to stop Graph redelivery.
    sendSuccess(res, 200, {}, req.requestId);
  })
);

// ─── Provider webhook callback (unauthenticated, HMAC-verified) ──────────────

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

// ─── Authenticated routes ────────────────────────────────────────────────────

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
