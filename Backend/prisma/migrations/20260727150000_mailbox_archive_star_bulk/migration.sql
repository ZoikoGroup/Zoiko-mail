ALTER TYPE "MailFolder" ADD VALUE 'ARCHIVE';

ALTER TABLE "mailbox_messages"
ADD COLUMN "is_starred" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "mailbox_messages_tenant_id_mailbox_id_is_starred_created_at_idx"
ON "mailbox_messages"("tenant_id", "mailbox_id", "is_starred", "created_at");
