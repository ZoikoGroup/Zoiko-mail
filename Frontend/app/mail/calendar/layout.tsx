"use client";

import type { ReactNode } from "react";
import { CalendarPrefsGate } from "@/components/calendar/CalendarPrefsGate";

/** Every Calendar page follows the member's Calendar Settings. */
export default function CalendarLayout({ children }: { children: ReactNode }) {
  return <CalendarPrefsGate>{children}</CalendarPrefsGate>;
}
