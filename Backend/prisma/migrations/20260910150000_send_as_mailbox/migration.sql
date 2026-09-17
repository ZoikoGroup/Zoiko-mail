-- Send-as attribution for shared mailboxes — Security §10.
--
-- "All shared mailbox sends must capture actor_user_id and mailbox_id."
-- author_user_id already records the actor; this records the mailbox they
-- sent as. Null for an ordinary personal send, so existing rows are correct
-- without a backfill.
--
-- SET NULL rather than CASCADE on delete: removing a shared mailbox must not
-- erase the messages sent through it, which would delete exactly the evidence
-- §10 asks for.
ALTER TABLE "email_messages" ADD COLUMN "sent_as_mailbox_id" UUID;

CREATE INDEX "email_messages_sent_as_mailbox_id_idx"
  ON "email_messages"("sent_as_mailbox_id");

ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_sent_as_mailbox_id_fkey"
    FOREIGN KEY ("sent_as_mailbox_id") REFERENCES "mailboxes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
