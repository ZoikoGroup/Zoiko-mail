"use client";

import { Suspense } from "react";
import { RoomsPage } from "@/components/calendar/RoomsPage";

/** /mail/calendar/rooms — Meeting Rooms & Resources. ?view=mine|pending|manage opens a list. */
export default function CalendarRoomsPage() {
  return (
    <Suspense>
      <RoomsPage />
    </Suspense>
  );
}
