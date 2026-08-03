ALTER TABLE "mail_domains"
ADD COLUMN "first_checked_at" TIMESTAMP(3),
ADD COLUMN "error_details" JSONB,
ADD COLUMN "sending_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "activated_at" TIMESTAMP(3);

CREATE TABLE "domain_dns_checks" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "domain_id" UUID NOT NULL,
  "verification_status" "DomainVerificationStatus" NOT NULL,
  "mx_status" "DnsRecordStatus" NOT NULL,
  "spf_status" "DnsRecordStatus" NOT NULL,
  "dkim_status" "DnsRecordStatus" NOT NULL,
  "dmarc_status" "DnsRecordStatus" NOT NULL,
  "error_details" JSONB,
  "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_dns_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "domain_dns_checks_tenant_id_domain_id_checked_at_idx"
ON "domain_dns_checks"("tenant_id", "domain_id", "checked_at");
ALTER TABLE "domain_dns_checks" ADD CONSTRAINT "domain_dns_checks_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_dns_checks" ADD CONSTRAINT "domain_dns_checks_domain_id_fkey"
FOREIGN KEY ("domain_id") REFERENCES "mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
