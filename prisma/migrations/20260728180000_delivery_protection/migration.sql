ALTER TYPE "MailFolder" ADD VALUE 'QUARANTINE';
ALTER TYPE "DeliveryEventType" ADD VALUE 'ACCEPTED';
ALTER TYPE "DeliveryEventType" ADD VALUE 'DEFERRED';
ALTER TYPE "DeliveryEventType" ADD VALUE 'REJECTED';
ALTER TYPE "DeliveryEventType" ADD VALUE 'BLOCKED';
ALTER TYPE "DeliveryEventType" ADD VALUE 'SUPPRESSED';
ALTER TYPE "DeliveryEventType" ADD VALUE 'RATE_LIMITED';
ALTER TYPE "DeliveryEventType" ADD VALUE 'PROVIDER_ERROR';

CREATE TYPE "SuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'ADMIN');
CREATE TYPE "SpamStatus" AS ENUM ('UNKNOWN', 'CLEAN', 'SPAM', 'PHISHING');
CREATE TYPE "MalwareStatus" AS ENUM ('UNKNOWN', 'CLEAN', 'DETECTED', 'PENDING');
CREATE TYPE "AttachmentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'BLOCKED', 'ERROR');

ALTER TABLE "mailboxes"
ADD COLUMN "warmup_stage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "warmup_stage_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "warmup_daily_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "warmup_daily_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "external_sent_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bounce_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "complaint_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "custom_warmup_cap" INTEGER;

ALTER TABLE "email_messages"
ADD COLUMN "spam_status" "SpamStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "malware_status" "MalwareStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "security_flags" JSONB,
ADD COLUMN "quarantined_at" TIMESTAMP(3),
ADD COLUMN "quarantine_reason" TEXT;

ALTER TABLE "message_attachments"
ADD COLUMN "scan_status" "AttachmentScanStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "threat_category" TEXT;

CREATE TABLE "suppression_entries" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "email_hash" TEXT NOT NULL,
  "reason" "SuppressionReason" NOT NULL,
  "source_event_id" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppression_entries_tenant_id_email_hash_key" ON "suppression_entries"("tenant_id", "email_hash");
CREATE INDEX "suppression_entries_tenant_id_active_reason_idx" ON "suppression_entries"("tenant_id", "active", "reason");
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
