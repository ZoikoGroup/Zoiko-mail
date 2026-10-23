"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle, Lock } from "lucide-react";
import type { Calendar, CalendarEvent } from "@/lib/calendar-api";
import { addDays, eventOnDay, eventSpan, formatTime, formatTimeRange, isSameDay, startOfDay } from "@/lib/calendar-dates";
import { eventBlockStyle } from "./palette";

/** Height of one hour, in pixels. */
const HOUR_PX = 52;
/** Where the grid scrolls to first: the start of a working day. */
const FIRST_VISIBLE_HOUR = 8;
const minutesOf = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });

interface Placed {
  event: CalendarEvent;
  top: number;
  height: number;
  /** Column within its overlap group, and how many columns the group has. */
  column: number;
  columns: number;
  start: Date;
  end: Date;
}

/**
 * Lay out one day's timed events: each overlapping cluster is split into
 * side-by-side columns, the way calendars show double-booked time.
 */
function layoutDay(events: CalendarEvent[], day: Date): Placed[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const items = events
    .map((event) => {
      const span = eventSpan(event);
      const start = span.start < dayStart ? dayStart : span.start;
      const end = span.end > dayEnd ? dayEnd : span.end;
      return { event, start, end };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());

  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = 0;
  const columnEnds: number[] = [];

  const closeCluster = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const p of cluster) p.columns = columns;
    placed.push(...cluster);
    cluster = [];
    columnEnds.length = 0;
  };

  for (const item of items) {
    const startMs = item.start.getTime();
    const endMs = Math.max(item.end.getTime(), startMs + 15 * 60_000); // at least 15 min tall
    if (cluster.length && startMs >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((end) => end <= startMs);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(endMs);
    } else {
      columnEnds[column] = endMs;
    }
    clusterEnd = Math.max(clusterEnd, endMs);
    const minutesFromMidnight = (item.start.getTime() - dayStart.getTime()) / 60_000;
    const minutes = (endMs - startMs) / 60_000;
    cluster.push({
      event: item.event,
      top: (minutesFromMidnight / 60) * HOUR_PX,
      height: Math.max(18, (minutes / 60) * HOUR_PX - 2),
      column,
      columns: 1,
      start: item.start,
      end: item.end,
    });
  }
  if (cluster.length) closeCluster();
  return placed;
}

export function TimeGrid({
  days,
  events,
  calendars,
  selectedId,
  offsetLabel,
  invitedColor = "teal",
  onSlotClick,
  onEventClick,
  workHours,
}: {
  days: Date[];
  events: CalendarEvent[];
  calendars: Map<string, Calendar>;
  selectedId: string | null;
  offsetLabel: string;
  /** Colour for events I am invited to (they are in someone else's calendar). */
  invitedColor?: string;
  /** Click an empty slot to start an event there. Omitted: the grid is read-only. */
  onSlotClick?: (start: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  /** The member's working hours: time outside them is shaded, and the grid opens at their start. */
  workHours?: { start: string; end: string; days: number[] };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const first = workHours ? Math.max(0, Math.floor(minutesOf(workHours.start) / 60) - 1) : FIRST_VISIBLE_HOUR;
    if (scroller.current) scroller.current.scrollTop = first * HOUR_PX - 8;
    // Only when the grid opens; later changes should not move what the person scrolled to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const allDay = useMemo(() => events.filter((e) => e.allDay), [events]);
  const timed = useMemo(() => events.filter((e) => !e.allDay), [events]);
  const columns = `64px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers */}
      <div className="grid border-b border-[var(--border)]" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-center pb-2 text-[11px] text-[var(--ink3)]">{offsetLabel}</div>
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className={`flex items-center justify-center gap-2 border-l border-[var(--border)] py-3 text-[14px] ${
                today ? "bg-[var(--zm-selected)]" : ""
              }`}
            >
              <span className="text-[var(--ink2)]">{weekday.format(day)}</span>
              <span
                className={`tabular-nums text-[17px] font-semibold ${
                  today
                    ? "inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white"
                    : "text-[var(--ink)]"
                }`}
                aria-current={today ? "date" : undefined}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      {allDay.length > 0 && (
        <div className="grid border-b border-[var(--border)]" style={{ gridTemplateColumns: columns }}>
          <div className="flex items-center justify-center text-[10.5px] text-[var(--ink3)]">All day</div>
          {days.map((day) => (
            <div key={day.toISOString()} className="flex min-h-[30px] flex-col gap-1 border-l border-[var(--border)] p-1">
              {allDay
                .filter((e) => eventOnDay(e, day))
                .map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onEventClick(event)}
                    className={`truncate rounded-md border px-2 py-0.5 text-left text-[11.5px] font-semibold text-[var(--ink)] ${
                      selectedId === event.id ? "ring-2 ring-[var(--accent-ink)]" : ""
                    }`}
                    style={eventBlockStyle(calendars.get(event.calendarId)?.color)}
                  >
                    {event.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Hours */}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto" data-testid="time-grid">
        <div className="grid" style={{ gridTemplateColumns: columns, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 tabular-nums text-[11px] text-[var(--ink3)]"
                style={{ top: hour * HOUR_PX }}
              >
                {hour === 0 ? "" : formatTime(new Date(2026, 0, 1, hour))}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const placed = layoutDay(timed.filter((e) => eventOnDay(e, day)), day);
            const today = isSameDay(day, now);
            const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_PX;
            return (
              <div
                key={day.toISOString()}
                className={`relative border-l border-[var(--border)] ${today ? "bg-[color-mix(in_srgb,var(--zm-selected)_45%,transparent)]" : ""}`}
              >
                {/* Outside working hours (or a non-working day): shaded. */}
                {workHours &&
                  (workHours.days.includes(day.getDay() || 7) ? (
                    <>
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-[var(--s2)]/60" style={{ height: (minutesOf(workHours.start) / 60) * HOUR_PX }} data-testid="off-hours" />
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 bg-[var(--s2)]/60" style={{ top: (minutesOf(workHours.end) / 60) * HOUR_PX }} data-testid="off-hours" />
                    </>
                  ) : (
                    <div aria-hidden className="pointer-events-none absolute inset-0 bg-[var(--s2)]/60" data-testid="off-hours" />
                  ))}
                {/* Half-hour slots: click an empty one to start an event there. */}
                {Array.from({ length: 48 }, (_, slot) => {
                  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(slot / 2), (slot % 2) * 30);
                  const line = slot % 2 === 0 ? "border-t border-[var(--border)]" : "border-t border-dashed border-[color-mix(in_srgb,var(--border)_55%,transparent)]";
                  if (!onSlotClick) {
                    return <div key={slot} aria-hidden className={`absolute inset-x-0 ${line}`} style={{ top: (slot / 2) * HOUR_PX, height: HOUR_PX / 2 }} />;
                  }
                  return (
                    <button
                      key={slot}
                      type="button"
                      tabIndex={-1}
                      aria-label={`New event at ${formatTime(start)}`}
                      onClick={() => onSlotClick(start)}
                      className={`absolute inset-x-0 block hover:bg-[var(--accent-soft)]/40 ${
                        slot % 2 === 0 ? "border-t border-[var(--border)]" : "border-t border-dashed border-[color-mix(in_srgb,var(--border)_55%,transparent)]"
                      }`}
                      style={{ top: (slot / 2) * HOUR_PX, height: HOUR_PX / 2 }}
                    />
                  );
                })}

                {placed.map((p) => {
                  const calendar = calendars.get(p.event.calendarId);
                  const invited = p.event.source === "INVITED";
                  const pending = invited && p.event.myResponse !== "ACCEPTED";
                  const width = 100 / p.columns;
                  const compact = p.height < 40;
                  return (
                    <button
                      key={p.event.id}
                      type="button"
                      onClick={() => onEventClick(p.event)}
                      data-testid="calendar-event"
                      className={`absolute z-10 overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        selectedId === p.event.id ? "ring-2 ring-[var(--accent-ink)]" : ""
                      } ${p.event.showAs === "FREE" || pending ? "border-dashed" : ""}`}
                      style={{
                        ...eventBlockStyle(calendar?.color ?? invitedColor, p.event.showAs === "FREE" || pending),
                        top: p.top + 1,
                        height: p.height,
                        left: `calc(${p.column * width}% + 3px)`,
                        width: `calc(${width}% - 6px)`,
                      }}
                      title={`${p.event.title} · ${formatTimeRange(p.start, p.end)}`}
                    >
                      <span className={`flex items-center gap-1 font-semibold text-[var(--ink)] ${compact ? "text-[11px]" : "text-[12.5px]"}`}>
                        {p.event.visibility === "PRIVATE" && <Lock className="h-3 w-3 shrink-0" aria-label="Private" />}
                        {pending && <HelpCircle className="h-3 w-3 shrink-0" aria-label="Not yet accepted" />}
                        <span className="truncate">{p.event.title}</span>
                      </span>
                      {!compact && (
                        <span className="block truncate tabular-nums text-[11px] text-[var(--ink2)]">
                          {formatTimeRange(p.start, p.end)}
                        </span>
                      )}
                      {p.height > 70 && p.event.location && (
                        <span className="block truncate text-[11px] text-[var(--ink3)]">{p.event.location}</span>
                      )}
                    </button>
                  );
                })}

                {today && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }} aria-hidden>
                    <div className="relative h-[2px] bg-[var(--crit,#E5484D)]">
                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[var(--crit,#E5484D)]" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
