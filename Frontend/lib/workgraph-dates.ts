import { displayPrefs, preferredZone } from "./calendar-dates";

/**
 * Due and review dates belong to a time zone: "26 Oct, 10:00 Europe/London"
 * means the same instant for everyone, and reads the way whoever set it meant
 * it. These convert between that and the date/time inputs, using Intl so
 * daylight saving is right on both sides of the change.
 */

/** How far the zone is ahead of UTC at that instant, in ms. */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asIfUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-10-26" + "10:00" as wall-clock time in `zone` → the instant it names. */
export function zonedToInstant(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const first = zoneOffsetMs(guess, zone);
  let instant = guess - first;
  const second = zoneOffsetMs(instant, zone);
  // Across a daylight-saving change the first guess can be an hour out.
  if (second !== first) instant = guess - second;
  return new Date(instant);
}

/** An instant as the date and time inputs show it, in `zone`. */
export function instantToInputs(iso: string | null | undefined, zone: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
}

/** "26 Oct" and "10:00" (or "10:00 AM") for an instant in its own zone. */
export function formatDue(iso: string | null | undefined, zone: string): { date: string; time: string; zone: string } | null {
  if (!iso) return null;
  const when = new Date(iso);
  const prefs = displayPrefs();
  const date = new Intl.DateTimeFormat(prefs.locale, { timeZone: zone, day: "numeric", month: "short" }).format(when);
  const time =
    prefs.timeFormat === "H12"
      ? new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).format(when)
      : new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(when);
  return { date, time, zone };
}

/** "Mon 26 Oct · 10:00 GMT" for the detail panel. */
export function formatLong(iso: string | null | undefined, zone: string): string {
  if (!iso) return "Not set";
  const when = new Date(iso);
  const prefs = displayPrefs();
  const day = new Intl.DateTimeFormat(prefs.locale, { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(when);
  const time =
    prefs.timeFormat === "H12"
      ? new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(when)
      : new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(when);
  return `${day} · ${time}`;
}

export function zoneChoices(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all?.length) return all;
  } catch {
    // Older browsers: a short list.
  }
  return ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"];
}

export { preferredZone };
