ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'RECEIVED';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'IMAP_SYNC';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SMTP_SEND';
ALTER TYPE "ConnectorProvider" ADD VALUE IF NOT EXISTS 'IMAP_SMTP';

ALTER TABLE "email_messages"
  ADD COLUMN "provider_type" TEXT,
  ADD COLUMN "provider_message_id" TEXT,
  ADD COLUMN "provider_uid" TEXT,
  ADD COLUMN "from_address" TEXT,
  ADD COLUMN "from_name" TEXT;

CREATE UNIQUE INDEX "email_messages_tenant_id_provider_type_provider_message_id_key"
  ON "email_messages"("tenant_id", "provider_type", "provider_message_id");
