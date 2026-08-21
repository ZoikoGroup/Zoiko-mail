import { afterAll, beforeEach } from "vitest";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env") });

process.env.NODE_ENV = "test";
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
