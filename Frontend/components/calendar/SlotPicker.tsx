"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Slot } from "@/lib/calendar-api";
import { addMonths, formatTime, isSameDay, viewRange, weekdayNames } from "@/lib/calendar-dates";


const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * Pick a day (days with free times are marked), then a time. Times are shown
 * in the viewer's own zone. `compact` shows only the first few times, for the
 * host's preview card.
 */
export function SlotPicker({
  month,
  onMonthChange,
  slots,
  selectedDay,
  onSelectDay,
  selectedStart,
  onSelectSlot,
  compact = false,
  loading = false,
}: {
  month: Date;
  onMonthChange: (m: Date) => void;
  slots: Slot[];
  selectedDay: Date | null;
  onSelectDay: (d: Date) => void;
  selectedStart?: string | null;
  onSelectSlot?: (slot: Slot) => void;
  compact?: boolean;
  loading?: boolean;
}) {
  const { days } = viewRange("month", month);
  const today = new Date();
  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const d = new Date(s.start);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [slots]);
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const dayTimes = selectedDay ? byDay.get(keyOf(selectedDay)) ?? [] : [];
  const shown = compact ? dayTimes.slice(0, 3) : dayTimes;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[14px] font-semibold text-[var(--ink)]">{monthYear.format(month)}</h4>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous month" onClick={() => onMonthChange(addMonths(month, -1))} className="rounded-md p-1 text-[var(--ink2)] hover:bg-[var(--s2)]">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" aria-label="Next month" onClick={() => onMonthChange(addMonths(month, 1))} className="rounded-md p-1 text-[var(--ink2)] hover:bg-[var(--s2)]">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center" data-testid="slot-days">
        {weekdayNames("narrow").map((l, i) => (
          <span key={i} className="pb-1 text-[11px] text-[var(--ink3)]">
            {l}
          </span>
        ))}
        {days.map((d) => {
          const has = byDay.has(keyOf(d));
          const outside = d.getMonth() !== month.getMonth();
          const selected = selectedDay ? isSameDay(d, selectedDay) : false;
          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={!has}
              onClick={() => onSelectDay(d)}
              aria-pressed={selected}
              aria-label={`${d.toDateString()}${has ? ", has free times" : ""}`}
              className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-[12.5px] tabular-nums transition ${
                selected
                  ? "bg-[var(--accent)] font-semibold text-white"
                  : has
                    ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)] hover:ring-1 hover:ring-[var(--accent)]"
                    : outside
                      ? "text-[var(--ink3)] opacity-40"
                      : isSameDay(d, today)
                        ? "text-[var(--ink)] ring-1 ring-inset ring-[var(--border)]"
                        : "text-[var(--ink3)]"
              }`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-3" data-testid="slot-times">
        {loading ? (
          <p className="text-[12px] text-[var(--ink3)]">Finding free times…</p>
        ) : !selectedDay ? (
          <p className="text-[12px] text-[var(--ink3)]">{slots.length ? "Choose a highlighted day." : "No free times this month."}</p>
        ) : (
          <>
            <p className="mb-2 text-[12px] font-semibold text-[var(--ink2)]">
              {compact ? "Sample available times" : "Available times"} · {dayLabel.format(selectedDay)}
            </p>
            {shown.length === 0 ? (
              <p className="text-[12px] text-[var(--ink3)]">No free times on this day.</p>
            ) : (
              <div className={compact ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2 sm:grid-cols-3"}>
                {shown.map((s) => {
                  const active = selectedStart === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => onSelectSlot?.(s)}
                      aria-pressed={active}
                      className={`rounded-lg border px-2 py-2 text-[13px] font-semibold tabular-nums transition ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--accent)]/60 text-[var(--accent-ink)] hover:bg-[var(--accent-soft)]"
                      }`}
                    >
                      {formatTime(new Date(s.start))}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
