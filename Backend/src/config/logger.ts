import pino from "pino";
import { env } from "./env.js";

/**
 * Structured logging with PII minimization.
 *
 * Infrastructure §10 requires logs to carry "no secrets or full email bodies";
 * Data Model §9 lists what must be dropped before anything is persisted or
 * emitted. Redaction here is a backstop, not a licence to log sensitive values —
 * callers should still pass identifiers rather than content.
 *
 * Each group below maps to a data class from Data Model §5:
 *   C3 communication content — bodies, excerpts, AI output
 *   C4 secrets/credentials  — tokens, keys, DKIM material, OTP codes
 */
const REDACT_LEAVES = [
  // C4 — credentials and secrets
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "clientSecret",
  "apiKey",
  "privateKey",
  "dkimPrivateKey",
  "inviteToken",
  "verificationToken",
  "signingSecret",
  "otp",
  "otpCode",
  "recoveryCode",
  // C3 — message content and AI output
  "body",
  "bodyHtml",
  "bodyText",
  "htmlBody",
  "textBody",
  "snippet",
  "sourceExcerpt",
  "outputText",
  "attachmentContent",
  // Provider payloads are stored sanitized; never log the raw form.
  "rawPayload",
  "providerPayload",
];

/**
 * Redaction is applied at the top level, one level down, and two levels down.
 * pino does not support unbounded recursive wildcards, so deeply nested content
 * must be flattened by the caller before logging.
 */
const redactPaths = REDACT_LEAVES.flatMap((leaf) => [leaf, `*.${leaf}`, `*.*.${leaf}`]);

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
  base: {
    service: "zoiko-mail-api",
    environment: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
});

/** Exported for the redaction test so the list cannot silently shrink. */
export const redactedFields: ReadonlyArray<string> = REDACT_LEAVES;
