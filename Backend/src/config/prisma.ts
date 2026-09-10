import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";
import { currentTenantScope, tenantScopeSql } from "./tenantScope.js";

/**
 * The database client, with row-level security wired in — AC-004.
 *
 * Security §8.1 asks for RLS as defence-in-depth on the highest-sensitivity
 * tenant-owned tables, and the policies it enables read a transaction-local
 * setting to know which workspace is asking. Something has to set that
 * setting on every statement, and this is that something.
 *
 * Two paths, because Prisma has two ways of running a statement:
 *
 *   - A single operation is wrapped in a two-statement transaction — the
 *     setting, then the query. Both run on one connection, which is what
 *     makes a transaction-local setting meaningful; this is the pattern
 *     Prisma documents for RLS.
 *
 *   - An interactive transaction sets the value once, as its first statement,
 *     and the callback receives the *unextended* transaction client. That is
 *     deliberate: an extension-aware client inside a transaction would try to
 *     open the nested transaction described above, which Postgres will not do.
 *
 * The cost is a second round trip per non-transactional query. That is the
 * price of the backstop, and it buys the property that a query which forgets
 * its `where: { tenantId }` returns nothing instead of somebody else's mail.
 */

const globalForPrisma = globalThis as unknown as {
  prismaBase?: PrismaClient;
};

/**
 * The raw client. Kept separate from the exported one so that the statements
 * this file issues itself do not re-enter the extension and recurse.
 */
const base =
  globalForPrisma.prismaBase ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prismaBase = base;
}

const scoped = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      const prelude = tenantScopeSql(currentTenantScope());
      // No scope at all: the statement runs as it always did, as the
      // connecting role. Those are the paths that run before a tenant is
      // resolved — signing in, reading a user row — and they touch none of
      // the protected tables. Everything that does touch them declares a
      // scope, and gets the policies.
      if (!prelude) return query(args);

      const results = await base.$transaction([
        ...prelude.map((statement) => base.$queryRawUnsafe(statement.sql, ...statement.params)),
        query(args),
      ]);
      return results[results.length - 1];
    },
  },
});

/**
 * Exported as `PrismaClient` rather than as the extended type.
 *
 * The extension adds a query hook and no surface at all, so the two are the
 * same shape to every caller — while the extended *type* is structurally
 * different enough that a transaction client no longer satisfies
 * `Prisma.TransactionClient`, which several dozen call sites pass around. The
 * cast keeps those honest signatures working; nothing in the codebase can
 * observe a difference.
 */
type ScopedClient = PrismaClient;

/**
 * `$transaction`, with the scope applied inside it.
 *
 * Intercepted rather than replaced at the call sites: there are seventy-odd
 * of them, and a Proxy makes every one correct without touching any of them —
 * including the ones written after this.
 */
export const prisma: ScopedClient = new Proxy(scoped as unknown as PrismaClient, {
  get(target, property, receiver) {
    if (property !== "$transaction") {
      return Reflect.get(target, property, receiver);
    }

    return (arg: unknown, options?: unknown) => {
      const prelude = tenantScopeSql(currentTenantScope());

      if (typeof arg === "function") {
        const callback = arg as (tx: unknown) => Promise<unknown>;
        return base.$transaction(async (tx) => {
          for (const statement of prelude ?? []) {
            await tx.$queryRawUnsafe(statement.sql, ...statement.params);
          }
          return callback(tx);
        }, options as Parameters<typeof base.$transaction>[1]);
      }

      const operations = arg as Array<Promise<unknown>>;
      if (!prelude) {
        return base.$transaction(operations as never, options as never);
      }
      // The prelude goes in first and its results are dropped, so callers
      // still destructure exactly what they asked for.
      return base
        .$transaction(
          [
            ...prelude.map((statement) =>
              base.$queryRawUnsafe(statement.sql, ...statement.params)
            ),
            ...operations,
          ] as never,
          options as never
        )
        .then((results) => (results as unknown[]).slice(prelude.length));
    };
  },
}) as ScopedClient;

export async function disconnectPrisma(): Promise<void> {
  await base.$disconnect();
}
