CREATE TYPE "DomainType" AS ENUM ('ZOIKO', 'CUSTOM');
CREATE TYPE "DomainVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');
CREATE TYPE "DnsRecordStatus" AS ENUM ('PENDING', 'VALID', 'INVALID');
CREATE TYPE "AIActionType" AS ENUM ('DRAFT', 'SUMMARY', 'COMMITMENT_EXTRACTION', 'REPLY_OWED', 'DEADLINE', 'APPROVAL');
CREATE TYPE "AIActionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CONFIRMED', 'DISMISSED', 'FAILED');
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'SNOOZED', 'COMPLETED', 'DISMISSED');
CREATE TYPE "NotificationType" AS ENUM ('INFO', 'ACTION_REQUIRED', 'WARNING', 'DIGEST');
CREATE TYPE "IntegrationProduct" AS ENUM ('ZOIKO_ONE', 'SEMA', 'VERTEX', 'LOCAL', 'TIME', 'NEX');
CREATE TYPE "IntegrationResourceType" AS ENUM ('TASK', 'MEETING', 'WORKFLOW', 'LINK');
CREATE TYPE "IntegrationLinkStatus" AS ENUM ('PENDING', 'LINKED', 'FAILED', 'REMOVED');

CREATE TABLE "mail_domains" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "domain_name" TEXT NOT NULL, "type" "DomainType" NOT NULL DEFAULT 'CUSTOM', "verification_token" TEXT NOT NULL, "verification_status" "DomainVerificationStatus" NOT NULL DEFAULT 'PENDING', "mx_status" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING', "spf_status" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING', "dkim_status" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING', "dmarc_status" "DnsRecordStatus" NOT NULL DEFAULT 'PENDING', "last_checked_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "mail_domains_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ai_actions" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_by_user_id" UUID NOT NULL, "message_id" UUID, "thread_id" UUID, "action_type" "AIActionType" NOT NULL, "input_hash" TEXT NOT NULL, "output" JSONB, "confidence_score" DOUBLE PRECISION, "source_excerpt" TEXT, "status" "AIActionStatus" NOT NULL DEFAULT 'PENDING', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id"));
CREATE TABLE "commitments" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "message_id" UUID, "thread_id" UUID, "owner_user_id" UUID NOT NULL, "created_by_user_id" UUID NOT NULL, "text" TEXT NOT NULL, "due_at" TIMESTAMP(3), "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM', "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN', "snoozed_until" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "commitments_pkey" PRIMARY KEY ("id"));
CREATE TABLE "notifications" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "user_id" UUID NOT NULL, "type" "NotificationType" NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "link_path" TEXT, "read_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"));
CREATE TABLE "integration_links" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "created_by_user_id" UUID NOT NULL, "product" "IntegrationProduct" NOT NULL, "resource_type" "IntegrationResourceType" NOT NULL, "source_type" TEXT NOT NULL, "source_id" TEXT NOT NULL, "external_ref" TEXT, "status" "IntegrationLinkStatus" NOT NULL DEFAULT 'PENDING', "metadata" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "integration_links_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "mail_domains_tenant_id_domain_name_key" ON "mail_domains"("tenant_id","domain_name");
CREATE INDEX "mail_domains_tenant_id_verification_status_idx" ON "mail_domains"("tenant_id","verification_status");
CREATE INDEX "ai_actions_tenant_id_status_created_at_idx" ON "ai_actions"("tenant_id","status","created_at");
CREATE INDEX "commitments_tenant_id_owner_user_id_status_due_at_idx" ON "commitments"("tenant_id","owner_user_id","status","due_at");
CREATE INDEX "notifications_tenant_id_user_id_read_at_created_at_idx" ON "notifications"("tenant_id","user_id","read_at","created_at");
CREATE INDEX "integration_links_tenant_id_product_status_idx" ON "integration_links"("tenant_id","product","status");
CREATE UNIQUE INDEX "integration_links_tenant_id_product_source_type_source_id_resource_type_key" ON "integration_links"("tenant_id","product","source_type","source_id","resource_type");

ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
