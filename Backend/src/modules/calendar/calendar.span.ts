import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

/** A timed event longer than this is almost certainly a mistake (an all-day event is the way to block days). */
export const MAX_TIMED_EVENT_MS = 7 * 86_400_000;
/** An all-day event may span up to this long (a holiday, a conference). */
export const MAX_ALL_DAY_EVENT_MS = 62 * 86_400_000;

export const DAY_MS = 86_400_000;


export function invalid(message: string, path: string): AppError {
  return new AppError(message, 400, ErrorCodes.VALIDATION_ERROR, [{ path, message }]);
}

/** Midnight UTC of the day `date` falls on (UTC). */
export function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The span an event occupies, checked and normalised.
 *
 * All-day events are stored as whole UTC days — midnight of the first day to
 * midnight after the last — so they read the same in every time zone, which is
 * what "all day" means to the person who set it. The client sends the dates it
 * means as UTC midnights; anything in between is rounded to the day it falls on.
 */
export function normaliseSpan(startsAt: Date, endsAt: Date, allDay: boolean): { startsAt: Date; endsAt: Date } {
  if (allDay) {
    const start = utcMidnight(startsAt);
    let end = utcMidnight(endsAt);
    // An all-day event ending on the day it starts means "that one day".
    if (end <= start) end = new Date(start.getTime() + DAY_MS);
    if (end.getTime() - start.getTime() > MAX_ALL_DAY_EVENT_MS) {
      throw invalid("An all-day event can span at most 62 days.", "endsAt");
    }
    return { startsAt: start, endsAt: end };
  }
  if (endsAt <= startsAt) throw invalid("The event must end after it starts.", "endsAt");
  if (endsAt.getTime() - startsAt.getTime() > MAX_TIMED_EVENT_MS) {
    throw invalid("An event can last at most 7 days. Use an all-day event for longer.", "endsAt");
  }
  return { startsAt, endsAt };
}

/** Whether `zone` is an IANA time zone this runtime knows. */
export function assertTimeZone(zone: string): void {
  try {
    // Throws RangeError for a zone the runtime does not know.
    Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(0);
  } catch {
    throw invalid("That time zone is not recognised.", "timeZone");
  }
}

