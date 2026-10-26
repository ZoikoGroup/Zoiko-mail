import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { hashPassword } from "../src/common/utils/password.js";

/**
 * A throwaway workspace for the end-to-end browser test of Tasks
 * (Frontend/e2e/tasks-real.spec.ts), in the local dev database.
 *
 *   npx tsx scripts/e2e-tasks-fixture.ts create   → prints the fixture as JSON
 *   npx tsx scripts/e2e-tasks-fixture.ts delete <tenantId>
 *
 * Two Members — a lead and a teammate — each with a mailbox, both on one
 * shared mailbox (their team workspace), and an email waiting in the lead's
 * Inbox to turn into a task. Everything is named e2e-tasks-* and retired by
 * `delete`, which refuses any workspace not named that way.
 *
 * Development only: it writes to whatever DATABASE_URL points at.
 */

const PASSWORD = "E2e-Tasks-Passw0rd";
const PREFIX = "e2e-tasks-";

async function create() {
  const stamp = `${Date.now()}`;
  const domain = `${PREFIX}${stamp}.test`;
  const passwordHash = await hashPassword(PASSWORD);
  const fixture = await withCrossTenant(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `${PREFIX}${stamp}`, planCode: "starter" } });
    const people: Array<{ address: string; userId: string; membershipId: string; mailboxId: string; name: string }> = [];
    for (const [local, name] of [["lead", "E2E Lead"], ["mate", "E2E Mate"]] as const) {
      const user = await prisma.appUser.create({
        data: { email: `${PREFIX}${local}-${stamp}@personal.test`, displayName: name, passwordHash, status: "ACTIVE", emailVerifiedAt: new Date() },
      });
      const membership = await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: user.id, role: "MEMBER", status: "ACTIVE" } });
      const mailbox = await prisma.mailbox.create({
        data: { tenantId: tenant.id, membershipId: membership.id, address: `${local}@${domain}`, displayName: name, workspaces: ["MEMBER"] },
      });
      people.push({ address: mailbox.address, userId: user.id, membershipId: membership.id, mailboxId: mailbox.id, name });
    }
    const [lead, mate] = people as [(typeof people)[0], (typeof people)[0]];

    // The team: a shared mailbox both can read.
    const team = await prisma.mailbox.create({
      data: { tenantId: tenant.id, type: "SHARED", address: `ops@${domain}`, displayName: "E2E Operations", workspaces: ["MEMBER"] },
    });
    for (const person of people) {
      await prisma.mailboxAccess.create({
        data: { tenantId: tenant.id, mailboxId: team.id, membershipId: person.membershipId, canRead: true, canSend: true, grantedByUserId: lead.userId },
      });
    }

    // An email in the lead's Inbox, to become a task.
    const thread = await prisma.messageThread.create({
      data: { tenantId: tenant.id, subjectNormalized: "q4 proposal revisions", participants: ["client@outside.test", lead.address], firstMessageAt: new Date(), lastMessageAt: new Date() },
    });
    const message = await prisma.emailMessage.create({
      data: {
        tenantId: tenant.id,
        authorUserId: lead.userId,
        threadId: thread.id,
        subject: "Q4 proposal revisions",
        textBody: "Please confirm the scope and send consolidated feedback by Friday.",
        status: "RECEIVED",
        sentAt: new Date(),
        fromAddress: "client@outside.test",
        fromName: "Lena Client",
        mailboxItems: { create: { tenantId: tenant.id, mailboxId: lead.mailboxId, folder: "INBOX", isRead: false } },
      },
    });
    return {
      tenantId: tenant.id,
      password: PASSWORD,
      lead: { address: lead.address, name: lead.name, userId: lead.userId },
      mate: { address: mate.address, name: mate.name, userId: mate.userId },
      team: { id: team.id, name: "E2E Operations" },
      message: { id: message.id, subject: "Q4 proposal revisions" },
    };
  });
  process.stdout.write(`${JSON.stringify(fixture)}\n`);
}

async function remove(tenantId: string) {
  await withCrossTenant(async () => {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    if (!tenant) return;
    if (!tenant.name.startsWith(PREFIX)) throw new Error(`Refusing to delete ${tenantId}: not an e2e-tasks workspace`);
    // Retired rather than deleted: the audit log is append-only by design, so
    // a workspace that has been used cannot be removed. What is left cannot
    // sign in, and nothing in it fires again.
    const users = await prisma.tenantMembership.findMany({ where: { tenantId }, select: { userId: true } });
    await prisma.$transaction([
      prisma.commitment.updateMany({ where: { tenantId }, data: { reminderAt: null } }),
      prisma.tenantMembership.updateMany({ where: { tenantId }, data: { status: "REMOVED" } }),
      prisma.appUser.updateMany({ where: { id: { in: users.map((u) => u.userId) }, email: { startsWith: PREFIX } }, data: { status: "DISABLED" } }),
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
