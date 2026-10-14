-- Which workspace consoles (session scopes) a mailbox can be opened in.
--
-- New mailboxes default to the Member workspace only. Existing mailboxes are
-- backfilled to every console they already open in today, so the column
-- changes nothing for them until an admin narrows it:
--   personal mailbox  -> the consoles its owner's role can reach
--   shared mailbox    -> every console (its assignees decide who reads it)

ALTER TABLE "mailboxes"
  ADD COLUMN "workspaces" "MembershipRole"[] NOT NULL DEFAULT ARRAY['MEMBER']::"MembershipRole"[];

UPDATE "mailboxes" AS m
SET "workspaces" = CASE tm."role"
    WHEN 'OWNER' THEN ARRAY['MEMBER', 'ADMIN', 'OWNER']::"MembershipRole"[]
    WHEN 'ADMIN' THEN ARRAY['MEMBER', 'ADMIN']::"MembershipRole"[]
    WHEN 'SUPPORT' THEN ARRAY['SUPPORT']::"MembershipRole"[]
    ELSE ARRAY['MEMBER']::"MembershipRole"[]
  END
FROM "tenant_memberships" AS tm
WHERE tm."id" = m."membership_id";

UPDATE "mailboxes"
SET "workspaces" = ARRAY['MEMBER', 'ADMIN', 'OWNER', 'SUPPORT']::"MembershipRole"[]
WHERE "membership_id" IS NULL;

-- A mailbox that opens nowhere would be unreachable mail; refuse it at the
-- database as well as in the API.
ALTER TABLE "mailboxes"
  ADD CONSTRAINT "mailboxes_workspaces_not_empty" CHECK (cardinality("workspaces") >= 1);
