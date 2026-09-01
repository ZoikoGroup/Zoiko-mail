import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RULES = { defaultEffect: "ALLOW", conditions: [] };
const TYPES = ["SENDING", "AI"] as const;

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });

  for (const tenant of tenants) {
    const owner = await prisma.tenantMembership.findFirst({
      where: { tenantId: tenant.id, role: "OWNER", status: "ACTIVE" },
      select: { userId: true },
    });
    if (!owner) {
      console.warn(`skip "${tenant.name}" — no active owner`);
      continue;
    }

    for (const type of TYPES) {
      const active = await prisma.tenantPolicy.findFirst({
        where: { tenantId: tenant.id, type, status: "ACTIVE" },
      });
      if (active) {
        console.log(`ok   "${tenant.name}" already has an active ${type} policy`);
        continue;
      }

      // @@unique([tenantId, type, version]) — a hardcoded version 1 would
      // collide with any existing DRAFT or ARCHIVED policy of this type.
      const latest = await prisma.tenantPolicy.aggregate({
        where: { tenantId: tenant.id, type },
        _max: { version: true },
      });

      await prisma.tenantPolicy.create({
        data: {
          tenantId: tenant.id,
          type,
          name: `Default ${type.toLowerCase()} policy`,
          description: "Backfilled default policy.",
          version: (latest._max.version ?? 0) + 1,
          status: "ACTIVE",
          rules: RULES,
          createdByUserId: owner.userId,
          activatedAt: new Date(),
        },
      });
      console.log(`done "${tenant.name}" — created ${type} policy`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());