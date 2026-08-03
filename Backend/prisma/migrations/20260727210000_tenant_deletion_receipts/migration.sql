CREATE TABLE "tenant_deletion_receipts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "tenant_name_hash" TEXT NOT NULL,
  "deleted_record_counts" JSONB NOT NULL,
  "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_deletion_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_deletion_receipts_request_id_key"
ON "tenant_deletion_receipts"("request_id");
CREATE INDEX "tenant_deletion_receipts_tenant_id_deleted_at_idx"
ON "tenant_deletion_receipts"("tenant_id", "deleted_at");
