"use client";

import { useState } from "react";
import { Check, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { CalendarResource, ResourceInput } from "@/lib/calendar-api";
import { useBookResource, useCreateResource, useUpdateResource } from "@/lib/calendar-hooks";
import { fromInputs, localZone, toDateInput, toTimeInput } from "@/lib/calendar-dates";
import { AttendeeInput } from "./AttendeeInput";

const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";

/** Confirm a room booking: what the meeting is, when exactly, and who comes. */
export function BookingDialog({
  resource: initialResource,
  resources,
  start,
  end,
  attendeeCount,
  onBooked,
  onClose,
}: {
  resource: CalendarResource;
  /** When given, the form offers a choice of resource (opened from "New booking"). */
  resources?: CalendarResource[];
  start: Date;
  end: Date;
  attendeeCount: number;
  onBooked: (status: "CONFIRMED" | "PENDING") => void;
  onClose: () => void;
}) {
  const [resourceId, setResourceId] = useState(initialResource.id);
  const resource = resources?.find((r) => r.id === resourceId) ?? initialResource;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toDateInput(start));
  const [from, setFrom] = useState(toTimeInput(start));
  const [to, setTo] = useState(toTimeInput(end));
  const [people, setPeople] = useState<string[]>([]);
  const [count, setCount] = useState(attendeeCount);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const book = useBookResource();

  const startsAt = fromInputs(date, from);
  const endsAt = fromInputs(date, to);
  const problems = {
    title: title.trim() ? null : "Give the meeting a title.",
    time: endsAt <= startsAt ? "The booking must end after it starts." : null,
    count: resource.capacity && count > resource.capacity ? `${resource.name} seats ${resource.capacity}.` : null,
  };
  const valid = Object.values(problems).every((p) => !p);

  const save = () => {
    setTouched(true);
    if (!valid || book.isPending) return;
    book.mutate(
      {
        resourceId: resource.id,
        input: {
          title: title.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          timeZone: localZone().zone,
          attendees: people.length ? people : undefined,
          attendeeCount: count || undefined,
          note: note.trim() || undefined,
        },
      },
      { onSuccess: (result) => onBooked(result.status === "PENDING" ? "PENDING" : "CONFIRMED") }
    );
  };

  return (
    <Modal
      open
      onClose={book.isPending ? () => undefined : onClose}
      title={`Book ${resource.name}`}
      size="lg"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={book.isPending}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={book.isPending}>
            {book.isPending ? "Booking…" : resource.requiresApproval ? "Request booking" : "Confirm booking"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {resources && resources.length > 1 && (
          <div>
            <label htmlFor="bk-resource" className={label}>
              Room or resource
            </label>
            <select id="bk-resource" className="zoiko-input w-full" value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.capacity ? ` · ${r.capacity} seats` : ""}
                  {r.location ? ` · ${r.location}` : ""}
                  {r.requiresApproval ? " · needs approval" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="bk-title" className={label}>
            Meeting title
          </label>
          <input id="bk-title" className="zoiko-input w-full" autoFocus placeholder="e.g. Client demo" value={title} onChange={(e) => setTitle(e.target.value)} />
          {touched && problems.title && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problems.title}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="bk-date" className={label}>
              Day
            </label>
            <input id="bk-date" type="date" className="zoiko-input w-full" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="bk-from" className={label}>
              From
            </label>
            <input id="bk-from" type="time" step={900} className="zoiko-input w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label htmlFor="bk-to" className={label}>
              To
            </label>
            <input id="bk-to" type="time" step={900} className="zoiko-input w-full" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {touched && problems.time && <p className="text-[11.5px] text-[var(--crit)]">{problems.time}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div>
            <label htmlFor="bk-people" className={label}>
              Invite people (optional)
            </label>
            <AttendeeInput inputId="bk-people" value={people} onChange={(next) => {
              setPeople(next);
              setCount((c) => Math.max(c, next.length + 1));
            }} />
          </div>
          <div>
            <label htmlFor="bk-count" className={label}>
              <Users className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Attendees
            </label>
            <input
              id="bk-count"
              type="number"
              min={1}
              max={resource.capacity ?? 5000}
              className="zoiko-input w-full"
              value={count}
              onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>
        {touched && problems.count && <p className="text-[11.5px] text-[var(--crit)]">{problems.count}</p>}
        <div>
          <label htmlFor="bk-note" className={label}>
            Agenda or note (optional)
          </label>
          <textarea id="bk-note" className="zoiko-input min-h-[64px] w-full" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <p className="text-[12px] text-[var(--ink3)]">
          The meeting goes in your calendar with {resource.name} as its place.{" "}
          {resource.requiresApproval ? "This resource needs approval: the slot is held until an Owner or Admin decides." : "It is confirmed straight away."}
        </p>
        {book.error && (
          <p role="alert" className="text-[12.5px] text-[var(--crit)]">
            {(book.error as Error).message}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Add a room or equipment, or edit one. Owners and Admins only (the server checks). */
export function ResourceEditDialog({ resource, onClose }: { resource: CalendarResource | null; onClose: () => void }) {
  const [kind, setKind] = useState<ResourceInput["kind"]>(resource?.kind ?? "ROOM");
  const [name, setName] = useState(resource?.name ?? "");
  const [capacity, setCapacity] = useState(resource?.capacity ? String(resource.capacity) : "");
  const [location, setLocation] = useState(resource?.location ?? "");
  const [floor, setFloor] = useState(resource?.floor ?? "");
  const [features, setFeatures] = useState((resource?.features ?? []).join(", "));
  const [description, setDescription] = useState(resource?.description ?? "");
  const [requiresApproval, setRequiresApproval] = useState(resource?.requiresApproval ?? false);
  const [touched, setTouched] = useState(false);
  const create = useCreateResource();
  const update = useUpdateResource();
  const busy = create.isPending || update.isPending;
  const error = (create.error ?? update.error) as Error | null;
  const problem = name.trim() ? null : "Give it a name.";

  const save = () => {
    setTouched(true);
    if (problem || busy) return;
    const input: ResourceInput = {
      kind,
      name: name.trim(),
      capacity: capacity ? Number(capacity) : null,
      location: location.trim() || null,
      floor: floor.trim() || null,
      features: features.split(",").map((f) => f.trim()).filter(Boolean),
      description: description.trim() || null,
      requiresApproval,
    };
    if (resource) update.mutate({ id: resource.id, input }, { onSuccess: onClose });
    else create.mutate(input, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={resource ? `Edit ${resource.name}` : "Add a room or resource"}
      size="lg"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : resource ? "Save" : "Add"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rs-kind" className={label}>
            Type
          </label>
          <select id="rs-kind" className="zoiko-input w-full" value={kind} onChange={(e) => setKind(e.target.value as ResourceInput["kind"])}>
            <option value="ROOM">Meeting room</option>
            <option value="EQUIPMENT">Equipment</option>
          </select>
        </div>
        <div>
          <label htmlFor="rs-name" className={label}>
            Name
          </label>
          <input id="rs-name" className="zoiko-input w-full" placeholder="e.g. Horizon Room" value={name} onChange={(e) => setName(e.target.value)} />
          {touched && problem && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problem}</p>}
        </div>
        <div>
          <label htmlFor="rs-capacity" className={label}>
            Seats
          </label>
          <input id="rs-capacity" type="number" min={1} className="zoiko-input w-full" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rs-location" className={label}>
            Location
          </label>
          <input id="rs-location" className="zoiko-input w-full" placeholder="e.g. London HQ" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rs-floor" className={label}>
            Floor
          </label>
          <input id="rs-floor" className="zoiko-input w-full" placeholder="e.g. Floor 3" value={floor} onChange={(e) => setFloor(e.target.value)} />
        </div>
        <div>
          <label htmlFor="rs-features" className={label}>
            Features (comma separated)
          </label>
          <input id="rs-features" className="zoiko-input w-full" placeholder="Video conferencing, Large display" value={features} onChange={(e) => setFeatures(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="rs-description" className={label}>
            Reservation policy or notes
          </label>
          <textarea id="rs-description" className="zoiko-input min-h-[60px] w-full" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[13px] text-[var(--ink)] sm:col-span-2">
          <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
          Bookings need approval from an Owner or Admin
        </label>
        {error && (
          <p role="alert" className="text-[12px] text-[var(--crit)] sm:col-span-2">
            {error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

export function FeatureList({ features }: { features: string[] }) {
  if (features.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
      {features.map((f) => (
        <li key={f} className="flex items-center gap-1.5 text-[12px] text-[var(--ink2)]">
          <Check className="h-3.5 w-3.5 text-[#22B07D]" aria-hidden /> {f}
        </li>
      ))}
    </ul>
  );
}
