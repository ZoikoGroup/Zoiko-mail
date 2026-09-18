-- Audit §6.2 requires actor_type as a stable enumerated field, and
-- before_hash/after_hash "for material policy or permission changes".
--
-- actor_type is nullable and deliberately NOT backfilled. audit_events is
-- append-only at the database and the trigger has no break-glass path for
-- UPDATE — only the receipted whole-tenant DELETE opts in. Rewriting historical
-- rows to tidy a display value would mean suspending the one property that
-- makes this table evidence, for rows nobody is investigating. A row written
-- before the column existed honestly reads "not captured"; every row written
-- after it carries a real actor type.
--
-- Additive only: adding a nullable column and two nullable text columns does
-- not rewrite the table, so this stays safe on a large audit log.

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('USER', 'ADMIN', 'SUPPORT', 'SYSTEM', 'PROVIDER', 'AI_WORKER');

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "actor_type" "audit_actor_type",
ADD COLUMN     "after_hash" TEXT,
ADD COLUMN     "before_hash" TEXT;

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_actor_type_created_at_idx" ON "audit_events"("tenant_id", "actor_type", "created_at");
