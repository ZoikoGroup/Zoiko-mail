import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: {
    service: "zoiko-mail-api",
    environment: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "accessToken",
      "refreshToken",
      "authorization",
      "cookie",
      "*.password",
      "*.passwordHash",
      "*.accessToken",
      "*.refreshToken",
      "*.authorization",
      "*.cookie",
    ],
    censor: "[REDACTED]",
  },
});
