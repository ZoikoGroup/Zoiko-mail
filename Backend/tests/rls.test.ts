import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant, withTenant } from "../src/config/tenantScope.js";

const app = createApp();

/**
 * Row-level security — AC-004, Security §8.1.
 *
 * "Tenant isolation is enforced at application layer and backed by RLS or
 * approved compensating controls for high-sensitivity tables." The
 * application layer was already there: every query carries
 * `where: { tenantId }`. These tests are about the layer underneath, and the
 * only question that matters for it is what happens when the application
 * layer fails — when a query has no tenant filter at all.
 *
 * Worth stating what the first version of this got wrong, because the shape
 * of the mistake is the reason these tests exist. The policies were enabled
 * and FORCEd, and the whole suite passed unchanged, which looked like
 * success. It was the opposite: the runtime connects as a superuser, and a
 * superuser bypasses row-level security whatever any policy says. Enabled,
 * forced, and completely inert. Nothing short of asserting a leak *is*
 * prevented would have caught that, which is what the first block below does.
 */

/** The tables Security §8.1 names, as far as this schema has them. */
const PROTECTED_TABLES = [
  "email_messages",
  "message_threads",
  "message_recipients",
  "message_attachments",
  "mailbox_messages",
  "commitments",
  "ai_actions",
  "audit_events",
];

/** Two workspaces, each holding one message, created out of band. */
async function twoWorkspaces() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const first = await registerUser(app, { email: `rls-a-${suffix}@zoiko.test` });
  const second = await registerUser(app, { email: `rls-b-${suffix}@zoiko.test` });

  for (const owner of [first, second]) {
    await withCrossTenant(async () =>
      prisma.emailMessage.create({
        data: {
          tenantId: owner.tenantId,
          authorUserId: owner.userId,
          subject: `secret of ${owner.tenantId}`,
          status: "SENT",
        },
      })
    );
  }
  return { first, second };
}

describe("the policies are not inert", () => {
  it("runs scoped statements as a role that cannot bypass them", async () => {
    const { first } = await twoWorkspaces();

    const rows = await withTenant(first.tenantId, async () =>
      prisma.$queryRawUnsafe<Array<{ role: string; superuser: boolean; bypass: boolean }>>(
        "SELECT current_user::text AS role, rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user"
      )
    );

    // The whole control rests on this. A superuser, or any role holding
    // BYPASSRLS, ignores every policy in the database.
    expect(rows[0]!.role).toBe("zoiko_app");
    expect(rows[0]!.superuser).toBe(false);
    expect(rows[0]!.bypass).toBe(false);
  });

  it("covers every table §8.1 names that this schema has", async () => {
    const rows = await withCrossTenant(async () =>
      prisma.$queryRawUnsafe<
        Array<{ name: string; enabled: boolean; forced: boolean; policies: number }>
      >(`
        SELECT c.relname::text AS name,
               c.relrowsecurity AS enabled,
               c.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname = ANY($1::text[])
      `, PROTECTED_TABLES)
    );

    expect(rows).toHaveLength(PROTECTED_TABLES.length);
    for (const row of rows) {
      expect(row.enabled, `${row.name} has RLS enabled`).toBe(true);
      // FORCE matters because the tables are owned by the role that runs the
      // migrations; without it the owner would be exempt.
      expect(row.forced, `${row.name} forces RLS on its owner`).toBe(true);
      expect(row.policies, `${row.name} has a policy`).toBeGreaterThan(0);
    }
  });
});

describe("a query that forgot its tenant filter", () => {
  it("sees only the workspace it is scoped to", async () => {
    const { first, second } = await twoWorkspaces();

    const rows = await withTenant(first.tenantId, async () =>
      prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
        // No WHERE clause at all. This is the failure the backstop is for.
        "SELECT tenant_id::text AS tenant_id FROM email_messages"
      )
    );

    const tenants = new Set(rows.map((row) => row.tenant_id));
    expect(tenants.has(first.tenantId)).toBe(true);
    expect(tenants.has(second.tenantId)).toBe(false);
  });

  it("sees nothing at all through the ORM, without a filter", async () => {
    const { first, second } = await twoWorkspaces();

    const all = await withTenant(first.tenantId, async () =>
      prisma.emailMessage.findMany({ select: { tenantId: true } })
    );

    // The application-layer habit is `where: { tenantId }`; this is what
    // happens the day somebody omits it.
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((row) => row.tenantId === first.tenantId)).toBe(true);
    expect(all.some((row) => row.tenantId === second.tenantId)).toBe(false);
  });

  it("cannot be widened by asking for another workspace explicitly", async () => {
    const { first, second } = await twoWorkspaces();

    // Not a leak the application would commit deliberately — but exactly what
    // an injected filter, or a mixed-up variable, would produce.
    const rows = await withTenant(first.tenantId, async () =>
      prisma.emailMessage.findMany({ where: { tenantId: second.tenantId } })
    );

    expect(rows).toHaveLength(0);
  });
});

describe("writes are checked too", () => {
  it("refuses a row belonging to another workspace", async () => {
    const { first, second } = await twoWorkspaces();

    await expect(
      withTenant(first.tenantId, async () =>
        prisma.emailMessage.create({
          data: {
            tenantId: second.tenantId,
            authorUserId: first.userId,
            subject: "smuggled",
            status: "SENT",
          },
        })
      )
    ).rejects.toThrow();

    const smuggled = await withCrossTenant(async () =>
      prisma.emailMessage.count({ where: { subject: "smuggled" } })
    );
    expect(smuggled).toBe(0);
  });

  it("refuses to update another workspace's row", async () => {
    const { first, second } = await twoWorkspaces();

    const changed = await withTenant(first.tenantId, async () =>
      prisma.emailMessage.updateMany({
        where: { tenantId: second.tenantId },
        data: { subject: "rewritten" },
      })
    );

    // Nothing matched, because nothing is visible. A row that cannot be read
    // cannot be rewritten either.
    expect(changed.count).toBe(0);
  });

  it("refuses to delete another workspace's row", async () => {
    const { first, second } = await twoWorkspaces();

    const deleted = await withTenant(first.tenantId, async () =>
      prisma.emailMessage.deleteMany({ where: { tenantId: second.tenantId } })
    );

    expect(deleted.count).toBe(0);
    const survivors = await withCrossTenant(async () =>
      prisma.emailMessage.count({ where: { tenantId: second.tenantId } })
    );
    expect(survivors).toBeGreaterThan(0);
  });
});

describe("the scope does not outlive its statement", () => {
  it("leaves nothing behind on a pooled connection", async () => {
    const { first } = await twoWorkspaces();

    await withTenant(first.tenantId, async () =>
      prisma.emailMessage.count({ where: { tenantId: first.tenantId } })
    );

    // `set_config(..., true)` and `SET LOCAL ROLE` are transaction-local,
    // which is the only reason a session variable is usable behind a
    // connection pool at all: the next request on this connection must not
    // inherit the last one's workspace.
    const after = await prisma.$queryRawUnsafe<
      Array<{ role: string; tenant: string | null }>
    >(
      "SELECT current_user::text AS role, nullif(current_setting('zoiko.tenant_id', true), '') AS tenant"
    );
    expect(after[0]!.role).not.toBe("zoiko_app");
    expect(after[0]!.tenant).toBeNull();
  });

  it("switches cleanly between two workspaces in a row", async () => {
    const { first, second } = await twoWorkspaces();

    const seenByFirst = await withTenant(first.tenantId, async () =>
      prisma.emailMessage.findMany({ select: { tenantId: true } })
    );
    const seenBySecond = await withTenant(second.tenantId, async () =>
      prisma.emailMessage.findMany({ select: { tenantId: true } })
    );

    expect(seenByFirst.every((row) => row.tenantId === first.tenantId)).toBe(true);
    expect(seenBySecond.every((row) => row.tenantId === second.tenantId)).toBe(true);
  });
});

describe("the paths that legitimately cross workspaces", () => {
  it("let an explicitly cross-tenant read see everything", async () => {
    const { first, second } = await twoWorkspaces();

    const tenants = new Set(
      (
        await withCrossTenant(async () =>
          prisma.emailMessage.findMany({ select: { tenantId: true } })
        )
      ).map((row) => row.tenantId)
    );

    // The job worker, the platform console and the test teardown all need
    // this. It is a named escape rather than a default, so the set of paths
    // that use it can be read off the code.
    expect(tenants.has(first.tenantId)).toBe(true);
    expect(tenants.has(second.tenantId)).toBe(true);
  });
});

describe("the application layer still does its own job", () => {
  it("refuses another workspace's message through the API, as it always did", async () => {
    const { first, second } = await twoWorkspaces();
    const theirs = await withCrossTenant(async () =>
      prisma.emailMessage.findFirstOrThrow({ where: { tenantId: second.tenantId } })
    );

    // §8.1 calls RLS defence in depth, and depth means the layer above is
    // still expected to answer correctly — with a 404, not an empty list.
    await request(app)
      .get(`/api/v1/mail/${theirs.id}`)
      .set(authHeader(first.accessToken))
      .expect(404);
  });
});
