import express, { Router, type NextFunction, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { ingestService } from "./ingest.service.js";

/**
 * POST /api/v1/internal/inbound/messages — the inbound edge's door into Zoiko.
 *
 * Body: the raw RFC 5322 message (any content type; read as bytes).
 * Headers:
 *   X-Zoiko-Timestamp   milliseconds since the epoch
 *   X-Zoiko-Recipients  the envelope recipients, comma-separated
 *   X-Zoiko-Sender      the envelope sender (optional)
 *   X-Zoiko-Signature   hex HMAC-SHA256, see IngestService.sign
 *
 * 200 with a per-recipient outcome when at least one recipient took it;
 * 404 INBOUND_RECIPIENT_UNKNOWN when none did, so the edge rejects the
 * message during the SMTP session and the sender's own server reports it.
 *
 * Registered ahead of the JSON parser and authentication: the signature is
 * over the exact bytes, and the caller is a machine with a shared secret, not
 * a signed-in person.
 */
export const inboundRouter = Router();

inboundRouter.post(
  "/messages",
  express.raw({ type: () => true, limit: env.INBOUND_MAX_MESSAGE_BYTES }),
  // The raw parser's own refusal (too large) arrives as an error, not an AppError.
  (error: unknown, _req: Request, _res: Response, next: NextFunction) => {
    const status = (error as { status?: number }).status;
    next(status === 413 ? new AppError("The message is larger than this deployment accepts", 413, ErrorCodes.VALIDATION_ERROR) : error);
  },
  asyncHandler(async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (raw.length === 0) throw new AppError("Empty message", 400, ErrorCodes.VALIDATION_ERROR);
    const recipients = ingestService.verify(raw, {
      timestamp: req.header("x-zoiko-timestamp") ?? undefined,
      signature: req.header("x-zoiko-signature") ?? undefined,
      recipients: req.header("x-zoiko-recipients") ?? undefined,
    });
    const sender = req.header("x-zoiko-sender")?.trim().toLowerCase() || null;
    const outcomes = await ingestService.ingest(raw, recipients, sender);
    if (!outcomes.some((outcome) => outcome.status !== "UNKNOWN")) {
      throw new AppError("No mailbox accepts mail for these recipients", 404, ErrorCodes.INBOUND_RECIPIENT_UNKNOWN, { outcomes });
    }
    sendSuccess(res, 200, { outcomes }, req.requestId);
  })
);
