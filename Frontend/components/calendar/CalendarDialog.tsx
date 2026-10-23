"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CALENDAR_COLORS, type Calendar, type CalendarColor } from "@/lib/calendar-api";
import { useCreateCalendar, useUpdateCalendar } from "@/lib/calendar-hooks";
import { COLOR_NAME, swatchStyle } from "./palette";

/** Add a calendar, or rename and recolour one. */
export function CalendarDialog({ calendar, onClose }: { calendar: Calendar | null; onClose: () => void }) {
  const [name, setName] = useState(calendar?.name ?? "");
  const [color, setColor] = useState<CalendarColor>(calendar?.color ?? "green");
  const [touched, setTouched] = useState(false);
  const create = useCreateCalendar();
  const update = useUpdateCalendar();
  const busy = create.isPending || update.isPending;
  const error = (create.error ?? update.error) as Error | null;
  const problem = name.trim() ? (name.trim().length > 80 ? "Keep it to 80 characters." : null) : "Give it a name.";

  const save = () => {
    setTouched(true);
    if (problem || busy) return;
    const done = { onSuccess: onClose };
    if (calendar) update.mutate({ id: calendar.id, input: { name: name.trim(), color } }, done);
    else create.mutate({ name: name.trim(), color }, done);
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={calendar ? "Edit calendar" : "New calendar"}
      size="sm"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : calendar ? "Save" : "Add calendar"}
          </button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="cal-name" className="mb-1 block text-[12px] font-medium text-[var(--ink2)]">
            Name
          </label>
          <input
            id="cal-name"
            className="zoiko-input w-full"
            value={name}
            autoFocus
            placeholder="e.g. Customer Meetings"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={touched && Boolean(problem)}
          />
          {touched && problem && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problem}</p>}
        </div>
        <fieldset>
          <legend className="mb-2 text-[12px] font-medium text-[var(--ink2)]">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {CALENDAR_COLORS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setColor(key)}
                aria-label={COLOR_NAME[key]}
                aria-pressed={color === key}
                title={COLOR_NAME[key]}
                className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  color === key ? "ring-2 ring-[var(--ink)]" : ""
                }`}
                style={swatchStyle(key)}
              >
                {color === key && <Check className="h-4 w-4 text-white" strokeWidth={3} aria-hidden />}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-[12px] text-[var(--crit)]">{error.message}</p>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
