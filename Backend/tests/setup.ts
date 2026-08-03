import { beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(process.cwd(), ".env") });

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET ??=
  "test-access-secret-minimum-32-characters-long";
process.env.JWT_REFRESH_SECRET ??=
  "test-refresh-secret-minimum-32-characters-long";
process.env.JWT_ACCESS_EXPIRES_IN ??= "15m";
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

beforeAll(() => {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
});

beforeEach(async () => {
  const { prisma } = await import("../src/config/prisma.js");

  await prisma.refreshToken.deleteMany();
  await prisma.tenantDeletionReceipt.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.supportAccessGrant.deleteMany();
  await prisma.integrationLink.deleteMany();
  await prisma.providerEvent.deleteMany();
  await prisma.connectedAccount.deleteMany();
  await prisma.dataLifecycleRequest.deleteMany();
  await prisma.backgroundJob.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.commitment.deleteMany();
  await prisma.aIAction.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.tenantPolicy.deleteMany();
  await prisma.tenantMembership.deleteMany();
  await prisma.appUser.deleteMany();
  await prisma.tenant.deleteMany();

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
