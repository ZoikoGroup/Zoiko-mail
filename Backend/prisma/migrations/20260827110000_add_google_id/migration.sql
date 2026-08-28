-- Links an AppUser to a Google identity.
--
-- Nullable because the overwhelming majority of accounts authenticate with a
-- password and will never have one, and unique because a single Google subject
-- must not be claimable by two users.
ALTER TABLE "app_users" ADD COLUMN "google_id" TEXT;

CREATE UNIQUE INDEX "app_users_google_id_key" ON "app_users"("google_id");
