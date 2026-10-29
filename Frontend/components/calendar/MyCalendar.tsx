"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, MapPin, Video, Inbox, Users } from "lucide-react";
import type { CalendarEvent } from "@/lib/calendar-api";
import { useCalendarEvents, useCalendars, useInvitations, usePrefs, useRespond } from "@/lib/calendar-hooks";
import {
  VIEW_LABEL,
  addDays,
  eventOnDay,
  eventSpan,
  formatDate,
  formatTimeRange,
  localZone,
  rangeLabel,
  startOfDay,
  startOfMonth,
  stepAnchor,
  viewRange,
  type CalendarView,
} from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { TimeGrid } from "./TimeGrid";
import { MonthGrid } from "./MonthGrid";
import { MiniMonth } from "./MiniMonth";
import { EventDialog, type EventDraftSeed } from "./EventDialog";
import { swatchStyle } from "./palette";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Spinner } from "@/components/ui/Spinner";

const VIEWS: CalendarView[] = ["day", "week", "month", "agenda"];
const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

/** ISO week number (weeks start Monday; week 1 holds the year's first Thursday). */
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

type Dialog = { mode: "new"; seed?: EventDraftSeed } | { mode: "edit"; event: CalendarEvent } | null;

/** My Calendar: the member's own calendars, in day, week, month or agenda view. */
export function MyCalendar() {
  const prefs = usePrefs();
  // Opens in the view chosen in Calendar Settings.
  const [view, setView] = useState<CalendarView>(() => prefs.defaultView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const zone = useMemo(() => localZone(), []);
  const router = useRouter();
  const params = useSearchParams();

  // ?date=yyyy-mm-dd opens that day (e.g. "Check availability" on an invitation).
  const dateParam = params.get("date");
  useEffect(() => {
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return;
    const [y, m, d] = dateParam.split("-").map(Number);
    const day = new Date(y!, m! - 1, d!);
    setAnchor(day);
    setSelectedDay(day);
    setMiniMonth(startOfMonth(day));
  }, [dateParam]);
  const changeView = (next: CalendarView) => setView(next);
  const minutes = prefs.defaultDurationMinutes * 60_000;
  const workHours = useMemo(() => ({ start: prefs.workStart, end: prefs.workEnd, days: prefs.workDays }), [prefs.workStart, prefs.workEnd, prefs.workDays]);

  const { data: calendars = [], isLoading: calendarsLoading } = useCalendars();
  const calendarMap = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const visibleIds = useMemo(() => new Set(calendars.filter((c) => c.isVisible).map((c) => c.id)), [calendars]);
  // Invitations are in someone else's calendar, so they are not behind my checkboxes.
  // Unanswered invitations show only if Calendar Settings says so.
  const onlyVisible = (list: CalendarEvent[] = []) =>
    list.filter((e) =>
      e.source === "INVITED" ? prefs.showPendingInvitations || e.myResponse !== "NEEDS_ACTION" : visibleIds.has(e.calendarId)
    );
  const awaiting = useInvitations("awaiting", "");
  const respond = useRespond();

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const eventsQuery = useCalendarEvents(range.from, range.to);
  const events = onlyVisible(eventsQuery.data);

  const miniRange = useMemo(() => viewRange("month", miniMonth), [miniMonth]);
  const miniEvents = onlyVisible(useCalendarEvents(miniRange.from, miniRange.to).data);

  const agendaFrom = selectedDay;
  const agendaTo = useMemo(() => addDays(selectedDay, 1), [selectedDay]);
  const agenda = onlyVisible(useCalendarEvents(agendaFrom, agendaTo).data).sort(
    (a, b) => Number(b.allDay) - Number(a.allDay) || eventSpan(a).start.getTime() - eventSpan(b).start.getTime()
  );

  const goTo = (day: Date) => {
    const d = startOfDay(day);
    setAnchor(d);
    setSelectedDay(d);
    setMiniMonth(startOfMonth(d));
  };
  const openNew = (seed?: EventDraftSeed) => {
    if (calendars.length === 0) return;
    setDialog({ mode: "new", seed });
  };
  // ?invite=<address> (Schedule, from Contacts) opens a new meeting with that
  // person invited, at the next half hour, once there is a calendar to put it in.
  const inviteParam = params.get("invite");
  useEffect(() => {
    if (!inviteParam || calendars.length === 0) return;
    const start = new Date();
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
    setDialog({ mode: "new", seed: { start, end: new Date(start.getTime() + minutes), attendees: [inviteParam] } });
    router.replace("/mail/calendar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteParam, calendars.length]);
  const openEvent = (event: CalendarEvent) => {
    // Someone else's meeting opens as the invitation, where I answer it.
    if (event.source === "INVITED") {
      router.push(`/mail/calendar/invitations?event=${event.id}`);
      return;
    }
    setSelectedId(event.id);
    setDialog({ mode: "edit", event });
  };

  return (
    <CalendarWorkspace active="my" onCreateEvent={() => openNew()}>
      <CalendarPageHeader
        icon={CalendarDays}
        title="My Calendar"
        subtitle="Plan meetings, protect focus time and coordinate with your team."
        actions={
          <button
            type="button"
            className="zoiko-btn pri"
            onClick={() => openNew()}
            disabled={calendarsLoading || calendars.length === 0}
          >
            <Plus className="h-4 w-4" aria-hidden /> New event
          </button>
        }
      />

      <div className="flex min-h-[640px] flex-1 gap-4">
        {/* The calendar */}
        <section
          aria-label="Calendar"
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <button type="button" className="zoiko-btn" onClick={() => goTo(new Date())}>
              Today
            </button>
            <div className="flex gap-1">
              <button
                type="button"
                className="zoiko-btn px-2"
                aria-label={`Previous ${VIEW_LABEL[view].toLowerCase()}`}
                onClick={() => setAnchor((a) => stepAnchor(view, a, -1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="zoiko-btn px-2"
                aria-label={`Next ${VIEW_LABEL[view].toLowerCase()}`}
                onClick={() => setAnchor((a) => stepAnchor(view, a, 1))}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <h2 className="mx-1 text-[18px] font-semibold text-[var(--ink)]" aria-live="polite" data-testid="range-label">
              {rangeLabel(view, anchor)}
            </h2>
            <span className="hidden items-center gap-1.5 text-[12.5px] text-[var(--ink3)] md:flex">
              <Clock className="h-3.5 w-3.5" aria-hidden /> {zone.label}
            </span>
            <div className="ml-auto inline-flex rounded-lg border border-[var(--border)] bg-[var(--s2)] p-0.5" role="tablist" aria-label="View">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => changeView(v)}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] transition ${
                    view === v ? "bg-[var(--accent)] font-semibold text-white" : "text-[var(--ink2)] hover:text-[var(--ink)]"
                  }`}
                >
                  {VIEW_LABEL[v]}
                </button>
              ))}
            </div>
          </div>

          {eventsQuery.isError ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-[var(--crit)]" role="alert">
              Could not load your events. {(eventsQuery.error as Error).message}
            </div>
          ) : eventsQuery.data === undefined ? (
            // First load only: a new range keeps the previous one's events on screen.
            <BrandLoader variant="compact" label="Loading your events" onRetry={() => void eventsQuery.refetch()} />
          ) : view === "agenda" ? (
            <AgendaList
              days={range.days}
              events={events}
              calendars={calendarMap}
              showDescriptions={prefs.showDescriptions}
              onEventClick={openEvent}
              onAdd={(day) => {
                const start = new Date(day);
                const [h, m] = prefs.workStart.split(":").map(Number);
                start.setHours(h ?? 9, m ?? 0, 0, 0);
                openNew({ start, end: new Date(start.getTime() + minutes) });
              }}
            />
          ) : view === "month" ? (
            <MonthGrid
              days={range.days}
              month={anchor.getMonth()}
              events={events}
              calendars={calendarMap}
              selectedId={selectedId}
              onDayClick={(day) => {
                goTo(day);
                changeView("day");
              }}
              onEventClick={openEvent}
            />
          ) : (
            <TimeGrid
              days={range.days}
              events={events}
              calendars={calendarMap}
              selectedId={selectedId}
              offsetLabel={zone.offsetLabel}
              onSlotClick={(start) => openNew({ start, end: new Date(start.getTime() + minutes) })}
              onEventClick={openEvent}
              workHours={workHours}
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--ink3)]">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--ink2)]" aria-hidden />
              {zone.zone} time
              {eventsQuery.isFetching && eventsQuery.data !== undefined && <Spinner size="xs" label="Updating…" />}
            </span>
            <span data-testid="range-count">
              {view === "month" ? rangeLabel(view, anchor) : `Week ${isoWeek(range.days[0]!)}`} · {events.length}{" "}
              {events.length === 1 ? "event" : "events"}
            </span>
          </div>
        </section>

        {/* Right panel */}
        <aside aria-label="Day summary" className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <MiniMonth
              month={miniMonth}
              selected={selectedDay}
              events={miniEvents}
              onMonthChange={setMiniMonth}
              onSelect={goTo}
            />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="day-agenda">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold text-[var(--ink)]">{dayHeading.format(selectedDay)}</h3>
              <span className="text-[12px] text-[var(--accent-ink)]">
                {agenda.length} {agenda.length === 1 ? "event" : "events"}
              </span>
            </div>
            {agenda.length === 0 ? (
              <div className="flex flex-col items-start gap-2 text-[12.5px] text-[var(--ink3)]">
                Nothing scheduled.
                <button
                  type="button"
                  className="text-[12.5px] font-medium text-[var(--accent-ink)] hover:underline"
                  onClick={() => {
                    const start = new Date(selectedDay);
                    const [h, m] = prefs.workStart.split(":").map(Number);
                    start.setHours(h ?? 9, m ?? 0, 0, 0);
                    openNew({ start, end: new Date(start.getTime() + minutes) });
                  }}
                >
                  + Add an event
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {agenda.map((event) => {
                  const calendar = calendarMap.get(event.calendarId);
                  const span = eventSpan(event);
                  return (
                    <li key={event.id}>
                      <button
                        type="button"
                        onClick={() => openEvent(event)}
                        className="flex w-full gap-3 rounded-lg p-1 text-left hover:bg-[var(--s2)]"
                      >
                        <span className="w-1 shrink-0 self-stretch rounded-full" style={swatchStyle(calendar?.color)} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{event.title}</span>
                            <span className="shrink-0 tabular-nums text-[12px] text-[var(--ink2)]">
                              {event.allDay ? "All day" : formatTimeRange(span.start, span.end).split(" – ")[0]}
                            </span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-[var(--ink3)]">
                            {event.videoLink ? (
                              <>
                                <Video className="h-3 w-3" aria-hidden /> Video meeting
                              </>
                            ) : event.location ? (
                              <>
                                <MapPin className="h-3 w-3" aria-hidden /> {event.location}
                              </>
                            ) : (
                              calendar?.name
                            )}
                          </span>
                          {prefs.showDescriptions && event.description && (
                            <span className="mt-0.5 line-clamp-2 block text-[12px] text-[var(--ink2)]" data-testid="event-description">
                              {event.description}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="invitations-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[var(--ink)]">Invitations</h3>
              <Link href="/mail/calendar/invitations" className="text-[12px] text-[var(--accent-ink)] hover:underline">
                {(awaiting.data?.length ?? 0) > 0 ? `${awaiting.data!.length} awaiting response` : "View all"}
              </Link>
            </div>
            {(awaiting.data ?? []).length === 0 ? (
              <p className="flex items-center gap-2 text-[12.5px] text-[var(--ink3)]">
                <Inbox className="h-4 w-4" aria-hidden /> No invitations waiting for your response.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {awaiting.data!.slice(0, 2).map((item) => {
                  const span = eventSpan(item);
                  return (
                    <li key={item.eventId} className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
                      <Link
                        href={`/mail/calendar/invitations?event=${item.eventId}`}
                        className="block truncate text-[13.5px] font-semibold text-[var(--ink)] hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                        {dayHeading.format(span.start)} · {item.allDay ? "All day" : formatTimeRange(span.start, span.end)}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-[var(--ink3)]">
                        <Users className="h-3 w-3" aria-hidden /> {item.organizer.name ?? item.organizer.email}
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        {(
                          [
                            ["ACCEPTED", "Accept"],
                            ["TENTATIVE", "Maybe"],
                            ["DECLINED", "Decline"],
                          ] as const
                        ).map(([response, label], i) => (
                          <button
                            key={response}
                            type="button"
                            disabled={respond.isPending}
                            onClick={() => respond.mutate({ id: item.eventId, response })}
                            className={`zoiko-btn sm flex-1 justify-center ${i === 0 ? "pri" : ""}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {dialog && (
        <EventDialog
          calendars={calendars}
          event={dialog.mode === "edit" ? dialog.event : null}
          seed={dialog.mode === "new" ? dialog.seed : undefined}
          onClose={() => {
            setDialog(null);
            setSelectedId(null);
          }}
        />
      )}
    </CalendarWorkspace>
  );
}


/** The agenda view: the week's events as a list, day by day. */
function AgendaList({
  days,
  events,
  calendars,
  showDescriptions,
  onEventClick,
  onAdd,
}: {
  days: Date[];
  events: CalendarEvent[];
  calendars: Map<string, { color: string; name: string }>;
  showDescriptions: boolean;
  onEventClick: (event: CalendarEvent) => void;
  onAdd: (day: Date) => void;
}) {
  const today = startOfDay(new Date());
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agenda-list">
      {days.map((day) => {
        const dayEvents = events
          .filter((e) => eventOnDay(e, day))
          .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventSpan(a).start.getTime() - eventSpan(b).start.getTime());
        const isToday = day.getTime() === today.getTime();
        return (
          <section key={day.toISOString()} className="flex gap-4 border-b border-[var(--border)] px-4 py-3" aria-label={dayHeading.format(day)}>
            <div className="w-[120px] shrink-0">
              <p className={`text-[14px] font-semibold ${isToday ? "text-[var(--accent-ink)]" : "text-[var(--ink)]"}`}>{dayHeading.format(day).split(" ")[0]}</p>
              <p className="tabular-nums text-[12px] text-[var(--ink3)]">{formatDate(day)}</p>
            </div>
            <div className="min-w-0 flex-1">
              {dayEvents.length === 0 ? (
                <button type="button" onClick={() => onAdd(day)} className="py-1 text-[12.5px] text-[var(--ink3)] hover:text-[var(--accent-ink)]">
                  Nothing scheduled · + Add
                </button>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {dayEvents.map((event) => {
                    const span = eventSpan(event);
                    const calendar = calendars.get(event.calendarId);
                    return (
                      <li key={event.id}>
                        <button type="button" onClick={() => onEventClick(event)} className="flex w-full gap-3 rounded-lg p-2 text-left hover:bg-[var(--s2)]">
                          <span className="w-1 shrink-0 self-stretch rounded-full" style={swatchStyle(calendar?.color)} aria-hidden />
                          <span className="w-[120px] shrink-0 tabular-nums text-[12.5px] text-[var(--ink2)]">
                            {event.allDay ? "All day" : formatTimeRange(span.start, span.end)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{event.title}</span>
                            {(event.location || event.videoLink) && (
                              <span className="block truncate text-[12px] text-[var(--ink3)]">{event.location || "Video meeting"}</span>
                            )}
                            {showDescriptions && event.description && (
                              <span className="mt-0.5 line-clamp-2 block text-[12px] text-[var(--ink2)]">{event.description}</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
