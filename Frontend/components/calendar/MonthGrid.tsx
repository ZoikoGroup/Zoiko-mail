"use client";

import type { Calendar, CalendarEvent } from "@/lib/calendar-api";
import { eventOnDay, eventSpan, formatTime, isSameDay, weekdayNames } from "@/lib/calendar-dates";
import { eventBlockStyle, swatchStyle } from "./palette";


const SHOWN_PER_DAY = 3;

/** The month view: whole weeks, up to three events a day, the rest behind "+N more". */
export function MonthGrid({
  days,
  month,
  events,
  calendars,
  selectedId,
  onDayClick,
  onEventClick,
}: {
  days: Date[];
  /** The month being shown (days from other months are dimmed). */
  month: number;
  events: CalendarEvent[];
  calendars: Map<string, Calendar>;
  selectedId: string | null;
  onDayClick: (day: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}) {
  const today = new Date();
  const weeks = days.length / 7;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {weekdayNames("short").map((d) => (
          <div key={d} className="py-2 text-center text-[11.5px] font-medium uppercase tracking-wider text-[var(--ink3)]">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${weeks}, minmax(112px, 1fr))` }}>
        {days.map((day) => {
          const dayEvents = events
            .filter((e) => eventOnDay(e, day))
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventSpan(a).start.getTime() - eventSpan(b).start.getTime());
          const isToday = isSameDay(day, today);
          const outside = day.getMonth() !== month;
          return (
            <div
              key={day.toISOString()}
              className={`flex min-w-0 flex-col gap-0.5 overflow-hidden border-b border-l border-[var(--border)] p-1.5 ${outside ? "bg-[var(--s2)]/40" : ""}`}
            >
              <button
                type="button"
                onClick={() => onDayClick(day)}
                aria-label={`Open ${day.toDateString()}`}
                className={`self-start rounded-full px-1.5 tabular-nums text-[12.5px] ${
                  isToday
                    ? "bg-[var(--accent)] font-semibold text-white"
                    : outside
                      ? "text-[var(--ink3)] hover:text-[var(--ink)]"
                      : "text-[var(--ink)] hover:bg-[var(--s2)]"
                }`}
              >
                {day.getDate()}
              </button>
              {dayEvents.slice(0, SHOWN_PER_DAY).map((event) => {
                const calendar = calendars.get(event.calendarId);
                const color = calendar?.color ?? "teal";
                return event.allDay ? (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className={`truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-semibold text-[var(--ink)] ${
                      selectedId === event.id ? "ring-2 ring-[var(--accent-ink)]" : ""
                    }`}
                    style={eventBlockStyle(color)}
                  >
                    {event.title}
                  </button>
                ) : (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className={`flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-[var(--ink2)] hover:bg-[var(--s2)] ${
                      selectedId === event.id ? "ring-2 ring-[var(--accent-ink)]" : ""
                    }`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={swatchStyle(color)} aria-hidden />
                    <span className="tabular-nums text-[var(--ink3)]">{formatTime(new Date(event.startsAt))}</span>
                    <span className="truncate text-[var(--ink)]">{event.title}</span>
                  </button>
                );
              })}
              {dayEvents.length > SHOWN_PER_DAY && (
                <button
                  type="button"
                  onClick={() => onDayClick(day)}
                  className="self-start px-1 text-[11px] font-medium text-[var(--accent-ink)] hover:underline"
                >
                  +{dayEvents.length - SHOWN_PER_DAY} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
