-- Shared mailboxes and mailbox access — Security §10, §9.1, Data Model §6.16.
--
-- mailboxes.membership_id was NOT NULL UNIQUE, which made a shared mailbox
-- impossible to represent: it belongs to the workspace, not to one person.
-- It becomes nullable and stays unique, so a member still has at most one
-- personal mailbox while shared and distribution addresses have none.

CREATE TYPE "MailboxType" AS ENUM ('USER', 'SHARED', 'DISTRIBUTION', 'SYSTEM', 'NO_REPLY');

ALTER TABLE "mailboxes"
  ADD COLUMN "type" "MailboxType" NOT NULL DEFAULT 'USER',
  ALTER COLUMN "membership_id" DROP NOT NULL;

-- Who may act in a shared mailbox, and how. Four separable permissions
-- because §10 requires read, send, manage and assign to be separable.
CREATE TABLE "mailbox_access" (
  "id"                 UUID NOT NULL,
  "tenant_id"          UUID NOT NULL,
  "mailbox_id"         UUID NOT NULL,
  "membership_id"      UUID NOT NULL,
  "can_read"           BOOLEAN NOT NULL DEFAULT true,
  "can_send"           BOOLEAN NOT NULL DEFAULT false,
  "can_manage"         BOOLEAN NOT NULL DEFAULT false,
  "can_assign"         BOOLEAN NOT NULL DEFAULT false,
  "granted_by_user_id" UUID NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mailbox_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mailbox_access_mailbox_id_membership_id_key"
  ON "mailbox_access"("mailbox_id", "membership_id");
CREATE INDEX "mailbox_access_tenant_id_membership_id_idx"
  ON "mailbox_access"("tenant_id", "membership_id");

ALTER TABLE "mailbox_access"
  ADD CONSTRAINT "mailbox_access_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mailbox_access_mailbox_id_fkey"
    FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mailbox_access_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mailbox_access_granted_by_user_id_fkey"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
