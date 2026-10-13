-- Durable cleanup of hosted mailboxes on the mail host (Stalwart).
--
-- Additive only: two nullable columns on mailboxes, one new table and its
-- enums. Existing rows are unaffected.
--
-- Deleting a Zoiko mailbox, a member or a whole workspace used to leave the
-- account on the mail host behind. This table records the work still owed to
-- the host, in the same transaction that deletes the Zoiko rows.

ALTER TABLE "mailboxes"
  ADD COLUMN "deletion_requested_at" TIMESTAMP(3),
  ADD COLUMN "deletion_error" TEXT;

CREATE TYPE "MailProviderCleanupStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED');
CREATE TYPE "MailProviderCleanupReason" AS ENUM ('ADMIN_DELETE', 'USER_ERASURE', 'TENANT_ERASURE');

-- No foreign keys, on purpose. A relation to tenants would cascade-delete the
-- task together with the workspace whose host accounts it exists to remove.
-- tenant_id and mailbox_id are plain identifiers.
CREATE TABLE "mail_provider_cleanup_tasks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "mailbox_id" UUID NOT NULL,
  "provider" "MailHostProvider" NOT NULL,
  "provider_account_id" TEXT,
  "address" TEXT NOT NULL,
  "credential_ref" TEXT NOT NULL,
  "reason" "MailProviderCleanupReason" NOT NULL,
  "require_empty" BOOLEAN NOT NULL,
  "status" "MailProviderCleanupStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 10,
  "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "provider_gone_at" TIMESTAMP(3),
  "secret_removed_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "outcome" TEXT,
  "requested_by_user_id" UUID,
  "request_id" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mail_provider_cleanup_tasks_pkey" PRIMARY KEY ("id")
);

-- One cleanup per mailbox: enqueueing the same mailbox twice is a no-op.
CREATE UNIQUE INDEX "mail_provider_cleanup_tasks_mailbox_id_key" ON "mail_provider_cleanup_tasks"("mailbox_id");
CREATE INDEX "mail_provider_cleanup_tasks_status_run_at_idx" ON "mail_provider_cleanup_tasks"("status", "run_at");
CREATE INDEX "mail_provider_cleanup_tasks_tenant_id_idx" ON "mail_provider_cleanup_tasks"("tenant_id");

-- Row-level security, as for the other tenant-owned tables (AC-004, Security
-- §8.1). The policy is the same one: a request scoped to a workspace sees only
-- its own tasks, and the cleanup worker declares itself cross-tenant. The
-- grants to zoiko_app come from the default privileges set by
-- 20260910200000_rls_app_role.
ALTER TABLE "mail_provider_cleanup_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_provider_cleanup_tasks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mail_provider_cleanup_tasks_tenant_isolation" ON "mail_provider_cleanup_tasks";
CREATE POLICY "mail_provider_cleanup_tasks_tenant_isolation" ON "mail_provider_cleanup_tasks"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());
