-- Calendar step 2: invitations, responses (RSVP) and each event's history.

-- CreateEnum
CREATE TYPE "EventResponse" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'TENTATIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "CalendarActivityType" AS ENUM ('INVITED', 'RESPONDED', 'PROPOSED_TIME', 'UPDATED', 'REMOVED');

-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "event_attendees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "membership_id" UUID,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "response" "EventResponse" NOT NULL DEFAULT 'NEEDS_ACTION',
    "responded_at" TIMESTAMP(3),
    "comment" TEXT,
    "proposed_starts_at" TIMESTAMP(3),
    "proposed_ends_at" TIMESTAMP(3),
    "seen_sequence" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "type" "CalendarActivityType" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_attendees_tenant_id_membership_id_response_idx" ON "event_attendees"("tenant_id", "membership_id", "response");

-- CreateIndex
CREATE UNIQUE INDEX "event_attendees_event_id_email_key" ON "event_attendees"("event_id", "email");

-- CreateIndex
CREATE INDEX "calendar_event_activities_tenant_id_event_id_created_at_idx" ON "calendar_event_activities"("tenant_id", "event_id", "created_at");

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_activities" ADD CONSTRAINT "calendar_event_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_activities" ADD CONSTRAINT "calendar_event_activities_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_activities" ADD CONSTRAINT "calendar_event_activities_actor_membership_id_fkey" FOREIGN KEY ("actor_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Who was invited and how they answered is personal work data: same row-level
-- isolation as the rest of the calendar (AC-004).
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['event_attendees', 'calendar_event_activities']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "event_attendees" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_event_activities" TO zoiko_app;
