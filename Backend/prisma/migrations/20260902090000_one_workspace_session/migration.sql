-- One live workspace session per account.
--
-- active_tenant_id records the workspace the most recent sign-in claimed.
-- tenantContext rejects an access token for any other tenant, so an old tab
-- cannot keep acting in the workspace the user just left. Nullable, and left
-- NULL for existing rows: a NULL means "not yet claimed", which every session
-- already open is allowed to keep using until its next sign-in.
--
-- Deliberately not a foreign key. It points at whichever tenant won the last
-- sign-in; deleting a tenant should leave a stale pointer that the next
-- sign-in overwrites, not cascade onto the user row.
ALTER TABLE "app_users" ADD COLUMN "active_tenant_id" UUID;

-- Selection tokens already exchanged for a session. The token is a stateless
-- JWT, so replaying it inside its 15-minute window would otherwise open a
-- session in a second workspace without signing in again.
CREATE TABLE "used_selection_tokens" (
    "jti" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "used_selection_tokens_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "used_selection_tokens_expires_at_idx" ON "used_selection_tokens"("expires_at");

ALTER TABLE "used_selection_tokens" ADD CONSTRAINT "used_selection_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
