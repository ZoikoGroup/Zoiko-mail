import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";

function createAuthLimiter(max: number) {
  return rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many authentication attempts, please try again later",
        },
        requestId: req.requestId,
      });
    },
  });
}

export const registerRateLimit = createAuthLimiter(env.REGISTER_RATE_LIMIT_MAX);
export const loginRateLimit = createAuthLimiter(env.LOGIN_RATE_LIMIT_MAX);
export const refreshRateLimit = createAuthLimiter(env.REFRESH_RATE_LIMIT_MAX);
