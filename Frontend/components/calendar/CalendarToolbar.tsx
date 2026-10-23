"use client";

import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { rangeLabel, startOfDay, stepAnchor, type CalendarView } from "@/lib/calendar-dates";

/**
 * Today, back/forward, the range shown, the time zone, and a set of view
 * buttons — the toolbar over every calendar grid.
 */
export function CalendarToolbar<T extends string>({
  anchor,
  onAnchor,
  stepView,
  labelView,
  zoneLabel,
  views,
  view,
  onView,
}: {
  anchor: Date;
  onAnchor: (next: Date) => void;
  /** How far one step moves (day, week…). */
  stepView: CalendarView;
  /** Which range the heading describes. */
  labelView: CalendarView;
  zoneLabel: string;
  views: Array<{ key: T; label: string }>;
  view: T;
  onView: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
      <button type="button" className="zoiko-btn" onClick={() => onAnchor(startOfDay(new Date()))}>
        Today
      </button>
      <div className="flex gap-1">
        <button type="button" className="zoiko-btn px-2" aria-label="Previous" onClick={() => onAnchor(stepAnchor(stepView, anchor, -1))}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className="zoiko-btn px-2" aria-label="Next" onClick={() => onAnchor(stepAnchor(stepView, anchor, 1))}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <h2 className="mx-1 text-[18px] font-semibold text-[var(--ink)]" aria-live="polite" data-testid="range-label">
        {rangeLabel(labelView, anchor)}
      </h2>
      <span className="hidden items-center gap-1.5 text-[12.5px] text-[var(--ink3)] md:flex">
        <Clock className="h-3.5 w-3.5" aria-hidden /> {zoneLabel}
      </span>
      <div className="ml-auto inline-flex rounded-lg border border-[var(--border)] bg-[var(--s2)] p-0.5" role="tablist" aria-label="View">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            onClick={() => onView(v.key)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] transition ${
              view === v.key ? "bg-[var(--accent)] font-semibold text-white" : "text-[var(--ink2)] hover:text-[var(--ink)]"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
