-- Settings -> Mailbox Preferences -> Daily digest.
ALTER TABLE "app_users" ADD COLUMN "daily_digest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_users" ADD COLUMN "daily_digest_last_on" VARCHAR(10);
