-- Hosted mailbox provisioning (Stalwart).
--
-- Additive only: new enums, nullable columns and one counter with a default.
-- Existing mailboxes keep every value they had and read as "not hosted"
-- (provider and provisioning_status NULL), which is the truth about them.

CREATE TYPE "MailHostProvider" AS ENUM ('STALWART');
CREATE TYPE "MailboxProvisioningStatus" AS ENUM ('PENDING', 'PROVISIONING', 'PROVISIONED', 'FAILED');
CREATE TYPE "MailboxInvitationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SENT', 'FAILED');

ALTER TABLE "mailboxes"
  ADD COLUMN "display_name" TEXT,
  ADD COLUMN "provider" "MailHostProvider",
  ADD COLUMN "provider_account_id" TEXT,
  ADD COLUMN "provisioning_status" "MailboxProvisioningStatus",
  ADD COLUMN "provisioning_error" TEXT,
  ADD COLUMN "provisioning_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provisioning_started_at" TIMESTAMP(3),
  ADD COLUMN "provisioned_at" TIMESTAMP(3),
  ADD COLUMN "provider_quota_bytes" BIGINT,
  ADD COLUMN "invitation_status" "MailboxInvitationStatus",
  ADD COLUMN "invitation_sent_at" TIMESTAMP(3),
  ADD COLUMN "invitation_error" TEXT;

-- One Zoiko mailbox per host account. Every existing row has NULLs here, and
-- NULLs are distinct in a unique index, so this cannot fail on existing data.
CREATE UNIQUE INDEX "mailboxes_provider_provider_account_id_key" ON "mailboxes"("provider", "provider_account_id");

CREATE INDEX "mailboxes_provisioning_status_idx" ON "mailboxes"("provisioning_status");
