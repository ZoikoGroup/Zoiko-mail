"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useFindTime } from "@/lib/calendar-hooks";
import { addDays, formatTime, localZone, startOfDay } from "@/lib/calendar-dates";
import { AttendeeInput } from "./AttendeeInput";

const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/**
 * Find a time when everyone is free: in working hours (09:00–17:00 in my time
 * zone), on weekdays, over the next days. Picking a slot books it.
 */
export function FindTimeDialog({
  initialPeople,
  onPick,
  onClose,
}: {
  initialPeople: string[];
  onPick: (slot: { start: Date; end: Date; people: string[] }) => void;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<string[]>(initialPeople);
  const [duration, setDuration] = useState(30);
  const [days, setDays] = useState(7);
  const find = useFindTime();

  const search = () => {
    if (people.length === 0) return;
    const from = new Date();
    const to = addDays(startOfDay(new Date()), days + 1);
    find.mutate({
      emails: people,
      from: from.toISOString(),
      to: to.toISOString(),
      durationMinutes: duration,
      timeZone: localZone().zone,
      dayStartHour: 9,
      dayEndHour: 17,
      limit: 8,
    });
  };

  // Search straight away when opened with people already chosen.
  useEffect(() => {
    if (initialPeople.length) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open onClose={onClose} title="Find a time" size="lg">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="ft-people" className={label}>
            Who
          </label>
          <AttendeeInput inputId="ft-people" value={people} onChange={setPeople} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="ft-duration" className={label}>
              How long
            </label>
            <select id="ft-duration" className="zoiko-input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ft-days" className={label}>
              Within
            </label>
            <select id="ft-days" className="zoiko-input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={3}>the next 3 days</option>
              <option value={7}>the next week</option>
              <option value={14}>the next 2 weeks</option>
            </select>
          </div>
          <button type="button" className="zoiko-btn pri" onClick={search} disabled={people.length === 0 || find.isPending}>
            <Search className="h-4 w-4" aria-hidden /> {find.isPending ? "Searching…" : "Find times"}
          </button>
        </div>
        <p className="text-[11.5px] text-[var(--ink3)]">Weekdays, 09:00–17:00 in {localZone().label}. Includes you.</p>

        {find.error && (
          <p role="alert" className="text-[12.5px] text-[var(--crit)]">
            {(find.error as Error).message}
          </p>
        )}
        {find.data && (
          <div data-testid="find-time-results">
            {find.data.slots.length === 0 ? (
              <p className="text-[13px] text-[var(--ink2)]">Nobody is free together then. Try a shorter meeting or a longer window.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {find.data.slots.map((slot) => {
                  const start = new Date(slot.start);
                  const end = new Date(slot.end);
                  return (
                    <li key={slot.start}>
                      <button
                        type="button"
                        onClick={() => onPick({ start, end, people })}
                        className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] px-3 py-2.5 text-left hover:border-[var(--accent)]"
                      >
                        <CalendarClock className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden />
                        <span className="flex-1 text-[13px] text-[var(--ink)]">
                          {dayFormat.format(start)} · {formatTime(start)}–{formatTime(end)}
                        </span>
                        <span className="text-[11.5px] font-medium text-[#22B07D]">Everyone free</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {find.data.people.length > 0 && (
              <p className="mt-2 text-[11.5px] text-[var(--ink3)]">Checked: {find.data.people.map((p) => (p.isMe ? "you" : p.name)).join(", ")}</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
