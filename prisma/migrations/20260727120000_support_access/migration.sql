CREATE TYPE "SupportScope" AS ENUM ('TENANT_DIAGNOSTICS','DNS_DIAGNOSTICS','DELIVERY_DIAGNOSTICS','AUDIT_READ');
CREATE TABLE "support_access_grants" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "support_membership_id" UUID NOT NULL,
  "approved_by_user_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "scopes" "SupportScope"[],
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_access_grants_tenant_id_support_membership_id_expires_at_idx"
ON "support_access_grants"("tenant_id","support_membership_id","expires_at");
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_support_membership_id_fkey"
FOREIGN KEY ("support_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_approved_by_user_id_fkey"
FOREIGN KEY ("approved_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
