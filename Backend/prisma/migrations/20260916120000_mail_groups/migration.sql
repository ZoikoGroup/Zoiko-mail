-- CreateEnum
CREATE TYPE "MailGroupKind" AS ENUM ('SHARED', 'DISTRIBUTION');

-- CreateEnum
CREATE TYPE "MailGroupStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
-- Mail groups: shared mailboxes and distribution groups (admin "Groups" screen).
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

-- CreateIndex
CREATE UNIQUE INDEX "mail_groups_tenant_id_address_key" ON "mail_groups"("tenant_id", "address");

-- CreateIndex
CREATE INDEX "mail_groups_tenant_id_status_idx" ON "mail_groups"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "mail_group_members_membership_id_idx" ON "mail_group_members"("membership_id");

-- AddForeignKey
ALTER TABLE "mail_groups" ADD CONSTRAINT "mail_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_group_members" ADD CONSTRAINT "mail_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "mail_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_group_members" ADD CONSTRAINT "mail_group_members_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;