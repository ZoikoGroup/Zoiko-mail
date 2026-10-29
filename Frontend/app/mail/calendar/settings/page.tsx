"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { SettingsPage } from "@/components/calendar/SettingsPage";

/** /mail/calendar/settings — Calendar Settings & Preferences. ?section= opens a section. */
export default function CalendarSettingsPage() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <SettingsPage />
    </Suspense>
  );
}
