"use client";

import { Suspense } from "react";
import { SharedCalendarsPage } from "@/components/calendar/SharedCalendarsPage";

/** /mail/calendar/shared — Shared Calendars. ?requests=1 opens the access requests. */
export default function CalendarSharedPage() {
  return (
    <Suspense>
      <SharedCalendarsPage />
    </Suspense>
  );
}
