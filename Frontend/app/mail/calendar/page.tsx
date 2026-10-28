"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { MyCalendar } from "@/components/calendar/MyCalendar";

/** /mail/calendar — My Calendar, the Calendar section's home. ?date=yyyy-mm-dd opens a day. */
export default function CalendarPage() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <MyCalendar />
    </Suspense>
  );
}
