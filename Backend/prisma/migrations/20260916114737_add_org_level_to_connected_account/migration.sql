-- DropForeignKey
ALTER TABLE "connected_accounts" DROP CONSTRAINT "connected_accounts_membership_id_fkey";

-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "is_org_level" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "membership_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
