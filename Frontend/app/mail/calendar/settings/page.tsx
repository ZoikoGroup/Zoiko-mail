"use client";

import { Suspense } from "react";
import { SettingsPage } from "@/components/calendar/SettingsPage";

/** /mail/calendar/settings — Calendar Settings & Preferences. ?section= opens a section. */
export default function CalendarSettingsPage() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
