"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, MapPin, Plus, Settings2, Users, Lock } from "lucide-react";
import { listShares, type AccessibleCalendar, type CalendarEvent, type FreeBusyPerson, type ScopedEvent } from "@/lib/calendar-api";
import { useAccessibleCalendars, useFindTime, useFreeBusy, useScopedEvents, usePrefs } from "@/lib/calendar-hooks";
import { addDays, eventSpan, formatTime, formatTimeRange, isSameDay, localZone, startOfDay, viewRange } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { CalendarToolbar } from "./CalendarToolbar";
import { TimeGrid } from "./TimeGrid";
import { EventDialog, type EventDraftSeed } from "./EventDialog";
import { FindTimeDialog } from "./FindTimeDialog";
import { AccessDialog, Avatar, TeamCalendarDialog } from "./SharingDialogs";
import { CalendarChecklist } from "./access";
import { swatchStyle } from "./palette";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";

type TeamView = "week" | "availability";
const BUSY_KEY = "zm.calendar.team.busyBlocks";
const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

interface Member {
  email: string;
  name: string;
  isMe: boolean;
}

/** Team Calendar: the team calendars I belong to, my teammates' busy time, and finding time together. */
export function TeamCalendarPage() {
  const zone = useMemo(() => localZone(), []);
  const [view, setView] = useState<TeamView>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [busyBlocks, setBusyBlocks] = useState(true);
  const [selected, setSelected] = useState<ScopedEvent | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "new-event"; seed?: EventDraftSeed }
    | { kind: "edit-event"; event: CalendarEvent }
    | { kind: "team" }
    | { kind: "find"; people: string[] }
    | { kind: "access"; calendar: AccessibleCalendar }
    | null
  >(null);

  useEffect(() => {
    try {
      setBusyBlocks(window.localStorage.getItem(BUSY_KEY) !== "0");
    } catch {
      // Default stays on.
    }
  }, []);
  const toggleBusy = (on: boolean) => {
    setBusyBlocks(on);
    try {
      window.localStorage.setItem(BUSY_KEY, on ? "1" : "0");
    } catch {
      // Not remembered.
    }
  };

  const accessible = useAccessibleCalendars();
  const prefs = usePrefs();
  const teams = useMemo(() => (accessible.data ?? []).filter((c) => c.kind === "TEAM"), [accessible.data]);
  const visibleTeams = useMemo(() => teams.filter((c) => c.isVisible), [teams]);
  const teamMap = useMemo(() => new Map(teams.map((c) => [c.id, c])), [teams]);
  const writable = teams.filter((c) => c.access === "OWNER" || c.access === "EDIT" || c.access === "MANAGE");

  // Everyone in the visible teams: owner and members of each.
  const shareQueries = useQueries({
    queries: visibleTeams.map((c) => ({
      queryKey: ["calendar", "shares", c.id],
      queryFn: () => listShares(c.id),
      staleTime: 60_000,
    })),
  });
  const members = useMemo(() => {
    const byEmail = new Map<string, Member>();
    for (const q of shareQueries) {
      const data = q.data;
      if (!data) continue;
      if (data.owner) byEmail.set(data.owner.email, { email: data.owner.email, name: data.owner.name, isMe: false });
      for (const s of data.shares) byEmail.set(s.email, { email: s.email, name: s.name, isMe: s.isMe });
    }
    return Array.from(byEmail.values());
  }, [shareQueries]);
  const memberEmails = useMemo(() => members.map((m) => m.email), [members]);

  const range = useMemo(() => viewRange(view === "week" ? "workweek" : "day", anchor), [view, anchor]);
  const events = useScopedEvents("team", range.from, range.to);
  const teamEvents = (events.data ?? []).filter((e) => teamMap.get(e.calendarId)?.isVisible);

  // Teammates' busy time from their own calendars, shown without titles.
  const busy = useFreeBusy(busyBlocks || view === "availability" ? memberEmails : [], range.from, range.to, true);
  const busyEvents: CalendarEvent[] = useMemo(() => {
    if (!busyBlocks || view !== "week") return [];
    return (busy.data ?? [])
      .filter((p) => !p.isMe)
      .flatMap((p) =>
        p.busy.map((b, i) => ({
          id: `busy:${p.email}:${i}`,
          calendarId: "busy",
          title: `Busy · ${p.name}`,
          description: null,
          location: null,
          videoLink: null,
          startsAt: b.start,
          endsAt: b.end,
          allDay: false,
          timeZone: "UTC",
          visibility: "PRIVATE" as const,
          showAs: "FREE" as const,
          createdAt: "",
          updatedAt: "",
        }))
      );
  }, [busy.data, busyBlocks, view]);

  const gridCalendars = useMemo(() => {
    const map = new Map(teams.map((c) => [c.id, { ...c, createdAt: "", updatedAt: "" }]));
    map.set("busy", { id: "busy", kind: "PERSONAL", name: "Busy", color: "slate", description: null, isDefault: false, isVisible: true, createdAt: "", updatedAt: "" } as never);
    return map;
  }, [teams]);

  const openNew = (seed?: EventDraftSeed) => {
    if (writable.length === 0) {
      setDialog({ kind: "team" });
      return;
    }
    setDialog({ kind: "new-event", seed: { ...(seed ?? defaultSeed()), calendarId: seed?.calendarId ?? writable[0]!.id } });
  };

  const sidebarSection = (
    <>
      <div className="flex items-center justify-between px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Visible team calendars</h2>
        <button
          type="button"
          onClick={() => setDialog({ kind: "team" })}
          aria-label="New team calendar"
          title="New team calendar"
          className="rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {teams.length === 0 ? (
        accessible.isLoading ? (
          <Spinner size="sm" label="Loading calendars" className="px-3 py-1 text-xs" />
        ) : (
          <p className="px-3 py-1 text-xs text-[var(--ink3)]">No team calendars yet.</p>
        )
      ) : (
        <CalendarChecklist calendars={teams} testId="team-calendars" />
      )}
      <label className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] text-[var(--ink2)] hover:bg-[var(--s2)]">
        <input type="checkbox" checked={busyBlocks} onChange={(e) => toggleBusy(e.target.checked)} />
        Private busy blocks
      </label>
      {teams.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--border)] pt-2">
          {teams.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setDialog({ kind: "access", calendar: t })}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[12.5px] text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
                <span className="truncate">Members · {t.name}</span>
                <ChevronRight className="ml-auto h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <CalendarWorkspace active="team" onCreateEvent={() => openNew()} sidebarSection={sidebarSection}>
      <CalendarPageHeader
        icon={Users}
        title="Team Calendar"
        subtitle="Coordinate team schedules and find time together, respecting event privacy."
        actions={
          <>
            <button type="button" className="zoiko-btn" onClick={() => setDialog({ kind: "find", people: memberEmails.filter((e) => !members.find((m) => m.email === e)?.isMe) })}>
              <CalendarClock className="h-4 w-4" aria-hidden /> Find a time
            </button>
            <button type="button" className="zoiko-btn pri" onClick={() => openNew()}>
              <Plus className="h-4 w-4" aria-hidden /> New event
            </button>
          </>
        }
      />

      {accessible.isError && !accessible.data ? (
        <ErrorState message="Could not load your team calendars." onRetry={() => void accessible.refetch()} />
      ) : accessible.isLoading ? (
        <BrandLoader variant="panel" label="Loading team calendars" onRetry={() => void accessible.refetch()} />
      ) : teams.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center" data-testid="team-empty">
          <Users className="h-10 w-10 text-[var(--accent-ink)]" aria-hidden />
          <h2 className="mt-3 text-[18px] font-semibold text-[var(--ink)]">No team calendars yet</h2>
          <p className="mt-1 max-w-md text-[13px] text-[var(--ink2)]">
            Create one for your team — Product, Support, Marketing — and everyone in it can see and add its meetings.
          </p>
          <button type="button" className="zoiko-btn pri mt-4" onClick={() => setDialog({ kind: "team" })}>
            <Plus className="h-4 w-4" aria-hidden /> Create team calendar
          </button>
        </div>
      ) : (
        <div className="flex min-h-[640px] flex-1 gap-4">
          <section aria-label="Team calendar" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <CalendarToolbar
              anchor={anchor}
              onAnchor={setAnchor}
              stepView={view === "week" ? "workweek" : "day"}
              labelView={view === "week" ? "workweek" : "day"}
              zoneLabel={zone.label}
              views={[
                { key: "week", label: "Team week" },
                { key: "availability", label: "Availability" },
              ]}
              view={view}
              onView={setView}
            />
            {view === "week" && events.isError && !events.data ? (
              <ErrorState compact message="Could not load the team events." onRetry={() => void events.refetch()} />
            ) : view === "week" && events.data === undefined ? (
              // First load only: a new week keeps the previous one's events on screen.
              <BrandLoader variant="compact" label="Loading team events" onRetry={() => void events.refetch()} />
            ) : view === "week" ? (
              <TimeGrid
                days={range.days}
                events={[...teamEvents, ...busyEvents]}
                calendars={gridCalendars}
                selectedId={selected?.id ?? null}
                offsetLabel={zone.offsetLabel}
                onSlotClick={(start) => openNew({ start, end: new Date(start.getTime() + prefs.defaultDurationMinutes * 60_000) })}
                workHours={{ start: prefs.workStart, end: prefs.workEnd, days: prefs.workDays }}
                onEventClick={(event) => {
                  if (event.id.startsWith("busy:")) return;
                  setSelected(event as ScopedEvent);
                }}
              />
            ) : (
              <AvailabilityGrid day={anchor} people={busy.data ?? []} loading={busy.isLoading} onRetry={() => void busy.refetch()} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--ink3)]">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--ink2)]" aria-hidden />
                Team calendars · 09:00–17:00 workday · private events show only as Busy
              </span>
              <span data-testid="team-count">
                {teamEvents.length} team {teamEvents.length === 1 ? "event" : "events"}
              </span>
            </div>
          </section>

          <aside className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex" aria-label="Team summary">
            <TeamAvailability members={members} />
            <SelectedMeeting
              event={selected}
              team={selected ? teamMap.get(selected.calendarId) ?? null : null}
              onEdit={(event) => setDialog({ kind: "edit-event", event })}
            />
            <FindTogether
              members={members.filter((m) => !m.isMe)}
              onOpen={(people) => setDialog({ kind: "find", people })}
              onBook={(start, end, people) => openNew({ start, end, attendees: people })}
            />
          </aside>
        </div>
      )}

      {dialog?.kind === "new-event" && <EventDialog calendars={writable} seed={dialog.seed} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit-event" && <EventDialog calendars={writable} event={dialog.event} onClose={() => setDialog(null)} />}
      {dialog?.kind === "team" && <TeamCalendarDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "access" && <AccessDialog calendar={dialog.calendar} onClose={() => setDialog(null)} />}
      {dialog?.kind === "find" && (
        <FindTimeDialog
          initialPeople={dialog.people}
          onClose={() => setDialog(null)}
          onPick={({ start, end, people }) => openNew({ start, end, attendees: people })}
        />
      )}
    </CalendarWorkspace>
  );
}

function defaultSeed(): EventDraftSeed {
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  return { start, end: new Date(start.getTime() + 60 * 60_000) };
}

/** Busy right now, busy later, or free — for each teammate, today. */
function TeamAvailability({ members }: { members: Member[] }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const tomorrow = useMemo(() => addDays(today, 1), [today]);
  const freeBusy = useFreeBusy(members.filter((m) => !m.isMe).map((m) => m.email), today, tomorrow);
  const now = new Date();
  const people = (freeBusy.data ?? []).filter((p) => !p.isMe);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="team-availability">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">Team availability · Today</h3>
        <span className="text-[12px] text-[var(--accent-ink)]">{people.length} members</span>
      </div>
      {people.length === 0 ? (
        freeBusy.isLoading ? (
          <BrandLoader variant="compact" label="Checking availability" onRetry={() => void freeBusy.refetch()} />
        ) : (
          <p className="text-[12.5px] text-[var(--ink3)]">Nobody else in your visible teams yet.</p>
        )
      ) : (
        <ul className="space-y-2.5">
          {people.map((p) => {
            const current = p.busy.find((b) => new Date(b.start) <= now && new Date(b.end) > now);
            const next = p.busy.find((b) => new Date(b.start) > now);
            const status = current
              ? { label: `In meeting · until ${formatTime(new Date(current.end))}`, hex: "#E5484D" }
              : next
                ? { label: `Available · until ${formatTime(new Date(next.start))}`, hex: "#22B07D" }
                : { label: "Available", hex: "#22B07D" };
            return (
              <li key={p.email} className="flex items-center gap-2.5">
                <Avatar name={p.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ink)]">{p.name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--ink3)]">{p.email}</span>
                </span>
                <span
                  className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold"
                  style={{ color: status.hex, borderColor: `color-mix(in srgb, ${status.hex} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${status.hex} 14%, transparent)` }}
                >
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[var(--ink3)]">From their calendars. Only busy times are shared, never what they are.</p>
    </div>
  );
}

function SelectedMeeting({
  event,
  team,
  onEdit,
}: {
  event: ScopedEvent | null;
  team: AccessibleCalendar | null;
  onEdit: (event: CalendarEvent) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="selected-meeting">
      <h3 className="mb-3 text-[15px] font-semibold text-[var(--ink)]">Selected team meeting</h3>
      {!event ? (
        <p className="text-[12.5px] text-[var(--ink3)]">Choose a meeting on the calendar to see it here.</p>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
          {team && (
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: swatchStyle(team.color).backgroundColor as string }}>
              {team.name}
            </p>
          )}
          <p className="mt-1 flex items-center gap-1.5 text-[16px] font-semibold text-[var(--ink)]">
            {event.redacted && <Lock className="h-4 w-4" aria-label="Private" />}
            {event.title}
          </p>
          <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {dayHeading.format(eventSpan(event).start)} · {event.allDay ? "All day" : formatTimeRange(eventSpan(event).start, eventSpan(event).end)}
          </p>
          {event.location && (
            <p className="mt-1 flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> {event.location}
            </p>
          )}
          {!event.redacted && (
            <p className="mt-1 flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
              <Users className="h-3.5 w-3.5" aria-hidden /> {(event.attendeeCount ?? 0) + 1} participants · organised by {event.organizerName}
            </p>
          )}
        </div>
      )}
      {event?.canEdit && (
        <button type="button" className="zoiko-btn mt-3 w-full justify-center" onClick={() => onEdit(event)}>
          View or edit event <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** The first time this week when me and up to four teammates are all free, for half an hour. */
function FindTogether({
  members,
  onOpen,
  onBook,
}: {
  members: Member[];
  onOpen: (people: string[]) => void;
  onBook: (start: Date, end: Date, people: string[]) => void;
}) {
  const find = useFindTime();
  const people = useMemo(() => members.slice(0, 4).map((m) => m.email), [members]);
  const key = people.join(",");
  useEffect(() => {
    if (!key) return;
    find.mutate({
      emails: key.split(","),
      from: new Date().toISOString(),
      to: addDays(startOfDay(new Date()), 8).toISOString(),
      durationMinutes: 30,
      timeZone: localZone().zone,
      limit: 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const slot = find.data?.slots[0];
  const names = members.slice(0, 4).map((m) => m.name.split(" ")[0]);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="find-together">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">Find a time together</h3>
      </div>
      {people.length === 0 ? (
        <p className="text-[12.5px] text-[var(--ink3)]">Add members to a team calendar to find time together.</p>
      ) : (
        <>
          <p className="text-[12.5px] text-[var(--ink2)]">For {names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]}</p>
          {find.isPending ? (
            <Spinner size="sm" label="Looking…" className="mt-2 text-[12.5px]" />
          ) : slot ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-[13px]">
              <span className="text-[var(--ink)]">
                {dayHeading.format(new Date(slot.start))} · {formatTime(new Date(slot.start))}–{formatTime(new Date(slot.end))}
              </span>
              <span className="text-[11.5px] font-semibold text-[#22B07D]">Everyone free</span>
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-[var(--ink3)]">No shared free half hour this week.</p>
          )}
          <div className="mt-3 flex gap-2">
            {slot && (
              <button type="button" className="zoiko-btn pri flex-1 justify-center" onClick={() => onBook(new Date(slot.start), new Date(slot.end), people)}>
                Book it
              </button>
            )}
            <button type="button" className="zoiko-btn flex-1 justify-center" onClick={() => onOpen(people)}>
              More times
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const HOURS = Array.from({ length: 10 }, (_, i) => 8 + i); // 08:00–18:00

/** One row per person, busy time drawn across the working day. */
function AvailabilityGrid({ day, people, loading, onRetry }: { day: Date; people: FreeBusyPerson[]; loading: boolean; onRetry: () => void }) {
  const start = new Date(day);
  start.setHours(8, 0, 0, 0);
  const spanMs = 10 * 3_600_000;
  const now = new Date();
  const nowPct = isSameDay(day, now) ? ((now.getTime() - start.getTime()) / spanMs) * 100 : -1;
  const sorted = [...people].sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="availability-grid">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[180px_1fr] items-end pb-2 text-[11px] text-[var(--ink3)]">
          <span />
          <div className="relative h-4">
            {HOURS.map((h, i) => (
              <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(i / 10) * 100}%` }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
        {loading && sorted.length === 0 ? (
          <BrandLoader variant="compact" label="Loading availability" onRetry={onRetry} />
        ) : sorted.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ink3)]">Nobody to show yet.</p>
        ) : (
          sorted.map((p) => (
            <div key={p.email} className="grid grid-cols-[180px_1fr] items-center border-t border-[var(--border)] py-2">
              <span className="flex min-w-0 items-center gap-2 pr-3">
                <Avatar name={p.name} size="sm" />
                <span className="truncate text-[13px] text-[var(--ink)]">{p.isMe ? `${p.name} (you)` : p.name}</span>
              </span>
              <div className="relative h-7 rounded-md bg-[color-mix(in_srgb,#22B07D_12%,transparent)]">
                {p.busy.map((b, i) => {
                  const left = Math.max(0, ((new Date(b.start).getTime() - start.getTime()) / spanMs) * 100);
                  const right = Math.min(100, ((new Date(b.end).getTime() - start.getTime()) / spanMs) * 100);
                  if (right <= 0 || left >= 100) return null;
                  return (
                    <span
                      key={i}
                      className="absolute inset-y-0 rounded-md border"
                      style={{ left: `${left}%`, width: `${right - left}%`, backgroundColor: "color-mix(in srgb, #7C8DA6 35%, var(--surface))", borderColor: "color-mix(in srgb, #7C8DA6 60%, transparent)" }}
                      title={`Busy ${formatTime(new Date(b.start))}–${formatTime(new Date(b.end))}`}
                    />
                  );
                })}
                {nowPct >= 0 && nowPct <= 100 && <span className="absolute inset-y-0 w-[2px] bg-[#E5484D]" style={{ left: `${nowPct}%` }} aria-hidden />}
              </div>
            </div>
          ))
        )}
        <p className="mt-3 flex items-center gap-3 text-[11.5px] text-[var(--ink3)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded bg-[color-mix(in_srgb,#22B07D_30%,transparent)]" /> Free
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded bg-[color-mix(in_srgb,#7C8DA6_45%,transparent)]" /> Busy
          </span>
        </p>
      </div>
    </div>
  );
}
