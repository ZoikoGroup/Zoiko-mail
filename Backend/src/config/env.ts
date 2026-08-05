import { z } from "zod";
import "dotenv/config";

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
  MAIL_PROVIDER_USERNAME: z.string().min(1).optional(),
  MAIL_PROVIDER_PASSWORD: z.string().min(1).optional(),
  MAIL_PROVIDER_FROM_ADDRESS: z.string().email().optional(),
  MAIL_PROVIDER_TENANT_ID: z.string().uuid().optional(),
  MAIL_PROVIDER_MEMBERSHIP_ID: z.string().uuid().optional(),
  MAIL_PROVIDER_SYNC_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
  MAIL_PROVIDER_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
}).superRefine((value, context) => {
  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
    context.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "must differ from JWT_ACCESS_SECRET" });
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
