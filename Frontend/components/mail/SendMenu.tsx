"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, ChevronUp, Clock } from "lucide-react";

function at(date: Date, hour: number, minute = 0): Date {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function nextMonday(from: Date): Date {
  const d = new Date(from);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const daysUntilMonday = ((1 - day + 7) % 7) || 7; // always the *next* Monday, never today
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Matches the approved design: a primary Send button with a caret that
 * opens "SCHEDULE SEND" presets, plus a custom date/time picker. Selecting
 * a preset or a custom time calls onSchedule; the bare Send button calls
 * onSendNow. Both exist as separate callbacks — scheduling is a different
 * backend action (POST .../schedule) from an immediate send, not a client-
 * side delay on the same send.
 */
export function SendMenu({
  onSendNow,
  onSchedule,
  pending = false,
}: {
  onSendNow: () => void;
  onSchedule: (at: Date) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCustomOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = nextMonday(now);

  const presets = [
    { label: "Tomorrow morning", date: at(tomorrow, 9) },
    { label: "Tomorrow afternoon", date: at(tomorrow, 14) },
    { label: "Monday morning", date: at(monday, 9) },
  ];

  const choose = (date: Date) => {
    onSchedule(date);
    setOpen(false);
    setCustomOpen(false);
  };

  return (
    <div className="relative flex" ref={ref}>
      <button
        onClick={onSendNow}
        disabled={pending}
        className="zoiko-btn pri rounded-r-none disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="zoiko-btn pri rounded-l-none border-l border-white/20 px-2 disabled:opacity-50"
        aria-label="Schedule send"
        title="Schedule send"
      >
        <ChevronUp className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--sh3)]">
          <div className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
            Schedule send
          </div>
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => choose(p.date)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-[var(--ink2)] hover:bg-[var(--s2)]"
            >
              <span>{p.label}</span>
              <span className="text-xs text-[var(--ink3)]">
                {dayLabel(p.date)} {timeLabel(p.date)}
              </span>
            </button>
          ))}

          {customOpen ? (
            <div className="mt-1 flex items-center gap-1.5 border-t border-[var(--border)] px-1 pt-2">
              <input
                type="datetime-local"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                className="h-8 flex-1 rounded-md border border-[var(--border)] bg-[var(--ground)] px-2 text-xs"
              />
              <button
                disabled={!customValue}
                onClick={() => choose(new Date(customValue))}
                className="zoiko-btn sm pri"
              >
                Set
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCustomOpen(true)}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md border-t border-[var(--border)] px-2 py-1.5 pt-2 text-left text-sm text-[var(--accent-ink)] hover:bg-[var(--s2)]"
            >
              <Clock className="h-3.5 w-3.5" /> Pick date &amp; time…
            </button>
          )}
        </div>
      )}
    </div>
  );
}