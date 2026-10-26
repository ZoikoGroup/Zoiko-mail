-- AlterEnum
ALTER TYPE "CommitmentStatus" ADD VALUE 'PLANNED';

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "completed_by_user_id" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "original_due_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_checklist_items_commitment_id_position_idx" ON "task_checklist_items"("commitment_id", "position");

-- CreateIndex
CREATE INDEX "task_checklist_items_tenant_id_idx" ON "task_checklist_items"("tenant_id");

-- CreateIndex
CREATE INDEX "commitments_tenant_id_owner_user_id_completed_at_idx" ON "commitments"("tenant_id", "owner_user_id", "completed_at");

-- CreateIndex
CREATE INDEX "commitments_tenant_id_created_by_user_id_status_idx" ON "commitments"("tenant_id", "created_by_user_id", "status");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tasks finished before completion was recorded: the last update is the best
-- evidence of when, and the owner of who.
UPDATE "commitments"
SET "completed_at" = "updated_at", "completed_by_user_id" = "owner_user_id"
WHERE "status" = 'COMPLETED' AND "completed_at" IS NULL;

-- Same row-level isolation as commitments themselves.
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_checklist_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_checklist_items_tenant_isolation" ON "task_checklist_items";
CREATE POLICY "task_checklist_items_tenant_isolation" ON "task_checklist_items"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "task_checklist_items" TO zoiko_app;
