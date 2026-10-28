import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { hashPassword } from "../src/common/utils/password.js";
import { generateTotpSecret } from "../src/modules/auth/totp.js";
import { __mfaInternals } from "../src/modules/auth/mfa.service.js";

/**
 * A throwaway workspace for the browser tests that run against the real API
 * (Frontend/e2e/*-real.spec.ts, mail-realtime.spec.ts), in the local dev
 * database.
 *
 *   npx tsx scripts/e2e-realtime-fixture.ts create [--staff]   → prints the fixture as JSON
 *   npx tsx scripts/e2e-realtime-fixture.ts delete <tenantId>
 *
 * Two Members, each with a mailbox on a made-up domain, signing in with the
 * Member login (no second factor). With --staff, also an Owner, an Admin and
 * a Support member, each with an authenticator already enrolled (the roles
 * that must use one); the fixture prints their TOTP secrets so a test can
 * compute codes. Everything it creates is named e2e-rt-* and retired by
 * `delete`, which refuses any workspace not named that way.
 *
 * Development only: it writes to whatever DATABASE_URL points at.
 */

const PASSWORD = "E2e-Realtime-Passw0rd";
const PREFIX = "e2e-rt-";

async function create(withStaff: boolean) {
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
    const staff: Record<string, { email: string; mfaSecret: string }> = {};
    if (withStaff) {
      for (const role of ["OWNER", "ADMIN", "SUPPORT"] as const) {
        const mfaSecret = generateTotpSecret();
        const user = await prisma.appUser.create({
          data: {
            email: `${PREFIX}${role.toLowerCase()}-${stamp}@personal.test`,
            displayName: `E2E ${role.toLowerCase()}`,
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
            mfaSecret: __mfaInternals.encryptSecret(mfaSecret),
            mfaEnrolledAt: new Date(),
          },
        });
        await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role, status: "ACTIVE" } });
        staff[role] = { email: user.email, mfaSecret };
        // The Owner also administers a second workspace, so signing in goes
        // through the workspace picker and "Switch workspace" is offered.
        if (role === "OWNER") {
          const second = await prisma.tenant.create({ data: { name: `${PREFIX}${stamp}-b`, planCode: "starter" } });
          await prisma.tenantMembership.create({ data: { tenantId: second.id, userId: user.id, role: "ADMIN", status: "ACTIVE" } });
        }
      }
    }
    return { tenantId: tenant.id, password: PASSWORD, sender: people[0], recipient: people[1], ...(withStaff ? { staff } : {}) };
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
    // With --staff there is a second workspace, named after the first plus "-b".
    const seconds = await prisma.tenant.findMany({ where: { name: `${tenant.name}-b` }, select: { id: true } });
    const tenantIds = [tenantId, ...seconds.map((t) => t.id)];
    const users = await prisma.tenantMembership.findMany({ where: { tenantId: { in: tenantIds } }, select: { userId: true } });
    await prisma.$transaction([
      prisma.tenantMembership.updateMany({ where: { tenantId: { in: tenantIds } }, data: { status: "REMOVED" } }),
      prisma.appUser.updateMany({
        where: { id: { in: users.map((u) => u.userId) }, email: { startsWith: PREFIX } },
        data: { status: "DISABLED" },
      }),
      prisma.tenant.updateMany({ where: { id: { in: tenantIds } }, data: { status: "SUSPENDED" } }),
    ]);
  });
}

const [command, argument] = process.argv.slice(2);
(command === "create" ? create(argument === "--staff") : command === "delete" && argument ? remove(argument) : Promise.reject(new Error("usage: create | delete <tenantId>")))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
