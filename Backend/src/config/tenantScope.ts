import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The tenant every database statement is executed as — AC-004.
 *
 * "Tenant isolation is enforced at application layer and backed by RLS or
 * approved compensating controls for high-sensitivity tables." The
 * application layer was already there: every query carries `where: { tenantId
 * }`. What was missing is the backstop underneath it, and Security §8.1 names
 * the tables it wants covered.
 *
 * A row-level policy needs to know which tenant is asking, and the natural
 * place to put that — a session variable — is unusable with a connection pool,
 * because the next request on that connection would inherit it. §8.1
 * anticipates exactly this ("if connection pooling prevents safe
 * session-variable use…"). The way out is that the setting is transaction-
 * local, and this store is what tells the Prisma layer which value to set on
 * each statement.
 *
 * Async-local rather than threaded through every call: the alternative is a
 * tenant parameter on several hundred call sites, and one that is forgotten
 * silently loses its scope. Here a request sets it once and everything
 * underneath inherits it, including code that has no idea this exists.
 */

export interface TenantScope {
  /** The workspace this work belongs to. */
  tenantId?: string;
  /**
   * Deliberately unscoped work: the platform support console, the job worker
   * sweeping every workspace, a test teardown. Narrow and explicit, so that
   * reading the code tells you which paths cross the boundary.
   */
  crossTenant?: boolean;
}

const storage = new AsyncLocalStorage<TenantScope>();

export function currentTenantScope(): TenantScope | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with every statement scoped to one workspace.
 *
 * The await is deliberately *inside* the async context. A Prisma promise is
 * lazy: it does no work until something awaits it, so `withTenant(id, () =>
 * prisma.thing.find())` would return an unstarted promise, and the query
 * would then begin in whatever context happened to await it — with no scope
 * at all. Awaiting here means the work starts inside the scope however the
 * caller writes the callback.
 */
export function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ tenantId }, async () => await fn());
}

/**
 * Run `fn` without a tenant restriction.
 *
 * Used by the paths that legitimately span workspaces. Each one is a
 * deliberate choice rather than a default, which is the whole value of naming
 * it: a reader can enumerate them.
 */
export function withCrossTenant<T>(fn: () => Promise<T>): Promise<T> {
  // Awaited inside the context, for the reason withTenant explains.
  return storage.run({ crossTenant: true }, async () => await fn());
}

/**
 * The role the policies apply to.
 *
 * The runtime connects as a superuser, and a superuser bypasses row-level
 * security whatever any policy says — so the statements that carry tenant data
 * are executed as this role instead. Created by migration
 * 20260910200000_rls_app_role; NOLOGIN, so it can only ever be assumed.
 */
const RLS_ROLE = "zoiko_app";

export interface ScopeStatement {
  sql: string;
  params: string[];
}

/**
 * The transaction-local prelude a statement should run under, or null when
 * there is no scope to apply.
 *
 * Both parts are transaction-local, which is what makes this safe on a pooled
 * connection: they are discarded at commit or rollback rather than lingering
 * for whoever gets the connection next.
 *
 * The role comes first. Without it the tenant setting is read by a role that
 * ignores policies, which is the difference between a control and a comment.
 */
export function tenantScopeSql(scope: TenantScope | undefined): ScopeStatement[] | null {
  if (!scope) return null;

  if (scope.crossTenant) {
    return [
      { sql: `SET LOCAL ROLE ${RLS_ROLE}`, params: [] },
      { sql: "SELECT set_config('zoiko.cross_tenant', 'on', true)", params: [] },
    ];
  }

  if (scope.tenantId) {
    return [
      { sql: `SET LOCAL ROLE ${RLS_ROLE}`, params: [] },
      { sql: "SELECT set_config('zoiko.tenant_id', $1, true)", params: [scope.tenantId] },
    ];
  }

  return null;
}
