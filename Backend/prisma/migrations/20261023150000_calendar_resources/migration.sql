-- Calendar step 4: meeting rooms and equipment, and bookings of them.
-- Double booking is prevented in the service (a per-resource lock and an overlap check).

-- CreateEnum
CREATE TYPE "CalendarResourceKind" AS ENUM ('ROOM', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "ResourceBookingStatus" AS ENUM ('CONFIRMED', 'PENDING', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "calendar_resources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "CalendarResourceKind" NOT NULL DEFAULT 'ROOM',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacity" INTEGER,
    "location" TEXT,
    "floor" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "booked_by_membership_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "ResourceBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "attendee_count" INTEGER,
    "note" TEXT,
    "decided_by_membership_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_resources_tenant_id_is_active_idx" ON "calendar_resources"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "resource_bookings_tenant_id_resource_id_starts_at_idx" ON "resource_bookings"("tenant_id", "resource_id", "starts_at");

-- CreateIndex
CREATE INDEX "resource_bookings_tenant_id_booked_by_membership_id_idx" ON "resource_bookings"("tenant_id", "booked_by_membership_id");

-- CreateIndex
CREATE INDEX "resource_bookings_tenant_id_status_idx" ON "resource_bookings"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "calendar_resources" ADD CONSTRAINT "calendar_resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "calendar_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_booked_by_membership_id_fkey" FOREIGN KEY ("booked_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_decided_by_membership_id_fkey" FOREIGN KEY ("decided_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A room is booked for an event once: booking it again for the same event
-- (while the first booking still holds it) is the same booking.
CREATE UNIQUE INDEX "resource_bookings_one_live_per_event" ON "resource_bookings"("event_id", "resource_id") WHERE "status" IN ('CONFIRMED', 'PENDING');

-- Same row-level isolation as the rest of the calendar (AC-004).
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['calendar_resources', 'resource_bookings']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_resources" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "resource_bookings" TO zoiko_app;
