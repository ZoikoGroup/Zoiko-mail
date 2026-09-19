import { describe, expect, it } from "vitest";

import {
  addBusinessMinutes,
  slaFor,
  SEVERITY_RESPONSE_TARGET,
  BUSINESS_DAY_START_HOUR,
  BUSINESS_DAY_END_HOUR,
} from "../src/modules/ticket/sla.js";

/**
 * Initial-response targets — Operational Runbook §5.
 *
 * The old table was four wall-clock durations (4h / 8h / 24h / 72h) against
 * §5's 15 minutes, 1 hour, 4 business hours and 1 business day. Every
 * severity was late, URGENT by a factor of sixteen — on the row whose
 * examples are cross-tenant data exposure and a no-send invariant breach.
 *
 * The tests are written in local time on purpose. Business hours are a local
 * idea, and a due time computed in UTC is wrong for everyone who is not in it.
 */

/** A local Date, so the assertions read the way the rule is written. */
function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("the targets match the ones the runbook sets", () => {
  it("answers a P0 in fifteen minutes, not four hours", () => {
    const raised = at(2026, 9, 21, 10, 0); // Monday morning
    expect(slaFor("URGENT", raised).getTime() - raised.getTime()).toBe(15 * 60_000);
  });

  it("answers a P1 in one hour", () => {
    const raised = at(2026, 9, 21, 10, 0);
    expect(slaFor("HIGH", raised).getTime() - raised.getTime()).toBe(60 * 60_000);
  });

  it("does not make the urgent ones wait for business hours", () => {
    // 22:00 on a Saturday. A cross-tenant exposure does not wait for Monday,
    // which is exactly why §5 states these two in plain elapsed time.
    const weekendNight = at(2026, 9, 19, 22, 0);
    const due = slaFor("URGENT", weekendNight);
    expect(due.getTime() - weekendNight.getTime()).toBe(15 * 60_000);
    expect(due.getDate()).toBe(19);
  });

  it("states each target in the words the runbook uses", () => {
    expect(SEVERITY_RESPONSE_TARGET.URGENT).toBe("15 minutes");
    expect(SEVERITY_RESPONSE_TARGET.HIGH).toBe("1 hour");
    expect(SEVERITY_RESPONSE_TARGET.MEDIUM).toBe("4 business hours");
    expect(SEVERITY_RESPONSE_TARGET.LOW).toBe("1 business day");
  });
});

describe("business hours are counted as business hours", () => {
  it("adds four working hours inside a single day", () => {
    const monday = at(2026, 9, 21, 10, 0);
    const due = slaFor("MEDIUM", monday);
    expect(due.getDate()).toBe(21);
    expect(due.getHours()).toBe(14);
  });

  it("carries the remainder into the next morning rather than into the night", () => {
    // 15:00 Monday + 4 business hours: two hours today, two tomorrow.
    const monday = at(2026, 9, 21, 15, 0);
    const due = slaFor("MEDIUM", monday);
    expect(due.getDate()).toBe(22);
    expect(due.getHours()).toBe(11);
  });

  it("skips the weekend for a Friday afternoon ticket", () => {
    // Friday 16:00 + 4 business hours: one hour on Friday, three on Monday.
    const friday = at(2026, 9, 18, 16, 0);
    const due = slaFor("MEDIUM", friday);
    expect(due.getDay()).toBe(1); // Monday
    expect(due.getDate()).toBe(21);
    expect(due.getHours()).toBe(12);
  });

  it("starts the clock at opening for a ticket raised overnight", () => {
    // 03:00 Tuesday. Nobody is working, so the four hours start at 09:00.
    const overnight = at(2026, 9, 22, 3, 0);
    const due = slaFor("MEDIUM", overnight);
    expect(due.getDate()).toBe(22);
    expect(due.getHours()).toBe(13);
  });

  it("gives a low-severity ticket one working day, not seventy-two hours", () => {
    const monday = at(2026, 9, 21, 10, 0);
    const due = slaFor("LOW", monday);
    // One business day from Monday 10:00 is Tuesday 10:00 — not Thursday.
    expect(due.getDate()).toBe(22);
    expect(due.getHours()).toBe(10);
  });

  it("never lands a due time outside working hours", () => {
    // Every start hour across a week, for both business-time severities.
    for (let day = 18; day <= 24; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        for (const severity of ["MEDIUM", "LOW"] as const) {
          const due = slaFor(severity, at(2026, 9, day, hour));
          expect(due.getDay()).not.toBe(0);
          expect(due.getDay()).not.toBe(6);
          expect(due.getHours()).toBeGreaterThanOrEqual(BUSINESS_DAY_START_HOUR);
          expect(due.getHours()).toBeLessThanOrEqual(BUSINESS_DAY_END_HOUR);
        }
      }
    }
  });

  it("is monotonic: a ticket raised later is never due earlier", () => {
    let previous = 0;
    for (let minute = 0; minute < 60 * 24 * 3; minute += 37) {
      const due = addBusinessMinutes(
        new Date(at(2026, 9, 18, 0).getTime() + minute * 60_000),
        4 * 60
      ).getTime();
      expect(due).toBeGreaterThanOrEqual(previous);
      previous = due;
    }
  });
});
