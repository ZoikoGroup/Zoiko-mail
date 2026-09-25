import { Router, type Request, type Response } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { tenantContext } from "../../common/middleware/tenantContext.js";
import { sseManager } from "../../common/sse/sse.manager.js";

export const eventsRouter = Router();

/**
 * GET /api/v1/events/stream
 *
 * SSE endpoint. The browser opens this once and keeps it open.
 * The server pushes events (new mail, AI done, notifications) as they happen.
 *
 * Auth: same Bearer token as every other endpoint.
 * The connection is user-scoped — events are only sent to the right user.
 */
eventsRouter.get(
  "/stream",
  authenticate,
  tenantContext,
  (req: Request, res: Response) => {
    const userId = req.tenantContext!.userId;
    const tenantId = req.tenantContext!.tenantId;

    // ── SSE Headers ────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
    res.flushHeaders(); // flush immediately so browser gets 200 + headers

    // ── Register client ────────────────────────────────────────────────────
    const cleanup = sseManager.addClient(userId, tenantId, res);

    // ── Initial "connected" event so client knows the stream is live ───────
    res.write(
      `event: CONNECTED\ndata: ${JSON.stringify({
        type: "CONNECTED",
        userId,
        tenantId,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );
    // Force flush — needed when compression middleware is present
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }

    // ── Cleanup on disconnect ──────────────────────────────────────────────
    req.on("close", cleanup);
    req.on("error", cleanup);
  }
);