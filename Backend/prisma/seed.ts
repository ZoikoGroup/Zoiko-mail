import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { env } from "../src/config/env.js";

const prisma = new PrismaClient();

const SYSTEM_TENANT_ID = "00000000-0000-4000-8000-000000000000";

async function main(): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: SYSTEM_TENANT_ID },
    update: {},
    create: {
      id: SYSTEM_TENANT_ID,
      name: "System",
      status: "ACTIVE",
      planCode: "system",
    },
  });

  const passwordHash = await bcrypt.hash("Password123!", env.BCRYPT_ROUNDS);

  const owner = await prisma.appUser.upsert({
    where: { email: "owner@zoiko.test" },
    update: {},
    create: {
      email: "owner@zoiko.test",
      passwordHash,
      displayName: "Seed Owner",
      status: "ACTIVE",
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Zoiko Demo Tenant",
      status: "ACTIVE",
      planCode: "starter",
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: owner.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  const admin = await prisma.appUser.upsert({
    where: { email: "admin@zoiko.test" },
    update: {},
    create: {
      email: "admin@zoiko.test",
      passwordHash,
      displayName: "Seed Admin",
      status: "ACTIVE",
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: admin.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: admin.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const member = await prisma.appUser.upsert({
    where: { email: "member@zoiko.test" },
    update: {},
    create: {
      email: "member@zoiko.test",
      passwordHash,
      displayName: "Seed Member",
      status: "ACTIVE",
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: member.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: member.id,
      role: "MEMBER",
      status: "ACTIVE",
    },
  });

  const support = await prisma.appUser.upsert({
    where: { email: "support@zoiko.test" },
    update: {},
    create: {
      email: "support@zoiko.test",
      passwordHash,
      displayName: "Seed Support",
      status: "ACTIVE",
    },
  });

  await prisma.tenantMembership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: support.id,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: support.id,
      role: "SUPPORT",
      status: "ACTIVE",
    },
  });

  console.log("Seed completed:");
  console.log(`  Tenant: ${tenant.name} (${tenant.id})`);
  console.log("  Users: owner@zoiko.test, admin@zoiko.test, member@zoiko.test, support@zoiko.test");
  console.log("  Password for all seed users: Password123!");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
