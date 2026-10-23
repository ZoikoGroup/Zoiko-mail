-- Calendar step 3: sharing calendars (team calendars are shared with their members),
-- access levels, and requests for access.

-- CreateEnum
CREATE TYPE "CalendarAccess" AS ENUM ('FREE_BUSY', 'VIEW', 'EDIT', 'MANAGE');

-- CreateEnum
CREATE TYPE "CalendarAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "calendar_shares" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "access" "CalendarAccess" NOT NULL DEFAULT 'VIEW',
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "granted_by_membership_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_access_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "requester_membership_id" UUID NOT NULL,
    "access" "CalendarAccess" NOT NULL,
    "message" TEXT,
    "status" "CalendarAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_membership_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_shares_tenant_id_membership_id_idx" ON "calendar_shares"("tenant_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_shares_calendar_id_membership_id_key" ON "calendar_shares"("calendar_id", "membership_id");

-- CreateIndex
CREATE INDEX "calendar_access_requests_tenant_id_calendar_id_status_idx" ON "calendar_access_requests"("tenant_id", "calendar_id", "status");

-- CreateIndex
CREATE INDEX "calendar_access_requests_tenant_id_requester_membership_id_idx" ON "calendar_access_requests"("tenant_id", "requester_membership_id");

-- AddForeignKey
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_granted_by_membership_id_fkey" FOREIGN KEY ("granted_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_access_requests" ADD CONSTRAINT "calendar_access_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_access_requests" ADD CONSTRAINT "calendar_access_requests_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_access_requests" ADD CONSTRAINT "calendar_access_requests_requester_membership_id_fkey" FOREIGN KEY ("requester_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_access_requests" ADD CONSTRAINT "calendar_access_requests_decided_by_membership_id_fkey" FOREIGN KEY ("decided_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One open request per person per calendar: asking again updates nothing new.
CREATE UNIQUE INDEX "calendar_access_requests_one_pending" ON "calendar_access_requests"("calendar_id", "requester_membership_id") WHERE "status" = 'PENDING';

-- Who may see whose calendar is itself sensitive: the same row-level isolation
-- as the rest of the calendar (AC-004).
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['calendar_shares', 'calendar_access_requests']
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_shares" TO zoiko_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_access_requests" TO zoiko_app;
