-- Erasing a person must not delete the team's records. Who created or attached
-- something becomes optional, and goes to NULL (shown as a former member) when
-- the membership is erased; the lifecycle erasure removes the erased person's own
-- private items separately.

-- DropForeignKey
ALTER TABLE "work_commitments" DROP CONSTRAINT "work_commitments_created_by_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "work_decisions" DROP CONSTRAINT "work_decisions_created_by_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "work_dependencies" DROP CONSTRAINT "work_dependencies_created_by_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "work_evidence" DROP CONSTRAINT "work_evidence_added_by_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "work_streams" DROP CONSTRAINT "work_streams_created_by_membership_id_fkey";

-- AlterTable
ALTER TABLE "work_commitments" ALTER COLUMN "created_by_membership_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "work_decisions" ALTER COLUMN "created_by_membership_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "work_dependencies" ALTER COLUMN "created_by_membership_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "work_evidence" ALTER COLUMN "added_by_membership_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "work_streams" ALTER COLUMN "created_by_membership_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "work_streams" ADD CONSTRAINT "work_streams_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_commitments" ADD CONSTRAINT "work_commitments_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_decisions" ADD CONSTRAINT "work_decisions_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_evidence" ADD CONSTRAINT "work_evidence_added_by_membership_id_fkey" FOREIGN KEY ("added_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

