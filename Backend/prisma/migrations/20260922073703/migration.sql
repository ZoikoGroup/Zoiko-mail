-- CreateEnum
CREATE TYPE "MailGroupKind" AS ENUM ('SHARED', 'DISTRIBUTION');

-- CreateEnum
CREATE TYPE "MailGroupStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OwnershipTransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SecurityAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SecurityAlertType" AS ENUM ('NEW_DEVICE_LOGIN', 'FAILED_LOGIN_BURST', 'REFRESH_TOKEN_REUSE', 'PASSWORD_CHANGED', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "is_org_level" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "membership_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "device_label" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "last_used_at" TIMESTAMP(3),
ADD COLUMN     "user_agent" TEXT;

-- CreateTable
CREATE TABLE "mail_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" "MailGroupKind" NOT NULL DEFAULT 'DISTRIBUTION',
    "status" "MailGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_group_members" (
    "group_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_group_members_pkey" PRIMARY KEY ("group_id","membership_id")
);

-- CreateTable
CREATE TABLE "ownership_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "initiator_user_id" UUID NOT NULL,
    "target_membership_id" UUID NOT NULL,
    "status" "OwnershipTransferStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_user_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ownership_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "SecurityAlertType" NOT NULL DEFAULT 'NEW_DEVICE_LOGIN',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "SecurityAlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_email" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_label" TEXT,
    "metadata" JSONB,
    "resolution_note" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mail_groups_tenant_id_status_idx" ON "mail_groups"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mail_groups_tenant_id_address_key" ON "mail_groups"("tenant_id", "address");

-- CreateIndex
CREATE INDEX "mail_group_members_membership_id_idx" ON "mail_group_members"("membership_id");

-- CreateIndex
CREATE INDEX "ownership_transfers_target_membership_id_idx" ON "ownership_transfers"("target_membership_id");

-- CreateIndex
CREATE INDEX "ownership_transfers_tenant_id_status_idx" ON "ownership_transfers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "security_alerts_tenant_id_status_created_at_idx" ON "security_alerts"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "support_access_grants_ticket_id_idx" ON "support_access_grants"("ticket_id");

-- AddForeignKey
ALTER TABLE "mail_groups" ADD CONSTRAINT "mail_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_group_members" ADD CONSTRAINT "mail_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "mail_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_group_members" ADD CONSTRAINT "mail_group_members_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_initiator_user_id_fkey" FOREIGN KEY ("initiator_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_target_membership_id_fkey" FOREIGN KEY ("target_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_alerts" ADD CONSTRAINT "security_alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
