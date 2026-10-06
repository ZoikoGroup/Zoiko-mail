-- Add SPAM as a real mailbox folder, separate from QUARANTINE.
ALTER TYPE "MailFolder" ADD VALUE 'SPAM';

-- Snoozing hides a message from INBOX without moving it. NULL means "not
-- snoozed"; a past timestamp is treated the same as NULL by every query
-- below, so the wake-up worker only has to set this back to NULL.
ALTER TABLE "mailbox_messages" ADD COLUMN "snoozed_until" TIMESTAMP(3);
CREATE INDEX "mailbox_messages_snoozed_until_idx" ON "mailbox_messages"("snoozed_until");

-- Raise the default quota for newly created mailboxes from 1 GB to 10 GB.
-- Existing rows keep whatever quota they already have — this only changes
-- the column default applied on INSERT.
ALTER TABLE "mailboxes" ALTER COLUMN "storage_limit" SET DEFAULT 10737418240;