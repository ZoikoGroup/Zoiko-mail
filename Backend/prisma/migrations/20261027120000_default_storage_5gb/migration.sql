-- New mailboxes start with 5 GiB. Existing mailboxes keep the quota they were given.
ALTER TABLE "mailboxes" ALTER COLUMN "storage_limit" SET DEFAULT 5368709120;
