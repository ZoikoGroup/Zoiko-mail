import { z } from "zod";
import "dotenv/config";

// docker-compose passes unset optional vars through as empty strings (`${VAR:-}`),
// and an empty string is present-but-invalid rather than absent. Treat it as absent
// so an unconfigured mail provider does not fail validation.
const blankAsUndefined = (value: unknown) => (value === "" ? undefined : value);

/** Boolean env var parsed from the literal strings "true" / "false". */
const boolFlag = (fallback: "true" | "false") =>
  z.enum(["true", "false"]).default(fallback).transform((value: "true" | "false") => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  JSON_BODY_LIMIT: z.string().regex(/^\d+(kb|mb)$/i).default("1mb"),
  COMPRESSION_THRESHOLD: z.coerce.number().int().min(0).default(1024),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(35_000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default("12h"),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default("7d"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  INVITATION_EXPIRES_IN_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  ATTACHMENT_STORAGE_PATH: z.string().min(1).default("storage/attachments"),
  ATTACHMENT_MAX_SIZE_BYTES: z.coerce.number().int().positive().max(25 * 1024 * 1024).default(10 * 1024 * 1024),
  MAIL_SEND_WINDOW_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  MAIL_MAX_RECIPIENTS_PER_WINDOW: z.coerce.number().int().positive().default(100),
  MAIL_SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  MAIL_SCHEDULE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  JOB_WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  EXPORT_STORAGE_PATH: z.string().min(1).default("storage/exports"),
  OPERATIONS_KEY: z.string().min(32).default("change-me-operations-key-min-32-chars"),
  OTP_CODE_LENGTH: z.coerce.number().int().min(4).max(10).default(6),
  OTP_TTL_MS: z.coerce.number().int().min(60_000).default(600_000),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  OTP_RESEND_COOLDOWN_MS: z.coerce.number().int().min(10_000).default(60_000),
  OTP_RESEND_MAX_PER_HOUR: z.coerce.number().int().min(1).max(20).default(5),
  PASSWORD_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  PASSWORD_RESET_TTL_MS: z.coerce.number().int().min(60_000).default(900_000), // 15 min
  SYSTEM_MAIL_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SYSTEM_MAIL_FROM: z.string().email().default("no-reply@zoikomail.com"),
  PROVIDER_CALLBACK_SECRET: z.string().min(32).default("change-me-provider-callback-secret-32"),
  PROVIDER_EVENT_WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  PROVIDER_EVENT_RETRY_BASE_MS: z.coerce.number().int().min(1_000).default(30_000),
  MAIL_PROVIDER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  IMAP_HOST: z.string().min(1).default("imap.secureserver.net"),
  IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  IMAP_SECURE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  SMTP_HOST: z.string().min(1).default("smtpout.secureserver.net"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  MAIL_PROVIDER_USERNAME: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  MAIL_PROVIDER_PASSWORD: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  MAIL_PROVIDER_FROM_ADDRESS: z.preprocess(blankAsUndefined, z.string().email().optional()),
  MAIL_PROVIDER_TENANT_ID: z.preprocess(blankAsUndefined, z.string().uuid().optional()),
  MAIL_PROVIDER_MEMBERSHIP_ID: z.preprocess(blankAsUndefined, z.string().uuid().optional()),
  MAIL_PROVIDER_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
  MAIL_PROVIDER_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  // Floor is 4 so the test suite can hash cheaply; anything below 10 is rejected
  // outside NODE_ENV=test by the refinement below. Without this the suite could
  // not boot at all, because tests/setup.ts sets 4 for speed.
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Secret access — Security §15. "env" reads SECRET_<REF> for local and CI use;
  // "gcp" routes through Secret Manager and fails loudly until it is wired.
  SECRET_STORE: z.enum(["env", "gcp"]).default("env"),
  SECRET_CACHE_TTL_MS: z.coerce.number().int().min(0).max(3_600_000).default(300_000),
  // Google OAuth 2.0 client ID and allowed hosted domain for login.
  GOOGLE_CLIENT_ID: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  GOOGLE_ALLOWED_HD: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  FLAG_GOOGLE_LOGIN_ENABLED: boolFlag("false"),
  GOOGLE_CLIENT_SECRET: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  GOOGLE_REDIRECT_URI: z.preprocess(blankAsUndefined, z.string().url().optional()),
  // The client ID the browser's Sign In with Google button is initialized
  // with (NEXT_PUBLIC_GOOGLE_CLIENT_ID). It can differ from GOOGLE_CLIENT_ID:
  // the ID-token leg only needs the public client ID, while the Gmail
  // connector needs the secret + redirect URI. ID tokens issued for this
  // audience are accepted on /auth/google alongside GOOGLE_CLIENT_ID.
  GOOGLE_SIGNIN_CLIENT_ID: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  // Encryption key for token-at-rest (64 hex chars = 32 bytes for AES-256-GCM)
  ENCRYPTION_KEY: z.preprocess(blankAsUndefined, z.string().length(64).optional()),
  // Stripe — used for subscription & billing (TEST mode). All three are optional:
  // checkout/portal/webhook fail closed until configured.
  STRIPE_SECRET_KEY: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  STRIPE_WEBHOOK_SECRET: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  STRIPE_PUBLISHABLE_KEY: z.preprocess(blankAsUndefined, z.string().min(1).optional()),
  FLAG_CONNECTOR_GMAIL_ENABLED: boolFlag("true"),
  FLAG_CONNECTOR_M365_ENABLED: boolFlag("true"),
  FLAG_AI_EXTRACTION_ENABLED: boolFlag("true"),
  FLAG_AI_DRAFTING_ENABLED: boolFlag("true"),
  FLAG_HOSTED_MAIL_PILOT_ENABLED: boolFlag("false"),
  FLAG_OUTBOUND_SENDING_ENABLED: boolFlag("true"),
  FLAG_CUSTOM_DOMAIN_ENABLED: boolFlag("false"),
  FLAG_PROVIDER_CALLBACKS_ACCEPTING: boolFlag("true"),
}).superRefine((value, context) => {
  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
    context.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "must differ from JWT_ACCESS_SECRET" });
  }
  if (value.NODE_ENV !== "test" && value.BCRYPT_ROUNDS < 10) {
    context.addIssue({
      code: "custom",
      path: ["BCRYPT_ROUNDS"],
      message: "must be at least 10 outside the test environment",
    });
  }
  if (value.NODE_ENV === "production") {
    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OPERATIONS_KEY", "PROVIDER_CALLBACK_SECRET"] as const) {
      if (/change-me|example|development|test-secret/i.test(value[key])) {
        context.addIssue({ code: "custom", path: [key], message: "must be a production secret" });
      }
    }
  }
  if (value.MAIL_PROVIDER_ENABLED) {
    for (const key of ["MAIL_PROVIDER_USERNAME", "MAIL_PROVIDER_PASSWORD", "MAIL_PROVIDER_FROM_ADDRESS", "MAIL_PROVIDER_TENANT_ID", "MAIL_PROVIDER_MEMBERSHIP_ID"] as const) {
      if (!value[key]) {
        context.addIssue({ code: "custom", path: [key], message: "is required when MAIL_PROVIDER_ENABLED=true" });
      }
    }
    if (!value.IMAP_SECURE || !value.SMTP_SECURE) {
      context.addIssue({ code: "custom", path: ["MAIL_PROVIDER_ENABLED"], message: "IMAP and SMTP TLS must remain enabled" });
    }
  }
  if (value.FLAG_GOOGLE_LOGIN_ENABLED && !value.GOOGLE_CLIENT_ID) {
    context.addIssue({
      code: "custom",
      path: ["GOOGLE_CLIENT_ID"],
      message: "is required when FLAG_GOOGLE_LOGIN_ENABLED=true",
    });
  }

  // One client id serves two different Google features, and they need
  // different things:
  //
  //   Connecting a Gmail mailbox is an authorization-code flow, so it needs
  //   the secret and a registered redirect URI as well.
  //   Signing in verifies an ID token against Google's keys, which needs
  //   nothing but the client id.
  //
  // So a half-configured connector is still an error, but requiring the
  // secret merely because a client id exists would break sign-in, which is
  // legitimately configured with the id alone. The trio is demanded only
  // once something connector-specific has been set.
  const connectorVars = [value.GOOGLE_CLIENT_SECRET, value.GOOGLE_REDIRECT_URI] as const;
  if (connectorVars.some(Boolean) && !(value.GOOGLE_CLIENT_ID && connectorVars.every(Boolean))) {
    context.addIssue({
      code: "custom",
      path: ["GOOGLE_CLIENT_SECRET"],
      message: "GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI configure the Gmail connector and require GOOGLE_CLIENT_ID too; sign-in alone needs only GOOGLE_CLIENT_ID",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return parsed.data;
}

export const env = loadEnv();
