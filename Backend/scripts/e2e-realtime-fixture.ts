import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { hashPassword } from "../src/common/utils/password.js";

/**
 * A throwaway workspace for the browser test of live mail delivery
 * (Frontend/e2e/mail-realtime.spec.ts), in the local dev database.
 *
 *   npx tsx scripts/e2e-realtime-fixture.ts create   → prints the fixture as JSON
 *   npx tsx scripts/e2e-realtime-fixture.ts delete <tenantId>
 *
 * Two Members, each with a mailbox on a made-up domain, signing in with the
 * Member login (no second factor). Everything it creates is named e2e-rt-*
 * and retired by `delete`, which refuses any workspace not named that way.
 *
 * Development only: it writes to whatever DATABASE_URL points at.
 */

const PASSWORD = "E2e-Realtime-Passw0rd";
const PREFIX = "e2e-rt-";

async function create() {
  const stamp = `${Date.now()}`;
  const domain = `${PREFIX}${stamp}.test`;
  const passwordHash = await hashPassword(PASSWORD);
  const fixture = await withCrossTenant(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `${PREFIX}${stamp}`, planCode: "starter" } });
    const people = [];
    for (const local of ["sender", "recipient"]) {
      const user = await prisma.appUser.create({
        data: {
          email: `${PREFIX}${local}-${stamp}@personal.test`,
          displayName: `E2E ${local}`,
          passwordHash,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
      const membership = await prisma.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, role: "MEMBER", status: "ACTIVE" },
      });
      const mailbox = await prisma.mailbox.create({
        data: { tenantId: tenant.id, membershipId: membership.id, address: `${local}@${domain}`, workspaces: ["MEMBER"] },
      });
      people.push({ address: mailbox.address, userId: user.id });
    }
    // The allow-all sending and AI policies every new workspace gets; without
    // them, sending and the AI assistant are refused with NO_ACTIVE_POLICY.
    for (const [type, name] of [["SENDING", "Default sending policy"], ["AI", "Default AI policy"]] as const) {
      await prisma.tenantPolicy.create({
        data: {
          tenantId: tenant.id,
          type,
          name,
          version: 1,
          status: "ACTIVE",
          rules: { defaultEffect: "ALLOW", conditions: [] },
          createdByUserId: people[0]!.userId,
          activatedAt: new Date(),
        },
      });
    }
    return { tenantId: tenant.id, password: PASSWORD, sender: people[0], recipient: people[1] };
  });
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}

async function remove(tenantId: string) {
  await withCrossTenant(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    if (!tenant) return;
    if (!tenant.name.startsWith(PREFIX)) throw new Error(`Refusing to delete ${tenantId}: not an e2e-rt workspace`);
    // Retired rather than deleted: the audit log is append-only by design, so
    // a workspace that has been signed into cannot be removed. What is left
    // cannot sign in, and its mailboxes no longer receive mail.
    const users = await prisma.tenantMembership.findMany({ where: { tenantId }, select: { userId: true } });
    await prisma.$transaction([
      prisma.tenantMembership.updateMany({ where: { tenantId }, data: { status: "REMOVED" } }),
      prisma.appUser.updateMany({
        where: { id: { in: users.map((u) => u.userId) }, email: { startsWith: PREFIX } },
        data: { status: "DISABLED" },
      }),
      prisma.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED" } }),
    ]);
  });
}

const [command, argument] = process.argv.slice(2);
(command === "create" ? create() : command === "delete" && argument ? remove(argument) : Promise.reject(new Error("usage: create | delete <tenantId>")))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
