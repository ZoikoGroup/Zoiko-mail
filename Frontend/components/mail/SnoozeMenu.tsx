"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";

function at(date: Date, hour: number, minute = 0): Date {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Four fixed presets plus a native datetime picker for anything else —
 * matches the "Later today / Tomorrow / Next week / Pick a date" pattern
 * from the design without pulling in a date-picker library for one menu. */
function presets(): { label: string; date: Date }[] {
  const now = new Date();
  const laterToday = at(now, now.getHours() + 3);
  const tomorrow = at(new Date(now.getTime() + 86_400_000), 9);
  const nextWeek = at(new Date(now.getTime() + 7 * 86_400_000), 9);
  return [
    { label: "Later today", date: laterToday },
    { label: "Tomorrow, 9:00 AM", date: tomorrow },
    { label: "Next week", date: nextWeek },
  ].filter((p) => p.date.getTime() > now.getTime());
}

export function SnoozeMenu({
  onSnooze,
  disabled = false,
}: {
  onSnooze: (until: Date) => void;
  disabled?: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");

  return (
    <>
      <DropdownMenu
        trigger={
          <span className="zoiko-btn sm" title="Snooze">
            <Clock className="h-4 w-4" /> <span className="hidden lg:inline"></span>
          </span>
        }
      >
        {presets().map((p) => (
          <DropdownItem key={p.label} onClick={() => onSnooze(p.date)}>
            {p.label}
          </DropdownItem>
        ))}
        <DropdownItem onClick={() => setCustomOpen(true)}>Pick date &amp; time…</DropdownItem>
      </DropdownMenu>

      {customOpen && (
        <div className="absolute z-30 mt-1 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--sh2)]">
          <input
            type="datetime-local"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            className="h-8 rounded-md border border-[var(--border)] bg-[var(--ground)] px-2 text-xs"
          />
          <button
            disabled={!customValue || disabled}
            onClick={() => {
              onSnooze(new Date(customValue));
              setCustomOpen(false);
              setCustomValue("");
            }}
            className="zoiko-btn sm pri"
          >
            Set
          </button>
          <button onClick={() => setCustomOpen(false)} className="zoiko-btn sm">
            Cancel
          </button>
        </div>
      )}
    </>
  );
}