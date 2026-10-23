"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, CalendarX, Clock, Globe, MapPin, Phone, Video } from "lucide-react";
import { bookPublicSlot, getPublicBookingPage, type Slot } from "@/lib/calendar-api";
import { ApiError } from "@/lib/api-client";
import { addMonths, formatTime, localZone, startOfMonth } from "@/lib/calendar-dates";
import { SlotPicker } from "./SlotPicker";

const LOCATION = {
  VIDEO: { label: "Video meeting", icon: Video },
  PHONE: { label: "Phone call", icon: Phone },
  IN_PERSON: { label: "In person", icon: MapPin },
} as const;
const longWhen = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";

/**
 * The page a guest opens from a scheduling link. No sign-in. It shows only
 * free times (in the guest's own time zone), and the server checks the chosen
 * time again when it is booked.
 */
export function PublicBookingPage({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const zone = useMemo(() => localZone(), []);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [day, setDay] = useState<Date | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);

  const from = useMemo(() => new Date(Math.max(month.getTime(), Date.now())), [month]);
  const to = useMemo(() => addMonths(month, 1), [month]);
  const page = useQuery({
    queryKey: ["public-booking", slug, from.toISOString(), to.toISOString()],
    queryFn: () => getPublicBookingPage(slug, from, to),
    retry: false,
    placeholderData: (previous) => previous,
  });
  const book = useMutation({
    mutationFn: () => bookPublicSlot(slug, { name: name.trim(), email: email.trim(), startsAt: slot!.start, timeZone: zone.zone, notes: notes.trim() || undefined }),
    onError: (error) => {
      // Taken a moment ago: show what is free now.
      if (error instanceof ApiError && error.status === 409) {
        setSlot(null);
        void queryClient.invalidateQueries({ queryKey: ["public-booking", slug] });
      }
    },
  });

  const slots = useMemo(() => page.data?.slots ?? [], [page.data]);
  useEffect(() => {
    if (!day && slots[0]) {
      const d = new Date(slots[0].start);
      setDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }, [slots, day]);

  const problems = {
    name: name.trim() ? null : "Enter your name.",
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : "Enter a valid email address.",
  };

  if (page.isError && !page.data) {
    const missing = page.error instanceof ApiError && page.error.status === 404;
    return (
      <Shell>
        <div className="p-10 text-center" data-testid="booking-unavailable">
          <CalendarX className="mx-auto h-10 w-10 text-[var(--ink3)]" aria-hidden />
          <h1 className="mt-3 text-[20px] font-semibold text-[var(--ink)]">{missing ? "This booking page is not available" : "Something went wrong"}</h1>
          <p className="mt-1 text-[13px] text-[var(--ink2)]">
            {missing ? "The link may be paused or no longer in use. Ask the person who shared it for a new one." : (page.error as Error).message}
          </p>
        </div>
      </Shell>
    );
  }

  const data = page.data;
  if (!data) {
    return (
      <Shell>
        <p className="p-10 text-center text-[13px] text-[var(--ink3)]">Loading…</p>
      </Shell>
    );
  }
  const Loc = LOCATION[data.locationType].icon;

  if (book.isSuccess) {
    const result = book.data;
    const start = new Date(result.startsAt);
    const end = new Date(result.endsAt);
    return (
      <Shell>
        <div className="p-10 text-center" data-testid="booking-done">
          <CalendarCheck className="mx-auto h-12 w-12 text-[#22B07D]" aria-hidden />
          <h1 className="mt-3 text-[22px] font-semibold text-[var(--ink)]">{result.status === "CONFIRMED" ? "You're booked" : "Request sent"}</h1>
          <p className="mt-2 text-[14px] text-[var(--ink)]">
            {result.title} with {result.host.name}
          </p>
          <p className="mt-1 text-[13.5px] text-[var(--ink2)]">
            {longWhen.format(start)} · {formatTime(start)}–{formatTime(end)} ({zone.label})
          </p>
          <p className="mx-auto mt-4 max-w-md text-[12.5px] text-[var(--ink3)]">
            {result.status === "CONFIRMED"
              ? `${result.host.name} has it in their calendar. Keep a note of the time.`
              : `${result.host.name} reviews each request. The time is held for you until they confirm.`}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid gap-0 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="border-b border-[var(--border)] p-6 md:border-b-0 md:border-r">
          <p className="text-[12px] text-[var(--ink3)]">{data.workspace.name}</p>
          <p className="mt-1 text-[14px] font-semibold text-[var(--ink2)]">{data.host.name}</p>
          <h1 className="mt-2 text-[24px] font-bold leading-tight text-[var(--ink)]">{data.title}</h1>
          {data.description && <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-[var(--ink2)]">{data.description}</p>}
          <ul className="mt-4 space-y-2 text-[13px] text-[var(--ink2)]">
            <li className="flex items-center gap-2">
              <Clock className="h-4 w-4" aria-hidden /> {data.durationMinutes} minutes
            </li>
            <li className="flex items-center gap-2">
              <Loc className="h-4 w-4" aria-hidden /> {LOCATION[data.locationType].label}
            </li>
            <li className="flex items-center gap-2">
              <Globe className="h-4 w-4" aria-hidden /> Times in {zone.label}
            </li>
          </ul>
          {data.requiresApproval && <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--s2)] p-2.5 text-[12px] text-[var(--ink2)]">{data.host.name} confirms each booking.</p>}
          {slot && (
            <div className="mt-4 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-3 text-[13px] text-[var(--ink)]" data-testid="chosen-slot">
              <p className="font-semibold">{longWhen.format(new Date(slot.start))}</p>
              <p>
                {formatTime(new Date(slot.start))}–{formatTime(new Date(slot.end))}
              </p>
            </div>
          )}
        </div>

        <div className="p-6">
          {!slot ? (
            <>
              <h2 className="mb-3 text-[16px] font-semibold text-[var(--ink)]">Choose a time</h2>
              {book.error && (
                <p role="alert" className="mb-3 text-[12.5px] text-[var(--crit)]">
                  {(book.error as Error).message}
                </p>
              )}
              <SlotPicker
                month={month}
                onMonthChange={(m) => {
                  setMonth(m);
                  setDay(null);
                }}
                slots={slots}
                selectedDay={day}
                onSelectDay={setDay}
                selectedStart={null}
                onSelectSlot={(s) => {
                  book.reset();
                  setSlot(s);
                }}
                loading={page.isFetching && !page.data}
              />
            </>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (problems.name || problems.email || book.isPending) return;
                book.mutate();
              }}
              className="flex flex-col gap-3"
            >
              <button type="button" onClick={() => setSlot(null)} className="flex items-center gap-1.5 self-start text-[12.5px] text-[var(--accent-ink)] hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Choose another time
              </button>
              <h2 className="text-[16px] font-semibold text-[var(--ink)]">Your details</h2>
              <div>
                <label htmlFor="g-name" className={label}>
                  Name
                </label>
                <input id="g-name" className="zoiko-input w-full" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                {touched && problems.name && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problems.name}</p>}
              </div>
              <div>
                <label htmlFor="g-email" className={label}>
                  Email
                </label>
                <input id="g-email" type="email" className="zoiko-input w-full" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                {touched && problems.email && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problems.email}</p>}
              </div>
              <div>
                <label htmlFor="g-notes" className={label}>
                  Anything to share beforehand? (optional)
                </label>
                <textarea id="g-notes" className="zoiko-input min-h-[80px] w-full" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {book.error && (
                <p role="alert" className="text-[12.5px] text-[var(--crit)]">
                  {(book.error as Error).message}
                </p>
              )}
              <button type="submit" className="zoiko-btn pri justify-center py-2.5" disabled={book.isPending}>
                {book.isPending ? "Booking…" : data.requiresApproval ? "Request this time" : "Confirm booking"}
              </button>
              <p className="text-[11.5px] text-[var(--ink3)]">Your name and email go only to {data.host.name}, to arrange this meeting.</p>
            </form>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="zm-webmail flex min-h-screen flex-col items-center bg-[var(--ground)] px-4 py-10 text-[var(--ink)]">
      <p className="mb-6 text-[18px] font-extrabold tracking-wide text-[var(--accent-ink)]">ZOIKOMAIL</p>
      <main className="w-full max-w-[900px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)]">{children}</main>
      <p className="mt-6 text-[11.5px] text-[var(--ink3)]">Booking powered by Zoiko Mail</p>
    </div>
  );
}
