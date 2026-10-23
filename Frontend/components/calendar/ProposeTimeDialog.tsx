"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { EventDetail } from "@/lib/calendar-api";
import { useProposeTime } from "@/lib/calendar-hooks";
import { fromInputs, localZone, toDateInput, toTimeInput } from "@/lib/calendar-dates";

const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";

/** Suggest another time for an invitation. Starts from the current time, same length. */
export function ProposeTimeDialog({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const [date, setDate] = useState(toDateInput(start));
  const [from, setFrom] = useState(toTimeInput(start));
  const [to, setTo] = useState(toTimeInput(end));
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const propose = useProposeTime();

  const startsAt = fromInputs(date, from);
  const endsAt = fromInputs(date, to);
  const problem = !date || !from || !to ? "Choose a day and a time." : endsAt <= startsAt ? "The new time must end after it starts." : null;

  const send = () => {
    setTouched(true);
    if (problem || propose.isPending) return;
    propose.mutate(
      { id: event.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), comment: comment.trim() || undefined },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal
      open
      onClose={propose.isPending ? () => undefined : onClose}
      title="Propose a new time"
      size="sm"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={propose.isPending}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={send} disabled={propose.isPending}>
            {propose.isPending ? "Sending…" : "Send proposal"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-[var(--ink2)]">
          {event.organizer.name ?? event.organizer.email} sees your suggestion and decides. Until then your answer shows as Tentative.
        </p>
        <div>
          <label htmlFor="pt-date" className={label}>
            Day
          </label>
          <input id="pt-date" type="date" className="zoiko-input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="pt-from" className={label}>
              From
            </label>
            <input id="pt-from" type="time" step={300} className="zoiko-input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex-1">
            <label htmlFor="pt-to" className={label}>
              To
            </label>
            <input id="pt-to" type="time" step={300} className="zoiko-input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-[11.5px] text-[var(--ink3)]">Times are in {localZone().label}.</p>
        <div>
          <label htmlFor="pt-comment" className={label}>
            Note (optional)
          </label>
          <textarea
            id="pt-comment"
            className="zoiko-input min-h-[64px] w-full"
            value={comment}
            maxLength={500}
            placeholder="e.g. I have a clash at 10:00"
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        {touched && problem && <p className="text-[11.5px] text-[var(--crit)]">{problem}</p>}
        {propose.error && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {(propose.error as Error).message}
          </p>
        )}
      </div>
    </Modal>
  );
}
