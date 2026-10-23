-- CreateEnum
CREATE TYPE "MeetingTemplateScope" AS ENUM ('PERSONAL', 'TEAM');

-- CreateEnum
CREATE TYPE "MeetingTemplateStatus" AS ENUM ('DRAFT', 'READY', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "ExternalGuestPolicy" AS ENUM ('NOT_ALLOWED', 'APPROVAL', 'ALLOWED');

-- CreateTable
CREATE TABLE "meeting_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_membership_id" UUID NOT NULL,
    "scope" "MeetingTemplateScope" NOT NULL DEFAULT 'PERSONAL',
    "team_calendar_id" UUID,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "location_type" "BookingLocationType" NOT NULL DEFAULT 'VIDEO',
    "location_detail" TEXT,
    "default_attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "min_notice_hours" INTEGER NOT NULL DEFAULT 0,
    "external_guests" "ExternalGuestPolicy" NOT NULL DEFAULT 'APPROVAL',
    "recording_allowed" BOOLEAN NOT NULL DEFAULT false,
    "status" "MeetingTemplateStatus" NOT NULL DEFAULT 'READY',
    "review_note" TEXT,
    "reviewed_by_membership_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_templates_tenant_id_owner_membership_id_idx" ON "meeting_templates"("tenant_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "meeting_templates_tenant_id_team_calendar_id_status_idx" ON "meeting_templates"("tenant_id", "team_calendar_id", "status");

-- AddForeignKey
ALTER TABLE "meeting_templates" ADD CONSTRAINT "meeting_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_templates" ADD CONSTRAINT "meeting_templates_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_templates" ADD CONSTRAINT "meeting_templates_reviewed_by_membership_id_fkey" FOREIGN KEY ("reviewed_by_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_templates" ADD CONSTRAINT "meeting_templates_team_calendar_id_fkey" FOREIGN KEY ("team_calendar_id") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A team template points at a team calendar; a personal one never does.
ALTER TABLE "meeting_templates" ADD CONSTRAINT "meeting_templates_scope_calendar_check"
  CHECK ((scope = 'TEAM' AND team_calendar_id IS NOT NULL) OR (scope = 'PERSONAL' AND team_calendar_id IS NULL));

-- Same row-level isolation as the rest of the calendar (AC-004).
ALTER TABLE "meeting_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meeting_templates_tenant_isolation" ON "meeting_templates";
CREATE POLICY "meeting_templates_tenant_isolation" ON "meeting_templates"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "meeting_templates" TO zoiko_app;
