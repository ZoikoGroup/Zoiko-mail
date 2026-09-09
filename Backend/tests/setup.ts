import { afterAll, beforeEach } from "vitest";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

loadEnv({ path: resolve(process.cwd(), ".env") });

process.env.NODE_ENV = "test";
// Connector OAuth tokens are written to the local secret store in tests; point
// it at a throwaway temp dir so the working directory stays clean.
process.env.SECRET_FILE_DIR ||= mkdtempSync(resolve(tmpdir(), "zoiko-secrets-"));
// Never touch real SMTP from tests — the system mailer falls back to log-only.
process.env.SYSTEM_MAIL_ENABLED = "false";
process.env.JWT_ACCESS_SECRET ??=
  "test-access-secret-minimum-32-characters-long";
process.env.JWT_REFRESH_SECRET ??=
  "test-refresh-secret-minimum-32-characters-long";
process.env.JWT_ACCESS_EXPIRES_IN ??= "12h";
process.env.JWT_REFRESH_EXPIRES_IN ??= "7d";
process.env.BCRYPT_ROUNDS ??= "4";
process.env.CORS_ORIGIN ??= "http://localhost:3000";
process.env.RATE_LIMIT_MAX = "10000";
process.env.REGISTER_RATE_LIMIT_MAX = "10000";
process.env.LOGIN_RATE_LIMIT_MAX = "10000";
process.env.REFRESH_RATE_LIMIT_MAX = "10000";
process.env.PROVIDER_CALLBACK_SECRET =
  "test-provider-callback-secret-minimum-32";
// Google sign-in ships behind a kill switch that defaults to false, so its
// routes 403 unless it is on. Set here rather than inherited from .env: the
// suite must not pass or fail depending on whether a developer happens to
// have enabled the flag locally.
process.env.FLAG_GOOGLE_LOGIN_ENABLED = "true";
// Microsoft 365 OAuth (ZM-BE-006): stable fake credentials for the suite.
// MICROSOFT_NOTIFICATION_URL is intentionally left unset so Graph subscriptions
// stay deferred in tests (no outbound Graph calls happen).
process.env.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? "test-msal-client-id";
process.env.MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET ?? "test-msal-client-secret";
process.env.MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID ?? "common";
process.env.MICROSOFT_REDIRECT_URI =
  process.env.MICROSOFT_REDIRECT_URI ?? "http://localhost:4000/api/v1/connectors/callback/microsoft";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else if (
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes("_test")
) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\/zoiko_mail(\?|$)/,
    "/zoiko_mail_test$1"
  );
} else if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://postgres:postgres@localhost:5432/zoiko_mail_test?schema=public";
}

beforeEach(async () => {
  const { prisma } = await import("../src/config/prisma.js");

  // audit_events is append-only at the database (migration
  // 20260820120000_audit_events_append_only), and deleting tenants cascades
  // into it. Wiping between tests is a legitimate purge, so it declares
  // itself the same way the confirmed tenant-deletion path does. One
  // transaction, because SET LOCAL is transaction-scoped — issuing it outside
  // one would either leak onto a pooled connection or not apply at all.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL zoiko.audit_purge = 'on'");

    await tx.refreshToken.deleteMany();
    await tx.tenantDeletionReceipt.deleteMany();
    await tx.auditEvent.deleteMany();
    await tx.supportAccessGrant.deleteMany();
    await tx.integrationLink.deleteMany();
    await tx.providerEvent.deleteMany();
    await tx.connectedAccount.deleteMany();
    await tx.dataLifecycleRequest.deleteMany();
    await tx.backgroundJob.deleteMany();
    await tx.notification.deleteMany();
    await tx.commitment.deleteMany();
    await tx.aIAction.deleteMany();
    await tx.emailMessage.deleteMany();
    await tx.tenantPolicy.deleteMany();
    await tx.tenantMembership.deleteMany();
    await tx.appUser.deleteMany();
    await tx.tenant.deleteMany();
  });

  await prisma.tenant.create({
    data: {
      id: "00000000-0000-4000-8000-000000000000",
      name: "System",
      status: "ACTIVE",
      planCode: "system",
    },
  });
});

afterAll(async () => {
  const { disconnectPrisma } = await import("../src/config/prisma.js");
  await disconnectPrisma();
});
