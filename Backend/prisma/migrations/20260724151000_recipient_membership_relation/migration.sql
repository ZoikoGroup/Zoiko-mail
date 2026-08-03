ALTER TABLE "message_recipients"
ADD CONSTRAINT "message_recipients_recipient_membership_id_fkey"
FOREIGN KEY ("recipient_membership_id") REFERENCES "tenant_memberships"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
