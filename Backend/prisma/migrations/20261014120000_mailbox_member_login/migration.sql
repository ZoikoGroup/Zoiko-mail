-- The key behind each mailbox's Member sign-in link (/login/member/<key>).
--
-- A volatile default is evaluated per row, so every existing mailbox gets its
-- own key here, and every mailbox created later gets one from the database
-- whichever code path creates it. 32 hex characters from a random UUID.
-- Not a credential: the link only prefills the sign-in form.

ALTER TABLE "mailboxes"
  ADD COLUMN "member_login_key" TEXT NOT NULL DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);

CREATE UNIQUE INDEX "mailboxes_member_login_key_key" ON "mailboxes"("member_login_key");
