-- Aliases and forwarding rules — Data Model §6.17, §6.18, Security §9.
--
-- PRD §11.2 lists both as controlled-pilot Must-Have and neither existed in
-- any form: no model, no columns, no endpoints.
--
-- §6.17/§6.18 specify partial unique indexes (… WHERE status = 'active').
-- The Prisma schema language cannot express those, and declaring them only in
-- SQL would read as permanent schema drift and fail the migrate-diff gate. So
-- the status enum omits 'deleted' and removal deletes the row; a plain unique
-- then gives the same routing guarantee, and the audit log carries the history.

CREATE TYPE "AliasStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE "aliases" (
  "id"         UUID NOT NULL,
  "tenant_id"  UUID NOT NULL,
  "mailbox_id" UUID NOT NULL,
  "address"    TEXT NOT NULL,
  "status"     "AliasStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "aliases_pkey" PRIMARY KEY ("id")
);

-- Global, not per tenant: an address has to route somewhere unambiguous.
CREATE UNIQUE INDEX "aliases_address_key" ON "aliases"("address");
CREATE INDEX "aliases_tenant_id_mailbox_id_status_idx"
  ON "aliases"("tenant_id", "mailbox_id", "status");

CREATE TABLE "forwarding_rules" (
  "id"                 UUID NOT NULL,
  "tenant_id"          UUID NOT NULL,
  "mailbox_id"         UUID NOT NULL,
  "forward_to_address" TEXT NOT NULL,
  "keep_copy"          BOOLEAN NOT NULL DEFAULT true,
  "status"             "AliasStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "forwarding_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forwarding_rules_mailbox_id_forward_to_address_key"
  ON "forwarding_rules"("mailbox_id", "forward_to_address");
CREATE INDEX "forwarding_rules_tenant_id_mailbox_id_status_idx"
  ON "forwarding_rules"("tenant_id", "mailbox_id", "status");

ALTER TABLE "aliases"
  ADD CONSTRAINT "aliases_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "aliases_mailbox_id_fkey"
    FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "forwarding_rules"
  ADD CONSTRAINT "forwarding_rules_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "forwarding_rules_mailbox_id_fkey"
    FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
