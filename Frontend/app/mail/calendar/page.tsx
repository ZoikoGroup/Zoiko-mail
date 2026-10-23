"use client";

import { Suspense } from "react";
import { MyCalendar } from "@/components/calendar/MyCalendar";

/** /mail/calendar — My Calendar, the Calendar section's home. ?date=yyyy-mm-dd opens a day. */
export default function CalendarPage() {
  return (
    <Suspense>
      <MyCalendar />
    </Suspense>
  );
}
