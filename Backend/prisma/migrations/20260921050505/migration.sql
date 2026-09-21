/*
  Warnings:

  - You are about to drop the column `is_org_level` on the `connected_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `device_label` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `ip_address` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `last_used_at` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the column `user_agent` on the `refresh_tokens` table. All the data in the column will be lost.
  - You are about to drop the `mail_group_members` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mail_groups` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ownership_transfers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `security_alerts` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `membership_id` on table `connected_accounts` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "connected_accounts" DROP CONSTRAINT "connected_accounts_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "mail_group_members" DROP CONSTRAINT "mail_group_members_group_id_fkey";

-- DropForeignKey
ALTER TABLE "mail_group_members" DROP CONSTRAINT "mail_group_members_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "mail_groups" DROP CONSTRAINT "mail_groups_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "ownership_transfers" DROP CONSTRAINT "ownership_transfers_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ownership_transfers" DROP CONSTRAINT "ownership_transfers_initiator_user_id_fkey";

-- DropForeignKey
ALTER TABLE "ownership_transfers" DROP CONSTRAINT "ownership_transfers_target_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "ownership_transfers" DROP CONSTRAINT "ownership_transfers_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "security_alerts" DROP CONSTRAINT "security_alerts_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "security_alerts" DROP CONSTRAINT "security_alerts_resolved_by_id_fkey";

-- DropForeignKey
ALTER TABLE "security_alerts" DROP CONSTRAINT "security_alerts_tenant_id_fkey";

-- DropIndex
DROP INDEX "support_access_grants_ticket_id_idx";

-- AlterTable
ALTER TABLE "connected_accounts" DROP COLUMN "is_org_level",
ALTER COLUMN "membership_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" DROP COLUMN "device_label",
DROP COLUMN "ip_address",
DROP COLUMN "last_used_at",
DROP COLUMN "user_agent";

-- DropTable
DROP TABLE "mail_group_members";

-- DropTable
DROP TABLE "mail_groups";

-- DropTable
DROP TABLE "ownership_transfers";

-- DropTable
DROP TABLE "security_alerts";

-- DropEnum
DROP TYPE "AlertSeverity";

-- DropEnum
DROP TYPE "MailGroupKind";

-- DropEnum
DROP TYPE "MailGroupStatus";

-- DropEnum
DROP TYPE "OwnershipTransferStatus";

-- DropEnum
DROP TYPE "SecurityAlertStatus";

-- DropEnum
DROP TYPE "SecurityAlertType";

-- AddForeignKey
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
