"use client";

import type { ReactNode } from "react";
import { CalendarPrefsGate } from "@/components/calendar/CalendarPrefsGate";

/** Work Graph dates and times follow the member's Calendar Settings too. */
export default function WorkGraphLayout({ children }: { children: ReactNode }) {
  return <CalendarPrefsGate>{children}</CalendarPrefsGate>;
}
