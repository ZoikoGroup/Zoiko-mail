-- Phase 4 — security alerts. The auth pipeline generates these (new-device
-- sign-ins, repeated failed sign-ins, refresh-token reuse, password changes
-- and resets); owners and admins review them from a dedicated inbox. The
-- model is deliberately read-mostly from the tenant's side: alerts react to
-- what already happened, so the write path never grants privileges.

CREATE TYPE "SecurityAlertType" AS ENUM (
  'NEW_DEVICE_LOGIN',
  'FAILED_LOGIN_BURST',
  'REFRESH_TOKEN_REUSE',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET'
);

CREATE TYPE "AlertSeverity" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TYPE "SecurityAlertStatus" AS ENUM (
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'DISMISSED'
);

CREATE TABLE "security_alerts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "type" "SecurityAlertType" NOT NULL DEFAULT 'NEW_DEVICE_LOGIN',
  "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "SecurityAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "actor_user_id" UUID,
  "actor_email" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "device_label" TEXT,
  "metadata" JSONB,
  "resolution_note" TEXT,
  "resolved_by_id" UUID,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_alerts_tenant_id_status_created_at_idx"
  ON "security_alerts"("tenant_id", "status", "created_at");

ALTER TABLE "security_alerts"
  ADD CONSTRAINT "security_alerts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "security_alerts"
  ADD CONSTRAINT "security_alerts_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "security_alerts"
  ADD CONSTRAINT "security_alerts_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;