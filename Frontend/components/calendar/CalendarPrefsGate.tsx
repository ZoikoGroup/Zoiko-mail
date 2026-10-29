"use client";

import type { ReactNode } from "react";
import { useCalendarPreferences } from "@/lib/calendar-hooks";
import { useMe } from "@/lib/auth-hooks";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/lib/calendar-api";
import { applyDisplayPrefs } from "@/lib/calendar-dates";
import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Pages that show dates follow the member's Calendar Settings (first day of the
 * week, weekends, 12/24-hour time, date order, language). They are applied here,
 * before any page renders, so nothing draws with the wrong format first. If they
 * cannot be read, the defaults apply.
 */
export function CalendarPrefsGate({ children }: { children: ReactNode }) {
  const prefs = useCalendarPreferences();
  // Started here, alongside the preferences, rather than by the shell once
  // this gate opens: the shell's session check reads the same query, so the
  // two waits overlap instead of running one after the other.
  useMe();
  if (prefs.isPending) {
    // The same caption as the mail shell's loader that follows it, so a
    // Calendar or Work Graph load shows one steady loading screen.
    return <BrandLoader className="zm-webmail" label="Loading Zoiko Mail" />;
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
