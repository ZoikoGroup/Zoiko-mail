-- Support asking for access, before anyone has decided — Runbook §7.
--
-- The enforcement landed first: support cannot read a workspace without an
-- approved, unexpired grant. Nothing could create one except a direct API
-- call, so the control was real and unusable. This is the request half.
--
-- A separate table rather than a status on support_access_grants. The
-- middleware treats a grant as live when revoked_at IS NULL and expires_at is
-- in the future; a pending row would satisfy both, so asking for access would
-- have granted it.

CREATE TYPE "support_access_request_status" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'WITHDRAWN');

CREATE TABLE "support_access_requests" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"             UUID NOT NULL,
  "support_membership_id" UUID NOT NULL,
  "reason"                TEXT NOT NULL,
  "ticket_id"             UUID,
  "scopes"                "SupportScope"[],
  "requested_minutes"     INTEGER NOT NULL,
  "status"                "support_access_request_status" NOT NULL DEFAULT 'PENDING',
  "decided_by_user_id"    UUID,
  "decided_at"            TIMESTAMP(3),
  "grant_id"              UUID,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "support_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_access_requests_grant_id_key"
  ON "support_access_requests"("grant_id");

CREATE INDEX "support_access_requests_tenant_id_status_idx"
  ON "support_access_requests"("tenant_id", "status");

ALTER TABLE "support_access_requests"
  ADD CONSTRAINT "support_access_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_access_requests"
  ADD CONSTRAINT "support_access_requests_support_membership_id_fkey"
  FOREIGN KEY ("support_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: who decided is part of the record, and it must
-- survive that person leaving. §7 asks for the approval to be auditable.
ALTER TABLE "support_access_requests"
  ADD CONSTRAINT "support_access_requests_decided_by_user_id_fkey"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_access_requests"
  ADD CONSTRAINT "support_access_requests_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_access_requests"
  ADD CONSTRAINT "support_access_requests_grant_id_fkey"
  FOREIGN KEY ("grant_id") REFERENCES "support_access_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
