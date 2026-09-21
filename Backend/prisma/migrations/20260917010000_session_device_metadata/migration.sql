-- Phase 3 — session management. The "where am I signed in" surface needs the
-- refresh-token rows to carry enough to describe the session: a human-readable
-- device label, the address it was issued from, and when it was last used.
-- All columns are nullable so existing rows (and the migration) do not need a
-- backfill; a session without metadata is shown as "Unknown device".

ALTER TABLE "refresh_tokens"
  ADD COLUMN "device_label" TEXT,
  ADD COLUMN "ip_address" TEXT,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "last_used_at" TIMESTAMP(3);