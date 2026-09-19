-- Purpose-bound support access — Runbook §7.
--
-- "Access must be linked to a ticket, incident, or approved customer support
-- request." The grant carried a free-text reason and nothing else, so once
-- tickets existed there was still no way to ask which case an access belonged
-- to, or to list every access opened against one.
--
-- Nullable, and ON DELETE SET NULL: grants written before tickets existed keep
-- working, and deleting a ticket must not erase the record of an access made
-- under it. The service requires a ticket id or an explicit incident reference
-- at creation, so new grants are attributable even though the column allows a
-- null for the old ones.
ALTER TABLE "support_access_grants"
  ADD COLUMN "ticket_id" UUID;

ALTER TABLE "support_access_grants"
  ADD CONSTRAINT "support_access_grants_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "support_access_grants_ticket_id_idx"
  ON "support_access_grants"("ticket_id");
