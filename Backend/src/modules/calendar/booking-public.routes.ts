import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { validate } from "../../common/middleware/validate.js";
import { sendSuccess } from "../../common/utils/response.js";
import { env } from "../../config/env.js";
import { bookingLinkService } from "./booking-link.service.js";
import { guestBookSchema, slotRangeSchema, slugParamsSchema } from "./calendar.schema.js";

/**
 * The public booking page's API: no sign-in. A link is found by its slug and
 * only while published; it shows free times and nothing else about the host's
 * calendar. Both routes are rate limited per visitor and link — reading
 * generously, booking strictly.
 */
function limiter(max: number) {
  return rateLimit({
    windowMs: 15 * 60_000,
    max: env.NODE_ENV === "test" ? 1000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}:${String(req.params.slug)}`,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please wait a few minutes and try again." },
        requestId: req.requestId,
      });
    },
  });
}

export const bookingPublicRouter = Router();

bookingPublicRouter.get(
  "/:slug",
  limiter(300),
  validate(slugParamsSchema, "params"),
  validate(slotRangeSchema, "query"),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = slotRangeSchema.parse(req.query);
    sendSuccess(res, 200, await bookingLinkService.publicView(String(req.params.slug), from, to), req.requestId);
  })
);

bookingPublicRouter.post(
  "/:slug",
  limiter(10),
  validate(slugParamsSchema, "params"),
  validate(guestBookSchema),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, 201, await bookingLinkService.publicBook(String(req.params.slug), req.body), req.requestId);
  })
);
