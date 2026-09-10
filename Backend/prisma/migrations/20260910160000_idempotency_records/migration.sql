-- Idempotency records — API §7.
--
-- §7 requires an Idempotency-Key on every side-effecting request and defines
-- the contract precisely: scope is tenant + actor + endpoint family + key,
-- TTL is 24 hours from the first accepted request, a repeat of the same
-- payload returns the original response, and a repeat carrying a different
-- payload is refused. None of it existed: two endpoints took an
-- `idempotencyKey` in their request body and every other write was replayable.
--
-- The scope is the unique index rather than the key alone, which is how §7's
-- "idempotency records must never deduplicate across tenants" becomes a
-- property of the schema instead of a rule someone has to remember.
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "idempotency_records" (
  "id"              UUID NOT NULL,
  "tenant_id"       UUID NOT NULL,
  "actor_user_id"   UUID NOT NULL,
  "endpoint_family" TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "request_hash"    TEXT NOT NULL,
  "status"          "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "response_status" INTEGER,
  "response_body"   JSONB,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- The scope from §7, verbatim.
CREATE UNIQUE INDEX "idempotency_records_tenant_id_actor_user_id_endpoint_family_key"
  ON "idempotency_records"("tenant_id", "actor_user_id", "endpoint_family", "key");
-- Expiry sweeps read this; without it the 24-hour purge is a full scan.
CREATE INDEX "idempotency_records_expires_at_idx"
  ON "idempotency_records"("expires_at");

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "idempotency_records_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
