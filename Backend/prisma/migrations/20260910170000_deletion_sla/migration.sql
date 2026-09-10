-- The 30-day hard-delete SLA — AC-012, Data Model §6.14.
--
-- "Customer data subject to deletion must be hard-deleted or irreversibly
-- anonymized within 30 days unless legal/security retention exception
-- applies." The deletion workflow existed and worked, but had nothing to hang
-- an SLA on: no verification moment to count from, no deadline, no way to
-- record a legal hold, and no way to name a target narrower than the whole
-- workspace. A workflow that cannot say when a deletion is late does not have
-- an SLA; it has an intention.
--
-- The deadline is derived by the server from verified_at and is never accepted
-- from a client, which is how §6.14's "scheduler enforces <= 30 days" is
-- enforced rather than documented.
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'VERIFIED' BEFORE 'APPROVED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'BLOCKED' AFTER 'APPROVED';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED' BEFORE 'PROCESSING';
ALTER TYPE "LifecycleStatus" ADD VALUE IF NOT EXISTS 'FAILED' AFTER 'COMPLETED';

CREATE TYPE "LifecycleTargetType" AS ENUM (
  'TENANT', 'MAILBOX', 'CONNECTED_ACCOUNT', 'USER', 'AI_OUTPUTS', 'SYNCED_DATA'
);

ALTER TABLE "data_lifecycle_requests"
  ADD COLUMN "target_type"          "LifecycleTargetType",
  ADD COLUMN "target_id"            UUID,
  ADD COLUMN "verified_at"          TIMESTAMP(3),
  ADD COLUMN "scheduled_for"        TIMESTAMP(3),
  ADD COLUMN "hard_delete_deadline" TIMESTAMP(3),
  ADD COLUMN "block_reason"         TEXT;

-- §6.14: "scheduled_for must be <= hard_delete_deadline". Enforced here as
-- well as in the service, because a scheduling bug that pushed execution past
-- the deadline would breach the SLA silently.
ALTER TABLE "data_lifecycle_requests"
  ADD CONSTRAINT "data_lifecycle_requests_schedule_within_deadline"
    CHECK ("scheduled_for" IS NULL
           OR "hard_delete_deadline" IS NULL
           OR "scheduled_for" <= "hard_delete_deadline");

-- §6.14's ix_deletion_deadline: SLA monitoring sweeps by deadline across
-- tenants, so this index is deliberately not tenant-first.
CREATE INDEX "data_lifecycle_requests_status_hard_delete_deadline_idx"
  ON "data_lifecycle_requests"("status", "hard_delete_deadline");
-- §6.14's ix_deletion_tenant: the per-workspace queue view.
CREATE INDEX "data_lifecycle_requests_tenant_id_status_created_at_idx"
  ON "data_lifecycle_requests"("tenant_id", "status", "created_at" DESC);
