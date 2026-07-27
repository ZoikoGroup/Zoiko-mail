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
  JWT_ACCESS_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default("15m"),
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
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
}).superRefine((value, context) => {
  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
    context.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "must differ from JWT_ACCESS_SECRET" });
  }
  if (value.NODE_ENV === "production") {
    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "OPERATIONS_KEY"] as const) {
      if (/change-me|example|development|test-secret/i.test(value[key])) {
        context.addIssue({ code: "custom", path: [key], message: "must be a production secret" });
      }
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
