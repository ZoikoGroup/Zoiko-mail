CREATE TYPE "PolicyType" AS ENUM ('AI', 'SENDING', 'RETENTION', 'DELETION', 'ABUSE');
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "tenant_policies" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "type" "PolicyType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL,
  "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "rules" JSONB NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "activated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_policies_tenant_id_type_version_key"
  ON "tenant_policies"("tenant_id", "type", "version");
CREATE INDEX "tenant_policies_tenant_id_type_status_idx"
  ON "tenant_policies"("tenant_id", "type", "status");

ALTER TABLE "tenant_policies" ADD CONSTRAINT "tenant_policies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_policies" ADD CONSTRAINT "tenant_policies_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
