"use client";

import type { ReactNode } from "react";
import { useCalendarPreferences } from "@/lib/calendar-hooks";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/lib/calendar-api";
import { applyDisplayPrefs } from "@/lib/calendar-dates";

/**
 * Pages that show dates follow the member's Calendar Settings (first day of the
 * week, weekends, 12/24-hour time, date order, language). They are applied here,
 * before any page renders, so nothing draws with the wrong format first. If they
 * cannot be read, the defaults apply.
 */
export function CalendarPrefsGate({ children }: { children: ReactNode }) {
  const prefs = useCalendarPreferences();
  if (prefs.isPending) {
    return (
      <div className="zm-webmail flex h-screen items-center justify-center bg-[var(--ground)] text-[13px] text-[var(--ink3)]" role="status">
        Loading…
      </div>
    );
  }
  const p = prefs.data ?? DEFAULT_CALENDAR_PREFERENCES;
  applyDisplayPrefs({
    weekStart: p.weekStart,
    showWeekends: p.showWeekends,
    workDays: p.workDays,
    timeFormat: p.timeFormat,
    dateFormat: p.dateFormat,
    locale: p.locale,
    timeZone: p.timeZone,
  });
  return <>{children}</>;
}
