"use client";

import { Suspense } from "react";
import { SchedulingPage } from "@/components/calendar/SchedulingPage";

/** /mail/calendar/scheduling — Scheduling Links. ?tab=team|requests opens a tab. */
export default function CalendarSchedulingPage() {
  return (
    <Suspense>
      <SchedulingPage />
    </Suspense>
  );
}
