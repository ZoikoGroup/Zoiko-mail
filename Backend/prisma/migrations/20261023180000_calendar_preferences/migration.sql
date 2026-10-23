-- CreateTable
CREATE TABLE "calendar_preferences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "default_view" TEXT NOT NULL DEFAULT 'week',
    "week_start" INTEGER NOT NULL DEFAULT 1,
    "default_duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "time_zone" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-GB',
    "date_format" TEXT NOT NULL DEFAULT 'DMY',
    "time_format" TEXT NOT NULL DEFAULT 'H24',
    "show_weekends" BOOLEAN NOT NULL DEFAULT false,
    "show_descriptions" BOOLEAN NOT NULL DEFAULT true,
    "work_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "work_start" TEXT NOT NULL DEFAULT '09:00',
    "work_end" TEXT NOT NULL DEFAULT '17:00',
    "default_visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'DEFAULT',
    "default_show_as" "CalendarEventShowAs" NOT NULL DEFAULT 'BUSY',
    "allow_access_requests" BOOLEAN NOT NULL DEFAULT true,
    "show_pending_invitations" BOOLEAN NOT NULL DEFAULT true,
    "notify_invitations" BOOLEAN NOT NULL DEFAULT true,
    "notify_responses" BOOLEAN NOT NULL DEFAULT true,
    "notify_updates" BOOLEAN NOT NULL DEFAULT true,
    "notify_bookings" BOOLEAN NOT NULL DEFAULT true,
    "notify_sharing" BOOLEAN NOT NULL DEFAULT true,
    "notify_templates" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_preferences_membership_id_key" ON "calendar_preferences"("membership_id");

-- CreateIndex
CREATE INDEX "calendar_preferences_tenant_id_idx" ON "calendar_preferences"("tenant_id");

-- AddForeignKey
ALTER TABLE "calendar_preferences" ADD CONSTRAINT "calendar_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_preferences" ADD CONSTRAINT "calendar_preferences_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "tenant_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same row-level isolation as the rest of the calendar (AC-004).
ALTER TABLE "calendar_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calendar_preferences_tenant_isolation" ON "calendar_preferences";
CREATE POLICY "calendar_preferences_tenant_isolation" ON "calendar_preferences"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_preferences" TO zoiko_app;
