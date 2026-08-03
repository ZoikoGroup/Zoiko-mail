CREATE TYPE "ConnectorProvider" AS ENUM ('GMAIL', 'MICROSOFT_365');
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REAUTH_REQUIRED', 'DEGRADED', 'DISCONNECTED');
CREATE TYPE "ProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

CREATE TABLE "connected_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'PENDING',
    "watch_expires_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_events" (
    "id" UUID NOT NULL,
    "provider_event_id" TEXT,
    "tenant_id" UUID NOT NULL,
    "connected_account_id" UUID NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "event_type" TEXT NOT NULL,
    "normalized_resource_type" TEXT,
    "normalized_resource_id" TEXT,
    "provider_reference" TEXT,
    "event_hash" TEXT NOT NULL,
    "sanitized_payload_json" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "processing_status" "ProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error_code" TEXT,
    "request_id" TEXT,
    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connected_accounts_provider_provider_account_id_key" ON "connected_accounts"("provider", "provider_account_id");
CREATE INDEX "connected_accounts_tenant_id_membership_id_status_idx" ON "connected_accounts"("tenant_id", "membership_id", "status");
CREATE UNIQUE INDEX "provider_events_provider_event_hash_key" ON "provider_events"("provider", "event_hash");
CREATE INDEX "provider_events_tenant_id_processing_status_received_at_idx" ON "provider_events"("tenant_id", "processing_status", "received_at");
CREATE INDEX "provider_events_connected_account_id_received_at_idx" ON "provider_events"("connected_account_id", "received_at");

ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_connected_account_id_fkey" FOREIGN KEY ("connected_account_id") REFERENCES "connected_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
