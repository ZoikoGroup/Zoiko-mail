/**
 * Date arithmetic for the calendar, in the viewer's local time zone.
 *
 * Small on purpose: the calendar needs days, weeks and months, local
 * midnights and a few labels, which the platform's Date and Intl already do
 * correctly (including daylight-saving changes, because days are stepped with
 * setDate rather than by adding 24 hours).
 */

export type CalendarView = "day" | "workweek" | "week" | "month" | "agenda";

export const VIEW_LABEL: Record<CalendarView, string> = {
  day: "Day",
  workweek: "Work week",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};

/**
 * The member's display preferences (Calendar Settings). Applied once they
 * load, before any calendar page renders (CalendarWorkspace), so every date
 * helper below follows them.
 */
export interface DisplayPrefs {
  /** 1 = Monday, 0 = Sunday, 6 = Saturday */
  weekStart: number;
  showWeekends: boolean;
  /** ISO weekdays, 1 = Monday … 7 = Sunday */
  workDays: number[];
  timeFormat: "H24" | "H12";
  dateFormat: "DMY" | "MDY" | "YMD";
  locale: string;
  /** Zone for new events and links; null follows the device. */
  timeZone: string | null;
}

const DEFAULT_DISPLAY: DisplayPrefs = {
  weekStart: 1,
  showWeekends: true,
  workDays: [1, 2, 3, 4, 5],
  timeFormat: "H24",
  dateFormat: "DMY",
  locale: "en-GB",
  timeZone: null,
};
let display: DisplayPrefs = { ...DEFAULT_DISPLAY };

export function displayPrefs(): DisplayPrefs {
  return display;
}

export function applyDisplayPrefs(next: Partial<DisplayPrefs>): void {
  display = { ...DEFAULT_DISPLAY, ...next };
  buildFormatters();
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a local date. */
export function isoDay(date: Date): number {
  return date.getDay() || 7;
}

/** Weekday names in the order the week starts, e.g. ["Mon", …] or ["Sun", …]. */
export function weekdayNames(style: "short" | "narrow" = "short"): string[] {
  const format = new Intl.DateTimeFormat(display.locale, { weekday: style });
  // 2026-10-04 is a Sunday (getDay() = 0).
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 9, 4 + ((display.weekStart + i) % 7))));
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  // Keep the day where the target month has it (31 Jan + 1 month → 28/29 Feb).
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(date.getDate(), lastDay));
  return next;
}

/** The first day of the week `date` is in (Monday unless the member chose otherwise). */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() - display.weekStart + 7) % 7;
  return addDays(day, -offset);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The days a view shows, and the instant range to fetch for it. */
export function viewRange(view: CalendarView, anchor: Date): { days: Date[]; from: Date; to: Date } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { days: [from], from, to: addDays(from, 1) };
  }
  if (view === "workweek" || view === "week" || view === "agenda") {
    const from = startOfWeek(anchor);
    const week = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    // Week: weekends only when shown. Work week: the member's working days.
    const days =
      view === "week"
        ? display.showWeekends
          ? week
          : week.filter((d) => isoDay(d) <= 5)
        : view === "workweek"
          ? week.filter((d) => (display.workDays.length ? display.workDays : [1, 2, 3, 4, 5]).includes(isoDay(d)))
          : week;
    return { days: days.length ? days : week, from, to: addDays(from, 7) };
  }
  // Month: whole weeks covering the month, from the chosen first day (5 or 6 rows).
  const first = startOfMonth(anchor);
  const from = startOfWeek(first);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const to = addDays(startOfWeek(last), 7);
  const days: Date[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  return { days, from, to };
}

/** Step the anchor date one view forward (+1) or back (-1). */
export function stepAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === "day") return addDays(anchor, direction);
  if (view === "month") return addMonths(anchor, direction);
  return addDays(anchor, 7 * direction); // week, work week, agenda
}

let monthDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
let monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
let fullDate = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
let timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

function buildFormatters() {
  const locale = display.locale;
  monthDay = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" });
  monthYear = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  fullDate = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  timeFormat =
    display.timeFormat === "H12"
      ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** A date in the member's chosen order: 23/10/2026, 10/23/2026 or 2026-10-23. */
export function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  if (display.dateFormat === "MDY") return `${mm}/${dd}/${yyyy}`;
  if (display.dateFormat === "YMD") return `${yyyy}-${mm}-${dd}`;
  return `${dd}/${mm}/${yyyy}`;
}

/** Zone for new events and booking links: the member's choice, or the device's. */
export function preferredZone(): string {
  return display.timeZone ?? localZone().zone;
}

/** "19 – 23 October 2026", "28 September – 2 October 2026", "October 2026". */
export function rangeLabel(view: CalendarView, anchor: Date): string {
  if (view === "month") return monthYear.format(anchor);
  if (view === "day") return fullDate.format(anchor);
  const { days } = viewRange(view, anchor);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (first.getMonth() === last.getMonth()) {
    return `${first.getDate()} – ${last.getDate()} ${monthYear.format(last)}`;
  }
  if (first.getFullYear() !== last.getFullYear()) {
    return `${monthDay.format(first)} ${first.getFullYear()} – ${monthDay.format(last)} ${last.getFullYear()}`;
  }
  return `${monthDay.format(first)} – ${monthDay.format(last)} ${last.getFullYear()}`;
}

export function formatTime(date: Date): string {
  return timeFormat.format(date);
}

export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** The viewer's zone, e.g. "Europe/London", and a label like "London · BST (UTC+1)". */
export function localZone(): { zone: string; label: string; offsetLabel: string } {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const now = new Date();
  const shortName =
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const minutes = -now.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const mins = Math.abs(minutes) % 60;
  const offsetLabel = `UTC${sign}${hours}${mins ? `:${String(mins).padStart(2, "0")}` : ""}`;
  const city = zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
  const label = shortName && !shortName.startsWith("GMT") ? `${city} · ${shortName} (${offsetLabel})` : `${city} · ${offsetLabel}`;
  return { zone, label, offsetLabel: offsetLabel.replace("UTC", "GMT") };
}

/** "yyyy-mm-dd" for a local date (input[type=date] value). */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "hh:mm" for a local time (input[type=time] value). */
export function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Local date + time inputs → Date. */
export function fromInputs(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
}

/**
 * All-day events are stored as whole UTC days. These convert between that
 * storage and the local calendar date the person picked and sees.
 */
export function allDayToUtc(localDate: string): string {
  return `${localDate}T00:00:00.000Z`;
}
export function utcToAllDayLocal(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The local-time span an event covers, with all-day events mapped to local whole days. */
export function eventSpan(event: { startsAt: string; endsAt: string; allDay: boolean }): { start: Date; end: Date } {
  if (event.allDay) return { start: utcToAllDayLocal(event.startsAt), end: utcToAllDayLocal(event.endsAt) };
  return { start: new Date(event.startsAt), end: new Date(event.endsAt) };
}

/** Whether an event touches the local day `day`. */
export function eventOnDay(event: { startsAt: string; endsAt: string; allDay: boolean }, day: Date): boolean {
  const { start, end } = eventSpan(event);
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return start < dayEnd && end > dayStart;
}
