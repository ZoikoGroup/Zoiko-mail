"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar-api";
import { addMonths, eventOnDay, isSameDay, viewRange, weekdayNames } from "@/lib/calendar-dates";


const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/**
 * The small month in the right panel: pick a day, see which days have
 * events (a dot under the date). `month` is the month it shows, which can
 * move independently of the main view until a day is picked.
 */
export function MiniMonth({
  month,
  selected,
  events,
  onMonthChange,
  onSelect,
}: {
  month: Date;
  selected: Date;
  events: CalendarEvent[];
  onMonthChange: (month: Date) => void;
  onSelect: (day: Date) => void;
}) {
  const { days } = viewRange("month", month);
  const today = new Date();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[var(--ink)]">{monthYear.format(month)}</h3>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(addMonths(month, -1))}
            className="rounded-md p-1 text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(month, 1))}
            className="rounded-md p-1 text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {weekdayNames("narrow").map((l, i) => (
          <span key={i} className="pb-1 text-[11px] text-[var(--ink3)]">
            {l}
          </span>
        ))}
        {days.map((day) => {
          const outside = day.getMonth() !== month.getMonth();
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, today);
          const busy = events.some((e) => eventOnDay(e, day));
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={isSelected}
              aria-label={day.toDateString()}
              className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-lg tabular-nums text-[12.5px] transition ${
                isSelected
                  ? "bg-[var(--accent)] font-semibold text-white"
                  : isToday
                    ? "font-semibold text-[var(--accent-ink)] ring-1 ring-inset ring-[var(--accent)]"
                    : outside
                      ? "text-[var(--ink3)] hover:bg-[var(--s2)]"
                      : "text-[var(--ink)] hover:bg-[var(--s2)]"
              }`}
            >
              {day.getDate()}
              {busy && (
                <span
                  aria-hidden
                  className={`absolute bottom-1 h-1 w-1 rounded-full ${isSelected ? "bg-white" : "bg-[var(--accent)]"}`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
