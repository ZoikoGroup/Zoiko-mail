-- Calendar step 5: scheduling links (public booking pages) and the bookings made through them.

-- CreateEnum
CREATE TYPE "BookingLinkStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED');

-- CreateEnum
CREATE TYPE "BookingLocationType" AS ENUM ('VIDEO', 'PHONE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "GuestBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "booking_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_membership_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_notice_hours" INTEGER NOT NULL DEFAULT 12,
    "max_days_ahead" INTEGER NOT NULL DEFAULT 30,
    "time_zone" TEXT NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "day_start" TEXT NOT NULL DEFAULT '09:00',
    "day_end" TEXT NOT NULL DEFAULT '17:00',
    "location_type" "BookingLocationType" NOT NULL DEFAULT 'VIDEO',
    "location_detail" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "status" "BookingLinkStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "guest_name" TEXT NOT NULL,
    "guest_email" TEXT NOT NULL,
    "notes" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "status" "GuestBookingStatus" NOT NULL DEFAULT 'PENDING',
    "event_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_links_slug_key" ON "booking_links"("slug");

-- CreateIndex
CREATE INDEX "booking_links_tenant_id_owner_membership_id_idx" ON "booking_links"("tenant_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "guest_bookings_tenant_id_link_id_status_idx" ON "guest_bookings"("tenant_id", "link_id", "status");

-- CreateIndex
CREATE INDEX "guest_bookings_tenant_id_starts_at_idx" ON "guest_bookings"("tenant_id", "starts_at");

-- AddForeignKey
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_bookings" ADD CONSTRAINT "guest_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_bookings" ADD CONSTRAINT "guest_bookings_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "booking_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_bookings" ADD CONSTRAINT "guest_bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same row-level isolation as the rest of the calendar (AC-004). The public
-- booking page finds a link by its slug explicitly across tenants, then works
-- inside that link's tenant.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['booking_links', 'guest_bookings']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "booking_links" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "guest_bookings" TO zoiko_app;
