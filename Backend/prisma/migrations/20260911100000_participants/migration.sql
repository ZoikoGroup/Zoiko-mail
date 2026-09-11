-- Participant and ThreadParticipant — Data Model §6.7, §6.8; API §12.
--
-- A participant was a string in a JSON array on the thread. That made three
-- things impossible at once: you could not ask what else an address had been
-- involved in, a commitment could only be owned by an internal user (so an
-- obligation owed *to* a customer had nowhere to point), and the API could
-- not honour §12's rule that "commitments must never expose opaque
-- participant IDs without a resolution path" — there was no participant to
-- resolve.
--
-- citext for the address, so Alex@example.com and alex@example.com are one
-- participant at the database rather than only when the application
-- remembers to lowercase. The application normalises anyway; this is the
-- backstop for the day it forgets.
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE "ParticipantType" AS ENUM (
  'INTERNAL_USER', 'EXTERNAL_PERSON', 'GROUP_ADDRESS', 'SYSTEM', 'UNKNOWN'
);
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'MERGED', 'SUPPRESSED', 'DELETED');
CREATE TYPE "ThreadParticipantRole" AS ENUM (
  'SENDER', 'RECIPIENT', 'CC', 'BCC', 'MENTIONED', 'INFERRED_OWNER'
);

CREATE TABLE "participants" (
  "id"                UUID NOT NULL,
  "tenant_id"         UUID NOT NULL,
  "canonical_email"   CITEXT NOT NULL,
  "display_name"      TEXT,
  "participant_type"  "ParticipantType" NOT NULL DEFAULT 'UNKNOWN',
  "linked_user_id"    UUID,
  "organization_name" TEXT,
  "first_seen_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "merge_parent_id"   UUID,
  "status"            "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- §6.7's ux_participant_email_active. Partial, because a merged or deleted
-- row keeps its address — that is how a merge stays auditable — and a plain
-- unique index would then refuse the surviving row.
--
-- Deliberately absent from schema.prisma: Prisma cannot express a partial
-- unique index, so declaring it there would report as permanent drift and
-- fail `migrate diff --exit-code` on every run.
CREATE UNIQUE INDEX "ux_participant_email_active"
  ON "participants"("tenant_id", "canonical_email")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "participants_tenant_id_last_seen_at_idx"
  ON "participants"("tenant_id", "last_seen_at" DESC);
CREATE INDEX "participants_tenant_id_linked_user_id_idx"
  ON "participants"("tenant_id", "linked_user_id");

ALTER TABLE "participants"
  ADD CONSTRAINT "participants_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "participants_linked_user_id_fkey"
    FOREIGN KEY ("linked_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "participants_merge_parent_id_fkey"
    FOREIGN KEY ("merge_parent_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "thread_participants" (
  "id"               UUID NOT NULL,
  "tenant_id"        UUID NOT NULL,
  "thread_id"        UUID NOT NULL,
  "participant_id"   UUID NOT NULL,
  "roles"            "ThreadParticipantRole"[] NOT NULL DEFAULT ARRAY[]::"ThreadParticipantRole"[],
  "first_message_id" UUID,
  "last_message_id"  UUID,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "thread_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "thread_participants_tenant_id_thread_id_participant_id_key"
  ON "thread_participants"("tenant_id", "thread_id", "participant_id");
CREATE INDEX "thread_participants_tenant_id_participant_id_updated_at_idx"
  ON "thread_participants"("tenant_id", "participant_id", "updated_at" DESC);

ALTER TABLE "thread_participants"
  ADD CONSTRAINT "thread_participants_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "thread_participants_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "thread_participants_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §6.10: a commitment can be owed by and owed to a participant.
ALTER TABLE "commitments"
  ADD COLUMN "owed_by_participant_id" UUID,
  ADD COLUMN "owed_to_participant_id" UUID;

CREATE INDEX "commitments_tenant_id_owed_by_participant_id_idx"
  ON "commitments"("tenant_id", "owed_by_participant_id");
CREATE INDEX "commitments_tenant_id_owed_to_participant_id_idx"
  ON "commitments"("tenant_id", "owed_to_participant_id");

ALTER TABLE "commitments"
  ADD CONSTRAINT "commitments_owed_by_participant_id_fkey"
    FOREIGN KEY ("owed_by_participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "commitments_owed_to_participant_id_fkey"
    FOREIGN KEY ("owed_to_participant_id") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Security §8.1 names participant and thread_participant among the
-- high-sensitivity tables. The previous RLS migration could not cover them
-- because they did not exist; they do now, so they get the same treatment as
-- the rest (AC-004).
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['participants', 'thread_participants']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_tenant_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant()) WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())',
      target || '_tenant_isolation',
      target
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "participants" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "thread_participants" TO zoiko_app;

-- Backfill from the messages that already exist.
--
-- Taken from message_recipients and the message authors rather than from the
-- thread's JSON array, because those carry the roles: the array knows who was
-- involved but not how, and a timeline that called every historical sender a
-- recipient would be wrong about every thread.
INSERT INTO "participants" (
  "id", "tenant_id", "canonical_email", "display_name", "participant_type",
  "linked_user_id", "first_seen_at", "last_seen_at", "status", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  seen.tenant_id,
  seen.email::citext,
  max(seen.display_name),
  CASE WHEN max(seen.user_id::text) IS NOT NULL THEN 'INTERNAL_USER' ELSE 'EXTERNAL_PERSON' END::"ParticipantType",
  max(seen.user_id::text)::uuid,
  min(seen.seen_at),
  max(seen.seen_at),
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  -- Senders: the author's own address, or the address the message was sent as.
  SELECT m.tenant_id,
         lower(coalesce(m.from_address, u.email)) AS email,
         u.display_name,
         u.id AS user_id,
         m.created_at AS seen_at
  FROM "email_messages" m
  JOIN "app_users" u ON u.id = m.author_user_id
  WHERE coalesce(m.from_address, u.email) IS NOT NULL
  UNION ALL
  -- Recipients of every kind.
  SELECT m.tenant_id,
         lower(r.email) AS email,
         NULL AS display_name,
         NULL::uuid AS user_id,
         m.created_at AS seen_at
  FROM "message_recipients" r
  JOIN "email_messages" m ON m.id = r.message_id
) AS seen
WHERE seen.email <> ''
GROUP BY seen.tenant_id, seen.email
ON CONFLICT DO NOTHING;

-- Link the backfilled rows to threads, with the roles they actually held.
INSERT INTO "thread_participants" (
  "id", "tenant_id", "thread_id", "participant_id", "roles",
  "first_message_id", "last_message_id", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  link.tenant_id,
  link.thread_id,
  link.participant_id,
  link.roles,
  link.first_message_id,
  link.last_message_id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT observed.tenant_id,
         observed.thread_id,
         p.id AS participant_id,
         array_agg(DISTINCT observed.role)::"ThreadParticipantRole"[] AS roles,
         (array_agg(observed.message_id ORDER BY observed.seen_at ASC))[1] AS first_message_id,
         (array_agg(observed.message_id ORDER BY observed.seen_at DESC))[1] AS last_message_id
  FROM (
    SELECT m.tenant_id, m.thread_id, m.id AS message_id, m.created_at AS seen_at,
           lower(coalesce(m.from_address, u.email)) AS email,
           'SENDER'::"ThreadParticipantRole" AS role
    FROM "email_messages" m
    JOIN "app_users" u ON u.id = m.author_user_id
    WHERE m.thread_id IS NOT NULL AND coalesce(m.from_address, u.email) IS NOT NULL
    UNION ALL
    SELECT m.tenant_id, m.thread_id, m.id AS message_id, m.created_at AS seen_at,
           lower(r.email) AS email,
           CASE r.type
             WHEN 'CC' THEN 'CC'
             WHEN 'BCC' THEN 'BCC'
             ELSE 'RECIPIENT'
           END::"ThreadParticipantRole" AS role
    FROM "message_recipients" r
    JOIN "email_messages" m ON m.id = r.message_id
    WHERE m.thread_id IS NOT NULL
  ) AS observed
  JOIN "participants" p
    ON p.tenant_id = observed.tenant_id
   AND p.canonical_email = observed.email::citext
   AND p.status = 'ACTIVE'
  GROUP BY observed.tenant_id, observed.thread_id, p.id
) AS link
ON CONFLICT DO NOTHING;
