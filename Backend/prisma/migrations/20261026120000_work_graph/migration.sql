-- CreateEnum
CREATE TYPE "WorkVisibility" AS ENUM ('PRIVATE', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "WorkStreamStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkCommitmentStatus" AS ENUM ('AWAITING', 'IN_PROGRESS', 'RECORDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'DEFERRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "WorkEvidenceKind" AS ENUM ('EMAIL', 'MEETING', 'DOCUMENT', 'NOTE');

-- CreateEnum
CREATE TYPE "WorkSubjectType" AS ENUM ('STREAM', 'COMMITMENT', 'DECISION');

-- CreateEnum
CREATE TYPE "WorkBlockerType" AS ENUM ('DECISION', 'COMMITMENT');

-- CreateTable
CREATE TABLE "work_streams" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_membership_id" UUID,
    "owner_label" TEXT,
    "next_checkpoint_at" TIMESTAMP(3),
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "WorkStreamStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibility" "WorkVisibility" NOT NULL DEFAULT 'PRIVATE',
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_commitments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stream_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_membership_id" UUID,
    "owner_label" TEXT,
    "expected_from" TEXT,
    "due_at" TIMESTAMP(3),
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "WorkCommitmentStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "visibility" "WorkVisibility" NOT NULL DEFAULT 'PRIVATE',
    "recorded_at" TIMESTAMP(3),
    "source_ai_action_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stream_id" UUID,
    "title" TEXT NOT NULL,
    "rationale" TEXT,
    "owner_membership_id" UUID,
    "owner_label" TEXT,
    "approver_membership_id" UUID,
    "review_at" TIMESTAMP(3),
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "WorkDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "decided_by_membership_id" UUID,
    "decision_note" TEXT,
    "superseded_by_id" UUID,
    "visibility" "WorkVisibility" NOT NULL DEFAULT 'PRIVATE',
    "source_ai_action_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_dependencies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stream_id" UUID,
    "deliverable" TEXT NOT NULL,
    "description" TEXT,
    "owner_membership_id" UUID,
    "owner_label" TEXT,
    "blocker_type" "WorkBlockerType" NOT NULL,
    "blocker_decision_id" UUID,
    "blocker_commitment_id" UUID,
    "visibility" "WorkVisibility" NOT NULL DEFAULT 'PRIVATE',
    "resolved_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_evidence" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" "WorkSubjectType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "kind" "WorkEvidenceKind" NOT NULL,
    "ref_id" UUID,
    "label" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "added_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_streams_tenant_id_status_idx" ON "work_streams"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_commitments_source_ai_action_id_key" ON "work_commitments"("source_ai_action_id");

-- CreateIndex
CREATE INDEX "work_commitments_tenant_id_status_due_at_idx" ON "work_commitments"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "work_commitments_tenant_id_stream_id_idx" ON "work_commitments"("tenant_id", "stream_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_decisions_source_ai_action_id_key" ON "work_decisions"("source_ai_action_id");

-- CreateIndex
CREATE INDEX "work_decisions_tenant_id_status_review_at_idx" ON "work_decisions"("tenant_id", "status", "review_at");

-- CreateIndex
CREATE INDEX "work_decisions_tenant_id_stream_id_idx" ON "work_decisions"("tenant_id", "stream_id");

-- CreateIndex
CREATE INDEX "work_dependencies_tenant_id_resolved_at_idx" ON "work_dependencies"("tenant_id", "resolved_at");

-- CreateIndex
CREATE INDEX "work_dependencies_blocker_decision_id_idx" ON "work_dependencies"("blocker_decision_id");

-- CreateIndex
CREATE INDEX "work_dependencies_blocker_commitment_id_idx" ON "work_dependencies"("blocker_commitment_id");

-- CreateIndex
CREATE INDEX "work_evidence_tenant_id_subject_type_subject_id_idx" ON "work_evidence"("tenant_id", "subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "work_streams" ADD CONSTRAINT "work_streams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_streams" ADD CONSTRAINT "work_streams_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_streams" ADD CONSTRAINT "work_streams_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_commitments" ADD CONSTRAINT "work_commitments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_commitments" ADD CONSTRAINT "work_commitments_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "work_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_commitments" ADD CONSTRAINT "work_commitments_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_commitments" ADD CONSTRAINT "work_commitments_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "work_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_approver_membership_id_fkey" FOREIGN KEY ("approver_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_decided_by_membership_id_fkey" FOREIGN KEY ("decided_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "work_streams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_blocker_decision_id_fkey" FOREIGN KEY ("blocker_decision_id") REFERENCES "work_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_blocker_commitment_id_fkey" FOREIGN KEY ("blocker_commitment_id") REFERENCES "work_commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_evidence" ADD CONSTRAINT "work_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_evidence" ADD CONSTRAINT "work_evidence_added_by_membership_id_fkey" FOREIGN KEY ("added_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- There is deliberately no "must have an owner" constraint: the owner column is
-- ON DELETE SET NULL, so removing a member must not be blocked by the items they
-- owned (they then show as Unassigned). The service requires an owner when an
-- item is created or reassigned.

-- A dependency is blocked by exactly one thing, and it is the kind it says it is.
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_blocker_check"
  CHECK (
    (blocker_type = 'DECISION' AND blocker_decision_id IS NOT NULL AND blocker_commitment_id IS NULL)
    OR (blocker_type = 'COMMITMENT' AND blocker_commitment_id IS NOT NULL AND blocker_decision_id IS NULL)
  );

-- Evidence that points at a message or a meeting says which one.
ALTER TABLE "work_evidence" ADD CONSTRAINT "work_evidence_ref_check"
  CHECK ((kind IN ('EMAIL', 'MEETING') AND ref_id IS NOT NULL) OR kind IN ('DOCUMENT', 'NOTE'));

-- The same source is attached to the same thing once.
CREATE UNIQUE INDEX "work_evidence_one_ref_per_subject"
  ON "work_evidence"("subject_type", "subject_id", "kind", "ref_id") WHERE ref_id IS NOT NULL;

-- Same row-level isolation as the rest of the calendar and mail data (AC-004).
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['work_streams', 'work_commitments', 'work_decisions', 'work_dependencies', 'work_evidence']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_tenant_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant()) WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())',
      target || '_tenant_isolation',
      target
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "work_streams" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "work_commitments" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "work_decisions" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "work_dependencies" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "work_evidence" TO zoiko_app;
