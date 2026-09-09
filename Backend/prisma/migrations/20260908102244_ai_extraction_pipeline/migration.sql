-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'AI_EXTRACTION';
ALTER TYPE "JobType" ADD VALUE 'AI_DRAFT_GENERATION';

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "source_ai_action_id" UUID;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_source_ai_action_id_fkey" FOREIGN KEY ("source_ai_action_id") REFERENCES "ai_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
