-- Automated DNS record management for custom domains.
--
-- Until now a domain carried one generated value (the ownership token) and
-- five status columns; every other record the owner was told to publish was
-- text in the frontend, pointing at hosts that did not exist. This adds the
-- records themselves (domain_dns_records), the DKIM keys they publish
-- (domain_dkim_keys, public half only), API access to a DNS host so records
-- can be published without copying (dns_provider_credentials), and the
-- lifecycle and scheduling columns the synchronizer runs on.
--
-- The five status columns on mail_domains stay: sending, mailbox provisioning
-- and the support console read them. They become a projection of the record
-- rows, written in the same transaction.

-- CreateEnum
CREATE TYPE "DomainLifecycleStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'DEGRADED', 'FAILED');

-- CreateEnum
CREATE TYPE "DnsRecordPurpose" AS ENUM ('OWNERSHIP', 'MX', 'SPF', 'DKIM', 'DMARC', 'AUTODISCOVER', 'AUTOCONFIG');

-- CreateEnum
CREATE TYPE "DnsRecordType" AS ENUM ('TXT', 'MX', 'CNAME');

-- CreateEnum
CREATE TYPE "DnsRecordState" AS ENUM ('PENDING', 'VERIFIED', 'MISSING', 'MISMATCH', 'CONFLICT', 'LOOKUP_ERROR');

-- CreateEnum
CREATE TYPE "DnsProviderKind" AS ENUM ('MANUAL', 'CLOUDFLARE', 'GODADDY');

-- CreateEnum
CREATE TYPE "DnsPublishState" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "DnsCredentialStatus" AS ENUM ('ACTIVE', 'INVALID');

-- CreateEnum
CREATE TYPE "DkimKeyStatus" AS ENUM ('PENDING', 'ACTIVE', 'RETIRING', 'RETIRED');

-- CreateEnum
CREATE TYPE "DmarcPolicy" AS ENUM ('NONE', 'QUARANTINE', 'REJECT');

-- CreateEnum
CREATE TYPE "DnsCheckTrigger" AS ENUM ('CREATED', 'MANUAL', 'SCHEDULED', 'CONFIG_CHANGE', 'PUBLISH');

-- AlterTable
ALTER TABLE "domain_dns_checks" ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "result_status" "DomainLifecycleStatus",
ADD COLUMN     "results" JSONB,
ADD COLUMN     "trigger" "DnsCheckTrigger" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "mail_domains" ADD COLUMN     "auto_activate_sending" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "config_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dmarc_policy" "DmarcPolicy" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "dmarc_report_email" TEXT,
ADD COLUMN     "dns_credential_id" UUID,
ADD COLUMN     "dns_provider" "DnsProviderKind" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "grace_until" TIMESTAMP(3),
ADD COLUMN     "last_published_at" TIMESTAMP(3),
ADD COLUMN     "last_sync_error" TEXT,
ADD COLUMN     "last_verified_at" TIMESTAMP(3),
ADD COLUMN     "next_check_at" TIMESTAMP(3),
ADD COLUMN     "receiving_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "replace_existing_mx" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sending_suspended_at" TIMESTAMP(3),
ADD COLUMN     "status" "DomainLifecycleStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
ADD COLUMN     "suspension_reason" TEXT,
ADD COLUMN     "verification_deadline_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "domain_dns_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "record_key" TEXT NOT NULL,
    "purpose" "DnsRecordPurpose" NOT NULL,
    "type" "DnsRecordType" NOT NULL,
    "name" TEXT NOT NULL,
    "fqdn" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priority" INTEGER,
    "ttl" INTEGER NOT NULL DEFAULT 3600,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "dkim_key_id" UUID,
    "state" "DnsRecordState" NOT NULL DEFAULT 'PENDING',
    "observed" JSONB,
    "diagnosis" TEXT,
    "last_error_code" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "publish_state" "DnsPublishState" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "published_at" TIMESTAMP(3),
    "publish_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_dns_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_dkim_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "selector" TEXT NOT NULL,
    "key_bits" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key_secret_ref" TEXT NOT NULL,
    "status" "DkimKeyStatus" NOT NULL DEFAULT 'PENDING',
    "activated_at" TIMESTAMP(3),
    "retiring_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_dkim_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dns_provider_credentials" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "DnsProviderKind" NOT NULL,
    "label" TEXT NOT NULL,
    "secret_ref" TEXT NOT NULL,
    "settings" JSONB,
    "status" "DnsCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_validated_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dns_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_dns_records_tenant_id_domain_id_idx" ON "domain_dns_records"("tenant_id", "domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_dns_records_domain_id_record_key_key" ON "domain_dns_records"("domain_id", "record_key");

-- CreateIndex
CREATE INDEX "domain_dkim_keys_tenant_id_domain_id_status_idx" ON "domain_dkim_keys"("tenant_id", "domain_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "domain_dkim_keys_domain_id_selector_key" ON "domain_dkim_keys"("domain_id", "selector");

-- CreateIndex
CREATE INDEX "dns_provider_credentials_tenant_id_idx" ON "dns_provider_credentials"("tenant_id");

-- CreateIndex
CREATE INDEX "mail_domains_next_check_at_idx" ON "mail_domains"("next_check_at");

-- CreateIndex
CREATE INDEX "mail_domains_domain_name_idx" ON "mail_domains"("domain_name");

-- AddForeignKey
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_dns_credential_id_fkey" FOREIGN KEY ("dns_credential_id") REFERENCES "dns_provider_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_dns_records" ADD CONSTRAINT "domain_dns_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_dns_records" ADD CONSTRAINT "domain_dns_records_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_dns_records" ADD CONSTRAINT "domain_dns_records_dkim_key_id_fkey" FOREIGN KEY ("dkim_key_id") REFERENCES "domain_dkim_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_dkim_keys" ADD CONSTRAINT "domain_dkim_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_dkim_keys" ADD CONSTRAINT "domain_dkim_keys_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dns_provider_credentials" ADD CONSTRAINT "dns_provider_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A credential always names a real DNS host. MANUAL is the absence of one.
ALTER TABLE "dns_provider_credentials"
  ADD CONSTRAINT "dns_provider_credentials_provider_not_manual" CHECK ("provider" <> 'MANUAL');

-- ── Backfill existing domains ────────────────────────────────────────────
--
-- Lifecycle status from what the old columns already said.
UPDATE "mail_domains" SET "status" = CASE
  WHEN "sending_enabled" THEN 'ACTIVE'::"DomainLifecycleStatus"
  WHEN "verification_status" = 'VERIFIED' THEN 'VERIFIED'::"DomainLifecycleStatus"
  ELSE 'PENDING_VERIFICATION'::"DomainLifecycleStatus"
END;

-- Existing custom domains have no generated records and no DKIM key: the old
-- screens showed a placeholder where the key should have been. Scheduling
-- them now lets the synchronizer generate both on its next pass, so nobody
-- has to re-add a domain to get real records.
--
-- The grace window matters for domains that were already sending. Their new
-- DKIM record cannot be published before it exists, and without a grace the
-- first few checks would suspend sending on every one of them.
UPDATE "mail_domains"
SET "next_check_at" = CURRENT_TIMESTAMP,
    "grace_until" = CURRENT_TIMESTAMP + INTERVAL '72 hours',
    "verification_deadline_at" = CASE
      WHEN "verification_status" = 'VERIFIED' THEN NULL
      ELSE CURRENT_TIMESTAMP + INTERVAL '72 hours'
    END,
    "last_verified_at" = CASE WHEN "verification_status" = 'VERIFIED' THEN "last_checked_at" ELSE NULL END
WHERE "type" = 'CUSTOM';
