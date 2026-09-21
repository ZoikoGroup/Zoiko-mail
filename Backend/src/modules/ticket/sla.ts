import type { TicketSeverity } from "@prisma/client";

/**
 * Initial-response targets — Operational Runbook §5.
 *
 * The table had four plain wall-clock durations: URGENT 4h, HIGH 8h, MEDIUM
 * 24h, LOW 72h. §5 asks for 15 minutes, 1 hour, 4 business hours and 1
 * business day, so every severity was late — URGENT by a factor of sixteen,
 * on the row whose examples are cross-tenant data exposure and a no-send
 * invariant breach.
 *
 * Two of the four are expressed in *business* time, which is not a unit
 * `Date` has. Adding four hours to a Friday 5pm ticket produced a due time
 * nobody was working through, so an SLA that looked met on the clock was
 * missed in practice — and one that looked missed on Monday morning had in
 * fact been answered first thing.
 *
 * P0 and P1 are deliberately *not* business-time. A 15-minute response to a
 * cross-tenant exposure does not wait for Monday, which is the entire reason
 * §5 separates them.
 */

/** URGENT and HIGH are elapsed minutes; nothing pauses for them. */
const ELAPSED_MINUTES: Partial<Record<TicketSeverity, number>> = {
  URGENT: 15,
  HIGH: 60,
};

/** MEDIUM and LOW are counted in working time only. */
const BUSINESS_MINUTES: Partial<Record<TicketSeverity, number>> = {
  MEDIUM: 4 * 60,
  LOW: 8 * 60,
};

/**
 * The working day, in local time.
 *
 * One window, Monday to Friday, no holiday calendar. That is a simplification
 * and is called out rather than hidden: a holiday calendar is per-region and
 * belongs in configuration, and getting the weekend right removes most of the
 * error. Where it is wrong it is wrong in the safe direction — a due time
 * lands earlier than a holiday-aware one would, so nothing is reported green
 * that was actually late.
 */
export const BUSINESS_DAY_START_HOUR = 9;
export const BUSINESS_DAY_END_HOUR = 17;
const BUSINESS_MINUTES_PER_DAY = (BUSINESS_DAY_END_HOUR - BUSINESS_DAY_START_HOUR) * 60;

function isWorkingDay(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/** The next instant that counts as working time, at or after `from`. */
function intoWorkingHours(from: Date): Date {
  const at = new Date(from.getTime());
  for (let guard = 0; guard < 14; guard += 1) {
    if (!isWorkingDay(at)) {
      at.setDate(at.getDate() + 1);
      at.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
      continue;
    }
    if (at.getHours() < BUSINESS_DAY_START_HOUR) {
      at.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
      return at;
    }
    if (at.getHours() >= BUSINESS_DAY_END_HOUR) {
      at.setDate(at.getDate() + 1);
      at.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
      continue;
    }
    return at;
  }
  return at;
}

/**
 * `minutes` of working time after `from`, skipping evenings and weekends.
 *
 * Walks day by day rather than doing the arithmetic in one step, because the
 * closed-form version has to special-case the first partial day and the last
 * one, and those are exactly the cases a Friday-afternoon ticket lands in.
 */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  let at = intoWorkingHours(from);
  let left = minutes;

  for (let guard = 0; guard < 400 && left > 0; guard += 1) {
    const endOfDay = new Date(at.getTime());
    endOfDay.setHours(BUSINESS_DAY_END_HOUR, 0, 0, 0);
    const availableToday = Math.max(0, Math.round((endOfDay.getTime() - at.getTime()) / 60_000));

    if (left <= availableToday) {
      return new Date(at.getTime() + left * 60_000);
    }

    left -= availableToday;
    const nextDay = new Date(at.getTime());
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
    at = intoWorkingHours(nextDay);
  }

  return at;
}

/** When a ticket of this severity must have had its first response. */
export function slaFor(severity: TicketSeverity, from: Date = new Date()): Date {
  const elapsed = ELAPSED_MINUTES[severity];
  if (elapsed !== undefined) {
    return new Date(from.getTime() + elapsed * 60_000);
  }
  const business = BUSINESS_MINUTES[severity] ?? BUSINESS_MINUTES_PER_DAY;
  return addBusinessMinutes(from, business);
}

/** What §5 calls this severity, for anything that shows the target to a person. */
export const SEVERITY_RESPONSE_TARGET: Record<TicketSeverity, string> = {
  URGENT: "15 minutes",
  HIGH: "1 hour",
  MEDIUM: "4 business hours",
  LOW: "1 business day",
};
