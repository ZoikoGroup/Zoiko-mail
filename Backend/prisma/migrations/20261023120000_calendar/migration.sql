-- Calendar: a member's calendars and the events in them (Calendar step 1).

-- CreateEnum
CREATE TYPE "CalendarKind" AS ENUM ('PERSONAL', 'TEAM');

-- CreateEnum
CREATE TYPE "CalendarEventVisibility" AS ENUM ('DEFAULT', 'PRIVATE');

-- CreateEnum
CREATE TYPE "CalendarEventShowAs" AS ENUM ('BUSY', 'FREE');

-- CreateTable
CREATE TABLE "calendars" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_membership_id" UUID,
    "kind" "CalendarKind" NOT NULL DEFAULT 'PERSONAL',
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "organizer_membership_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "video_link" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'DEFAULT',
    "show_as" "CalendarEventShowAs" NOT NULL DEFAULT 'BUSY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendars_tenant_id_owner_membership_id_idx" ON "calendars"("tenant_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_calendar_id_starts_at_idx" ON "calendar_events"("tenant_id", "calendar_id", "starts_at");

-- CreateIndex
CREATE INDEX "calendar_events_tenant_id_starts_at_ends_at_idx" ON "calendar_events"("tenant_id", "starts_at", "ends_at");

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizer_membership_id_fkey" FOREIGN KEY ("organizer_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One default calendar per member, so two simultaneous first visits create
-- "Work" once (calendar.service listCalendars relies on it).
CREATE UNIQUE INDEX "calendars_one_default_per_owner" ON "calendars"("owner_membership_id") WHERE "is_default";

-- Event titles, descriptions, locations and attendees are personal work data,
-- so both tables get the same row-level isolation as the mail tables (AC-004).
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['calendars', 'calendar_events']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "calendars" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_events" TO zoiko_app;
