import { wallTime, zonedInstant } from "../calendar/calendar.zone.js";

/**
 * Day boundaries for the task views, in the person's own zone.
 *
 * "Due today" means today on the clock the person reads, not in UTC: at
 * 00:30 in London during BST it is still yesterday in UTC. And days are not
 * all 24 hours long — the day the clocks go back is 25 — so each boundary is
 * asked of the zone rather than computed by adding milliseconds.
 */
export interface TaskDayBounds {
  zone: string;
  now: Date;
  /** Local date of today, "YYYY-MM-DD". */
  today: string;
  startOfToday: Date;
  startOfTomorrow: Date;
  /** Monday 00:00 of the current week. */
  startOfWeek: Date;
  /** Midnight `n` days after today's midnight (0 = today). */
  dayStart: (n: number) => Date;
}

export function dayBounds(zone: string, now = new Date()): TaskDayBounds {
  const w = wallTime(now, zone);
  const dayStart = (n: number) => {
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + n));
    return zonedInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, zone);
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    zone,
    now,
    today: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    startOfToday: dayStart(0),
    startOfTomorrow: dayStart(1),
    startOfWeek: dayStart(1 - w.weekday),
    dayStart,
  };
}

/** Whole calendar days between two instants' local dates (b − a). */
export function calendarDaysBetween(a: Date, b: Date, zone: string): number {
  const x = wallTime(a, zone);
  const y = wallTime(b, zone);
  return Math.round((Date.UTC(y.year, y.month - 1, y.day) - Date.UTC(x.year, x.month - 1, x.day)) / 86_400_000);
}
