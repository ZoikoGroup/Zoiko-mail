"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, Check, Inbox, KeyRound, Layers, Lock, Share2, ShieldCheck, X } from "lucide-react";
import type { AccessibleCalendar, ScopedEvent } from "@/lib/calendar-api";
import { useAccessibleCalendars, useAccessRequests, useDecideAccessRequest, useScopedEvents, useShares } from "@/lib/calendar-hooks";
import { ApiError } from "@/lib/api-client";
import { eventSpan, formatTimeRange, localZone, startOfDay, viewRange } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { CalendarToolbar } from "./CalendarToolbar";
import { TimeGrid } from "./TimeGrid";
import { AccessDialog, Avatar, RequestAccessDialog, ShareCalendarDialog } from "./SharingDialogs";
import { ACCESS_LABEL, AccessPill, CalendarChecklist } from "./access";
import { swatchStyle } from "./palette";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";

type SharedView = "week" | "matrix";
const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Shared Calendars: what colleagues shared with me, what I share, and who may see what. */
export function SharedCalendarsPage() {
  const params = useSearchParams();
  const zone = useMemo(() => localZone(), []);
  const [view, setView] = useState<SharedView>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ScopedEvent | null>(null);
  const [showRequests, setShowRequests] = useState(() => params.get("requests") === "1");
  const [dialog, setDialog] = useState<
    | { kind: "request"; calendar?: AccessibleCalendar | null }
    | { kind: "share" }
    | { kind: "access"; calendar: AccessibleCalendar }
    | null
  >(null);

  const accessible = useAccessibleCalendars();
  const all = useMemo(() => accessible.data ?? [], [accessible.data]);
  const sharedWithMe = useMemo(() => all.filter((c) => c.kind === "PERSONAL" && c.access !== "OWNER"), [all]);
  const mineShared = useMemo(() => all.filter((c) => c.access === "OWNER" && c.sharedWithCount > 0), [all]);
  const calendarMap = useMemo(() => new Map(all.map((c) => [c.id, { ...c, createdAt: "", updatedAt: "" }])), [all]);
  const requests = useAccessRequests();
  const incoming = requests.data?.incoming ?? [];

  useEffect(() => {
    if (!selectedCalendarId && sharedWithMe[0]) setSelectedCalendarId(sharedWithMe[0].id);
  }, [sharedWithMe, selectedCalendarId]);
  const selectedCalendar = all.find((c) => c.id === selectedCalendarId) ?? null;

  const range = useMemo(() => viewRange("workweek", anchor), [anchor]);
  const events = useScopedEvents("shared", range.from, range.to);
  const visible = (events.data ?? []).filter((e) => calendarMap.get(e.calendarId)?.isVisible);

  const sidebarSection = (
    <>
      <div className="px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Shared with me</h2>
      </div>
      {sharedWithMe.length === 0 ? (
        accessible.isLoading ? (
          <Spinner size="sm" label="Loading calendars" className="px-3 py-1 text-xs" />
        ) : (
          <p className="px-3 py-1 text-xs text-[var(--ink3)]">Nothing shared with you yet.</p>
        )
      ) : (
        <CalendarChecklist calendars={sharedWithMe} showAccess testId="shared-with-me" />
      )}
      {mineShared.length > 0 && (
        <>
          <div className="px-3 pb-1.5 pt-4">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">I share</h2>
          </div>
          <ul className="space-y-0.5">
            {mineShared.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: "access", calendar: c })}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[13px] text-[var(--ink2)] hover:bg-[var(--s2)]"
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={swatchStyle(c.color)} aria-hidden />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-[11px] text-[var(--ink3)]">{c.sharedWithCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        onClick={() => setShowRequests((v) => !v)}
        className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] text-[var(--ink2)] hover:bg-[var(--s2)]"
        aria-expanded={showRequests}
      >
        <KeyRound className="h-4 w-4" aria-hidden /> Access requests
        {incoming.length > 0 && (
          <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {incoming.length}
          </span>
        )}
      </button>
    </>
  );

  return (
    <CalendarWorkspace active="shared" sidebarSection={sidebarSection}>
      <CalendarPageHeader
        icon={Layers}
        title="Shared Calendars"
        subtitle="Explore shared schedules with clear ownership, visibility and permission boundaries."
        actions={
          <>
            <button type="button" className="zoiko-btn" onClick={() => setDialog({ kind: "request" })}>
              <KeyRound className="h-4 w-4" aria-hidden /> Request access
            </button>
            <button type="button" className="zoiko-btn pri" onClick={() => setDialog({ kind: "share" })}>
              <Share2 className="h-4 w-4" aria-hidden /> Share a calendar
            </button>
          </>
        }
      />

      {showRequests && (
        <AccessRequestsPanel onClose={() => setShowRequests(false)} />
      )}

      <div className="flex min-h-[640px] flex-1 gap-4">
        <section aria-label="Shared calendars" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <CalendarToolbar
            anchor={anchor}
            onAnchor={setAnchor}
            stepView="workweek"
            labelView="workweek"
            zoneLabel={zone.label}
            views={[
              { key: "week", label: "Week" },
              { key: "matrix", label: "Access matrix" },
            ]}
            view={view}
            onView={setView}
          />
          {view === "week" ? (
            accessible.isError && !accessible.data ? (
              <ErrorState compact message="Could not load the calendars shared with you." onRetry={() => void accessible.refetch()} />
            ) : accessible.isLoading ? (
              <BrandLoader variant="compact" label="Loading shared calendars" onRetry={() => void accessible.refetch()} />
            ) : sharedWithMe.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-10 text-center" data-testid="shared-empty">
                <Layers className="h-10 w-10 text-[var(--accent-ink)]" aria-hidden />
                <h2 className="mt-3 text-[18px] font-semibold text-[var(--ink)]">Nothing shared with you yet</h2>
                <p className="mt-1 max-w-md text-[13px] text-[var(--ink2)]">Ask a colleague for access to their calendar, or share one of yours.</p>
                <button type="button" className="zoiko-btn pri mt-4" onClick={() => setDialog({ kind: "request" })}>
                  <KeyRound className="h-4 w-4" aria-hidden /> Request access
                </button>
              </div>
            ) : events.isError && !events.data ? (
              <ErrorState compact message="Could not load the shared events." onRetry={() => void events.refetch()} />
            ) : events.data === undefined ? (
              // First load only: a new week keeps the previous one's events on screen.
              <BrandLoader variant="compact" label="Loading shared events" onRetry={() => void events.refetch()} />
            ) : (
              <TimeGrid
                days={range.days}
                events={visible}
                calendars={calendarMap}
                selectedId={selectedEvent?.id ?? null}
                offsetLabel={zone.offsetLabel}
                onEventClick={(event) => {
                  setSelectedEvent(event as ScopedEvent);
                  setSelectedCalendarId(event.calendarId);
                }}
              />
            )
          ) : (
            <AccessMatrix
              calendars={[...sharedWithMe, ...mineShared]}
              onOpen={(c) => setDialog({ kind: "access", calendar: c })}
              onSelect={(c) => setSelectedCalendarId(c.id)}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--ink3)]">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--ink2)]" aria-hidden />
              Shared calendar overlays · private details shown only as Busy
            </span>
            <span>
              {sharedWithMe.length} shared with you · {visible.length} {visible.length === 1 ? "event" : "events"}
            </span>
          </div>
        </section>

        <aside className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex" aria-label="Calendar access">
          <SelectedCalendarCard
            calendar={selectedCalendar}
            onViewAccess={(c) => setDialog({ kind: "access", calendar: c })}
            onRequestEdit={(c) => setDialog({ kind: "request", calendar: c })}
          />
          <WhoCanSee calendar={selectedCalendar} onDetails={(c) => setDialog({ kind: "access", calendar: c })} />
          <SelectedEventCard event={selectedEvent} calendar={selectedEvent ? all.find((c) => c.id === selectedEvent.calendarId) ?? null : null} />
        </aside>
      </div>

      {dialog?.kind === "request" && <RequestAccessDialog calendar={dialog.calendar} onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && <ShareCalendarDialog calendars={all} onClose={() => setDialog(null)} />}
      {dialog?.kind === "access" && <AccessDialog calendar={dialog.calendar} onClose={() => setDialog(null)} />}
    </CalendarWorkspace>
  );
}

function SelectedCalendarCard({
  calendar,
  onViewAccess,
  onRequestEdit,
}: {
  calendar: AccessibleCalendar | null;
  onViewAccess: (c: AccessibleCalendar) => void;
  onRequestEdit: (c: AccessibleCalendar) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="selected-calendar">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">Selected calendar</h3>
        {calendar && <span className="rounded-md border border-[#22B07D]/50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[#22B07D]">Internal share</span>}
      </div>
      {!calendar ? (
        <p className="text-[12.5px] text-[var(--ink3)]">Choose a calendar to see who owns it and what you can do with it.</p>
      ) : (
        <>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
              <span className="h-3 w-3 rounded-full" style={swatchStyle(calendar.color)} aria-hidden /> {calendar.name}
            </p>
            <dl className="mt-3 space-y-2 text-[12.5px]">
              <Row term="Owner">{calendar.owner?.name ?? "You"}</Row>
              <Row term="Your access">
                <AccessPill access={calendar.access} />
              </Row>
              <Row term="Shared with">
                {calendar.sharedWithCount} {calendar.sharedWithCount === 1 ? "person" : "people"}
              </Row>
              <Row term="External sharing">
                <span className="font-semibold text-[#F06A6E]">Disabled</span>
              </Row>
            </dl>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="zoiko-btn flex-1 justify-center" onClick={() => onViewAccess(calendar)}>
              View access
            </button>
            {calendar.access !== "OWNER" && calendar.access !== "EDIT" && calendar.access !== "MANAGE" && (
              <button type="button" className="zoiko-btn flex-1 justify-center" onClick={() => onRequestEdit(calendar)}>
                Request edit
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-[var(--ink3)]">{term}</dt>
      <dd className="text-right text-[var(--ink)]">{children}</dd>
    </div>
  );
}

function WhoCanSee({ calendar, onDetails }: { calendar: AccessibleCalendar | null; onDetails: (c: AccessibleCalendar) => void }) {
  const shares = useShares(calendar?.id ?? null);
  if (!calendar) return null;
  const hidden = shares.error instanceof ApiError && shares.error.status === 403;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="who-can-see">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">Who can see what</h3>
        {!hidden && (
          <button type="button" className="text-[12px] text-[var(--accent-ink)] hover:underline" onClick={() => onDetails(calendar)}>
            Details →
          </button>
        )}
      </div>
      {hidden ? (
        <p className="text-[12.5px] text-[var(--ink3)]">With free/busy access you see only when it is busy.</p>
      ) : shares.isError && !shares.data ? (
        <ErrorState compact message="Could not load who has access." onRetry={() => void shares.refetch()} />
      ) : shares.isLoading ? (
        <BrandLoader variant="compact" label="Loading access" onRetry={() => void shares.refetch()} />
      ) : (
        <ul className="space-y-2.5">
          {shares.data?.owner && (
            <li className="flex items-center gap-2.5">
              <Avatar name={shares.data.owner.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">{shares.data.owner.name}</span>
              <span className="text-[11.5px] text-[var(--ink2)]">Manage</span>
            </li>
          )}
          {shares.data?.shares.slice(0, 5).map((s) => (
            <li key={s.id} className="flex items-center gap-2.5">
              <Avatar name={s.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">
                {s.name}
                {s.isMe ? " (you)" : ""}
              </span>
              <span className="text-[11.5px] text-[var(--ink2)]">{ACCESS_LABEL[s.access]}</span>
            </li>
          ))}
          <li className="flex items-center gap-2.5 opacity-80">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--s2)] text-[10.5px] font-semibold text-[var(--ink3)]" aria-hidden>
              EX
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink2)]">External guests</span>
            <span className="text-[11.5px] text-[var(--ink3)]">No access</span>
          </li>
        </ul>
      )}
    </div>
  );
}

function SelectedEventCard({ event, calendar }: { event: ScopedEvent | null; calendar: AccessibleCalendar | null }) {
  if (!event) return null;
  const span = eventSpan(event);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="selected-event">
      <h3 className="mb-3 text-[15px] font-semibold text-[var(--ink)]">Selected event</h3>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
        {calendar && <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--accent-ink)]">{calendar.name}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold text-[var(--ink)]">
          {event.redacted && <Lock className="h-4 w-4" aria-hidden />} {event.title}
        </p>
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {dayHeading.format(span.start)} · {event.allDay ? "All day" : formatTimeRange(span.start, span.end)}
        </p>
        <p className="mt-1 flex items-center gap-2 text-[12.5px] text-[var(--ink3)]">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          {event.redacted ? "Details hidden · Free/Busy" : `Details visible through ${calendar?.name ?? "this calendar"}`}
        </p>
      </div>
      <p className="mt-2 text-[11px] text-[var(--ink3)]">
        {event.canEdit ? "You can edit events in this calendar." : "Read-only: you cannot edit events here."}
      </p>
    </div>
  );
}

function AccessMatrix({
  calendars,
  onOpen,
  onSelect,
}: {
  calendars: AccessibleCalendar[];
  onOpen: (c: AccessibleCalendar) => void;
  onSelect: (c: AccessibleCalendar) => void;
}) {
  if (calendars.length === 0) {
    return <p className="p-6 text-[13px] text-[var(--ink3)]">Nothing is shared with you, and you share nothing yet.</p>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="access-matrix">
      <table className="w-full min-w-[620px] text-left text-[13px]">
        <thead className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink3)]">
          <tr className="border-b border-[var(--border)]">
            <th className="px-4 py-3 font-semibold">Calendar</th>
            <th className="px-4 py-3 font-semibold">Owner</th>
            <th className="px-4 py-3 font-semibold">Your access</th>
            <th className="px-4 py-3 font-semibold">Shared with</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {calendars.map((c) => (
            <tr key={c.id} className="border-b border-[var(--border)] hover:bg-[var(--s2)]" onClick={() => onSelect(c)}>
              <td className="px-4 py-3">
                <span className="flex items-center gap-2 text-[var(--ink)]">
                  <span className="h-3 w-3 rounded-full" style={swatchStyle(c.color)} aria-hidden /> {c.name}
                </span>
              </td>
              <td className="px-4 py-3 text-[var(--ink2)]">{c.owner?.name ?? "You"}</td>
              <td className="px-4 py-3">
                <AccessPill access={c.access} />
              </td>
              <td className="px-4 py-3 text-[var(--ink2)]">{c.sharedWithCount}</td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  className="zoiko-btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(c);
                  }}
                >
                  View access
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function AccessRequestsPanel({ onClose }: { onClose: () => void }) {
  const requests = useAccessRequests();
  const decide = useDecideAccessRequest();
  const incoming = requests.data?.incoming ?? [];
  const outgoing = requests.data?.outgoing ?? [];
  return (
    <section aria-label="Access requests" className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="access-requests">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
          <KeyRound className="h-4 w-4" aria-hidden /> Access requests
        </h2>
        <button type="button" className="rounded p-1 text-[var(--ink3)] hover:bg-[var(--s2)]" aria-label="Close access requests" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink3)]">Waiting for you</p>
          {incoming.length === 0 ? (
            <p className="flex items-center gap-2 text-[12.5px] text-[var(--ink3)]">
              <Inbox className="h-4 w-4" aria-hidden /> No requests to decide.
            </p>
          ) : (
            <ul className="space-y-2">
              {incoming.map((r) => (
                <li key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
                  <p className="text-[13px] text-[var(--ink)]">
                    <b>{r.requester.name}</b> asks for <b>{ACCESS_LABEL[r.access]}</b> on {r.calendar.name}
                  </p>
                  {r.message && <p className="mt-1 text-[12.5px] italic text-[var(--ink2)]">“{r.message}”</p>}
                  <p className="mt-1 text-[11.5px] text-[var(--ink3)]">{when.format(new Date(r.createdAt))}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="zoiko-btn sm pri" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}>
                      <Check className="h-3.5 w-3.5" aria-hidden /> Approve
                    </button>
                    <button type="button" className="zoiko-btn sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}>
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink3)]">Your requests</p>
          {outgoing.length === 0 ? (
            <p className="text-[12.5px] text-[var(--ink3)]">You have not asked for access to any calendar.</p>
          ) : (
            <ul className="space-y-1.5">
              {outgoing.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="truncate text-[var(--ink2)]">
                    {ACCESS_LABEL[r.access]} · {r.calendar.name}
                    {r.calendar.ownerName ? ` (${r.calendar.ownerName})` : ""}
                  </span>
                  <span
                    className="shrink-0 font-semibold"
                    style={{ color: r.status === "APPROVED" ? "#22B07D" : r.status === "DECLINED" ? "#F06A6E" : "#E0A33A" }}
                  >
                    {r.status === "PENDING" ? "Pending" : r.status === "APPROVED" ? "Approved" : "Declined"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {decide.error && (
        <p role="alert" className="mt-2 text-[12px] text-[var(--crit)]">
          {(decide.error as Error).message}
        </p>
      )}
    </section>
  );
}
