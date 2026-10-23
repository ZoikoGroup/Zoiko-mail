/**
 * Wall-clock time in a named time zone, without a date library.
 *
 * A booking link says "Monday to Friday, 09:00–17:00, Europe/London"; turning
 * that into instants has to follow the zone's rules, including the days the
 * clocks change. Intl knows the rules; these helpers ask it.
 */

interface WallTime {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
    formatters.set(zone, f);
  }
  return f;
}

/** What a clock in `zone` shows at `instant`. */
export function wallTime(instant: Date, zone: string): WallTime {
  const parts = formatter(zone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(get("hour")) % 24; // some runtimes print midnight as 24
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    weekday: WEEKDAY[get("weekday")] ?? 1,
  };
}

/** How far ahead of UTC `zone` is at `instant`, in milliseconds. */
function offsetAt(instant: Date, zone: string): number {
  const w = wallTime(instant, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * The instant a clock in `zone` shows the given date and time. In the hour
 * skipped when clocks go forward, the result lands just after it.
 */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(new Date(guess), zone);
  const second = guess - offsetAt(new Date(first), zone);
  return new Date(second);
}

/** "09:30" → [9, 30]. */
export function parseHm(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [h ?? 0, m ?? 0];
}

/** The calendar dates (in `zone`) from `from` to `to`, inclusive, as y/m/d. */
export function datesBetween(from: Date, to: Date, zone: string): Array<{ year: number; month: number; day: number }> {
  const start = wallTime(from, zone);
  const end = wallTime(to, zone);
  const out: Array<{ year: number; month: number; day: number }> = [];
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
  const last = Date.UTC(end.year, end.month - 1, end.day);
  while (cursor.getTime() <= last && out.length < 400) {
    out.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** ISO weekday of a calendar date (independent of zone). */
export function isoWeekday(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
}
