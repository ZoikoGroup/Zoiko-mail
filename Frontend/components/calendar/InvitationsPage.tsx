"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CalendarClock,
  Check,
  Clock,
  History,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Video,
  X,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import type { CalendarEvent, EventDetail, InvitationItem, InvitationTab } from "@/lib/calendar-api";
import {
  useCalendarEvents,
  useCalendars,
  useEventDetail,
  useInvitationCounts,
  useInvitations,
  useMarkSeen,
  useRespond,
  useUpdateEvent,
} from "@/lib/calendar-hooks";
import { eventSpan, formatTime, localZone } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { EventDialog } from "./EventDialog";
import { ProposeTimeDialog } from "./ProposeTimeDialog";
import { initials } from "./AttendeeInput";
import { PILL_LABEL, RESPONSE_HEX, RESPONSE_LABEL, pillStyle } from "./rsvp";

const TABS: { key: InvitationTab; label: string; countKey?: "awaiting" | "updates" }[] = [
  { key: "awaiting", label: "Awaiting Your Response", countKey: "awaiting" },
  { key: "all", label: "All Invitations" },
  { key: "updates", label: "Updates", countKey: "updates" },
  { key: "accepted", label: "Accepted" },
  { key: "sent", label: "Sent by Me" },
];

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const stamp = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function whenLine(item: { startsAt: string; endsAt: string; allDay: boolean }): string {
  const { start, end } = eventSpan(item);
  if (item.allDay) return `${dayTime.format(start)} · All day`;
  return `${dayTime.format(start)} · ${formatTime(start)}–${formatTime(end)}`;
}

/** Invitations & RSVP: what I am asked to, what I answered, and what I sent. */
export function InvitationsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const zone = useMemo(() => localZone(), []);
  const [tab, setTab] = useState<InvitationTab>(() => (params.get("event") ? "all" : "awaiting"));
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("event"));
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const counts = useInvitationCounts();
  const list = useInvitations(tab, debounced);
  const items = list.data ?? [];
  const { data: calendars = [] } = useCalendars();

  // Keep a selection: the one asked for in the URL, else the first in the tab.
  useEffect(() => {
    if (!list.data) return;
    if (selectedId && (list.data.some((i) => i.eventId === selectedId) || params.get("event") === selectedId)) return;
    setSelectedId(list.data[0]?.eventId ?? null);
  }, [list.data, selectedId, params]);

  const select = (id: string) => {
    setSelectedId(id);
    router.replace(`/mail/calendar/invitations?event=${id}`, { scroll: false });
  };

  return (
    <CalendarWorkspace active="invitations" onCreateEvent={() => setCreating(true)}>
      <CalendarPageHeader
        icon={CalendarDays}
        eyebrow="Calendar / Invitations"
        title="Invitations & RSVP Management"
        subtitle="Respond to invitations, review meeting updates and track attendee confirmations."
        actions={
          <button type="button" className="zoiko-btn pri" onClick={() => setCreating(true)} disabled={calendars.length === 0}>
            <Plus className="h-4 w-4" aria-hidden /> New invitation
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-[var(--border)]">
        <div role="tablist" aria-label="Invitations" className="flex flex-wrap gap-1">
          {TABS.map((t) => {
            const count = t.countKey ? counts.data?.[t.countKey] ?? 0 : 0;
            const current = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={current}
                onClick={() => {
                  setTab(t.key);
                  setSelectedId(null);
                }}
                className={`relative -mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-[13px] transition ${
                  current ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink2)] hover:text-[var(--ink)]"
                }`}
              >
                {t.label}
                {count > 0 && (
                  <span className="inline-flex min-w-[20px] items-center justify-center rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="mb-2 ml-auto rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--ink2)]">{zone.label}</span>
      </div>

      <div className="grid min-h-[620px] flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <InvitationList
          tab={tab}
          items={items}
          loading={list.isLoading}
          error={list.error as Error | null}
          query={query}
          onQuery={setQuery}
          selectedId={selectedId}
          onSelect={select}
        />
        {selectedId ? (
          <InvitationDetail key={selectedId} eventId={selectedId} />
        ) : (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[13px] text-[var(--ink3)] 2xl:col-span-2">
            {list.isLoading ? "Loading…" : "Nothing here yet. Invitations you receive or send appear in these tabs."}
          </div>
        )}
      </div>

      {creating && <EventDialog calendars={calendars} onClose={() => setCreating(false)} />}
    </CalendarWorkspace>
  );
}

function InvitationList({
  tab,
  items,
  loading,
  error,
  query,
  onQuery,
  selectedId,
  onSelect,
}: {
  tab: InvitationTab;
  items: InvitationItem[];
  loading: boolean;
  error: Error | null;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const heading = TABS.find((t) => t.key === tab)!.label;
  return (
    <section aria-label="Invitation list" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3">
        <label className="relative block">
          <span className="sr-only">Search invitations</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
          <input
            className="zoiko-input w-full"
            style={{ paddingLeft: 34 }}
            placeholder="Search invitations…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink2)]">
        <span>{heading}</span>
        <span className="normal-case tracking-normal text-[var(--ink3)]">
          {items.length} {items.length === 1 ? "invitation" : "invitations"}
        </span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="invitation-list">
        {error ? (
          <li className="p-4 text-[12.5px] text-[var(--crit)]" role="alert">
            Could not load invitations. {error.message}
          </li>
        ) : loading ? (
          <li className="p-4 text-[12.5px] text-[var(--ink3)]">Loading…</li>
        ) : items.length === 0 ? (
          <li className="p-6 text-center text-[12.5px] text-[var(--ink3)]">
            {tab === "awaiting" ? "You're all caught up — nothing is waiting for your answer." : "No invitations here."}
          </li>
        ) : (
          items.map((item) => {
            const active = item.eventId === selectedId;
            const replied = item.responses.accepted + item.responses.tentative + item.responses.declined;
            return (
              <li key={item.eventId}>
                <button
                  type="button"
                  onClick={() => onSelect(item.eventId)}
                  aria-current={active ? "true" : undefined}
                  className={`relative flex w-full gap-3 border-b border-[var(--border)] px-4 py-3.5 text-left transition ${
                    active
                      ? "bg-[var(--zm-selected)] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--accent)]"
                      : "hover:bg-[var(--s2)]"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--accent-ink)]" aria-hidden>
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`truncate text-[13.5px] text-[var(--ink)] ${item.isNew ? "font-bold" : "font-semibold"}`}>{item.title}</span>
                      {item.myResponse ? (
                        <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold" style={pillStyle(item.myResponse)}>
                          {PILL_LABEL[item.myResponse]}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--ink2)]">
                          {replied}/{item.attendeeCount} replied
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-[var(--ink2)]">{whenLine(item)}</span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-[var(--ink3)]">
                      <span className="truncate">
                        {item.myResponse ? `From ${item.organizer.name ?? item.organizer.email}` : "You organised this"} · {item.attendeeCount}{" "}
                        {item.attendeeCount === 1 ? "invitee" : "invitees"}
                      </span>
                      {item.hasUpdate ? (
                        <span className="shrink-0 text-[11px] font-medium text-[#E0A33A]">Updated</span>
                      ) : item.isNew ? (
                        <span className="shrink-0 text-[11px] font-medium text-[var(--accent-ink)]">New</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div className="flex justify-between border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">
        <span>Times shown in your time zone</span>
      </div>
    </section>
  );
}

type DetailTab = "details" | "attendees" | "updates";

function InvitationDetail({ eventId }: { eventId: string }) {
  const detail = useEventDetail(eventId);
  const respond = useRespond();
  const markSeen = useMarkSeen();
  const [tab, setTab] = useState<DetailTab>("details");
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState(false);
  const { data: calendars = [] } = useCalendars();
  const seenFor = useRef<string | null>(null);

  const event = detail.data;
  // Opening an invitation marks it seen: no longer New, its changes read.
  useEffect(() => {
    if (!event || event.isOrganizer || seenFor.current === `${event.id}:${event.sequence}`) return;
    if (event.isNew || event.hasUpdate) {
      seenFor.current = `${event.id}:${event.sequence}`;
      markSeen.mutate(event.id);
    }
  }, [event, markSeen]);

  if (detail.isLoading) {
    return <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-[13px] text-[var(--ink3)] 2xl:col-span-2">Loading…</div>;
  }
  if (detail.isError || !event) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-[13px] text-[var(--ink2)] 2xl:col-span-2" role="alert">
        This invitation is no longer available. It may have been cancelled, or you were removed from it.
      </div>
    );
  }

  const { start, end } = eventSpan(event);
  // A finished meeting can no longer be answered (the server refuses it too).
  const ended = end.getTime() <= Date.now();
  const answer = (response: "ACCEPTED" | "TENTATIVE" | "DECLINED") => respond.mutate({ id: event.id, response });
  const latestUpdate = event.history.find((h) => h.type === "UPDATED");

  return (
    <>
      <section aria-label={event.title} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] p-5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.12em] text-[var(--accent-ink)]">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {event.isOrganizer ? "Your meeting" : "Meeting invitation"}
            </span>
            {event.receivedAt && <span className="text-[var(--ink3)]">Received · {shortDate.format(new Date(event.receivedAt))}</span>}
          </div>
          <h2 className="mt-2 text-[24px] font-bold tracking-tight text-[var(--ink)]" data-testid="invitation-title">
            {event.title}
          </h2>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Fact icon={CalendarClock} term={longDay.format(start)}>
              {event.allDay ? "All day" : `${formatTime(start)}–${formatTime(end)} · ${localZone().label}`}
            </Fact>
            <Fact icon={UserRound} term={event.organizer.name ?? event.organizer.email}>
              Meeting organizer
            </Fact>
            <Fact icon={MapPin} term={event.location ?? (event.videoLink ? "Video meeting" : "No location set")}>
              {event.videoLink ? (
                <a href={event.videoLink} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] hover:underline">
                  Join video meeting
                </a>
              ) : (
                "In person"
              )}
            </Fact>
            <Fact icon={Users} term={`${event.attendees.length} invited ${event.attendees.length === 1 ? "attendee" : "attendees"}`}>
              {event.counts.accepted} accepted · {event.counts.needsAction} yet to reply
            </Fact>
          </dl>

          {!event.isOrganizer && event.hasUpdate && latestUpdate && (
            <Callout icon={AlertTriangle}>
              <b>This meeting changed</b> — {String((latestUpdate.detail.changed as string[] | undefined)?.join(", ") ?? "details")} updated by{" "}
              {latestUpdate.actorName}.{event.myResponse === "NEEDS_ACTION" ? " Please answer again." : ""}
            </Callout>
          )}
          {!event.isOrganizer && event.myResponse === "NEEDS_ACTION" && !event.hasUpdate && !ended && (
            <Callout icon={Clock}>
              <b>Response requested</b> — You haven&apos;t responded. Review the time and agenda before choosing an RSVP status.
            </Callout>
          )}
          {!event.isOrganizer && ended && (
            <p className="mt-4 text-[12.5px] text-[var(--ink2)]" data-testid="ended-note">
              This meeting has ended, so it can no longer be answered.{" "}
              {event.myResponse && event.myResponse !== "NEEDS_ACTION" ? (
                <>
                  You answered <b style={{ color: RESPONSE_HEX[event.myResponse] }}>{RESPONSE_LABEL[event.myResponse]}</b>.
                </>
              ) : (
                "You did not answer it."
              )}
            </p>
          )}
          {!event.isOrganizer && !ended && event.myResponse && event.myResponse !== "NEEDS_ACTION" && (
            <p className="mt-4 text-[12.5px] text-[var(--ink2)]">
              You answered <b style={{ color: RESPONSE_HEX[event.myResponse] }}>{RESPONSE_LABEL[event.myResponse]}</b>. You can change your answer until the meeting ends.
            </p>
          )}

          {event.isOrganizer ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="zoiko-btn" onClick={() => setEditing(true)} disabled={!event.calendarId}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit meeting
              </button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Your answer">
              <RsvpButton label="Accept" icon={Check} hex={RESPONSE_HEX.ACCEPTED} active={event.myResponse === "ACCEPTED"} busy={respond.isPending || ended} onClick={() => answer("ACCEPTED")} />
              <RsvpButton label="Tentative" icon={Clock} hex={RESPONSE_HEX.NEEDS_ACTION} active={event.myResponse === "TENTATIVE"} busy={respond.isPending || ended} onClick={() => answer("TENTATIVE")} />
              <RsvpButton label="Decline" icon={X} hex={RESPONSE_HEX.DECLINED} active={event.myResponse === "DECLINED"} busy={respond.isPending || ended} onClick={() => answer("DECLINED")} />
              <button type="button" className="zoiko-btn justify-center" onClick={() => setProposing(true)} disabled={ended}>
                <CalendarDays className="h-4 w-4" aria-hidden /> Propose new time
              </button>
            </div>
          )}
          {respond.error && (
            <p role="alert" className="mt-2 text-[12px] text-[var(--crit)]">
              {(respond.error as Error).message}
            </p>
          )}
        </div>

        <div role="tablist" aria-label="Invitation" className="flex gap-1 border-b border-[var(--border)] px-5">
          {(
            [
              ["details", "Details"],
              ["attendees", `Attendees (${event.attendees.length})`],
              ["updates", "Meeting updates"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-3 text-[13px] ${
                tab === key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink2)] hover:text-[var(--ink)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "details" && (
            <div>
              <h3 className="text-[16px] font-semibold text-[var(--ink)]">Meeting agenda</h3>
              {event.description ? (
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ink2)]">{event.description}</p>
              ) : (
                <p className="mt-2 text-[13px] text-[var(--ink3)]">No agenda was added.</p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3.5">
                <Avatar name={event.organizer.name ?? event.organizer.email} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{event.organizer.name ?? event.organizer.email}</p>
                  <p className="truncate text-[12px] text-[var(--ink3)]">Organizer · {event.organizer.email}</p>
                </div>
                <div className="text-right text-[12px] text-[var(--ink3)]">
                  {event.calendarName && <p>Calendar: {event.calendarName}</p>}
                  <p>Visibility: Invited members</p>
                </div>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-[var(--ink3)]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Only the organizer and the people invited can see this meeting.
              </p>
            </div>
          )}
          {tab === "attendees" && <AttendeeList event={event} />}
          {tab === "updates" && <HistoryList event={event} />}
        </div>
      </section>

      <aside className="hidden flex-col gap-4 2xl:flex" aria-label="Responses and schedule">
        <ResponsesCard event={event} onSeeAll={() => setTab("attendees")} />
        <ScheduleCheck event={event} />
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
            <History className="h-4 w-4" aria-hidden /> Invitation history
          </h3>
          <HistoryList event={event} compact />
        </div>
      </aside>

      {proposing && <ProposeTimeDialog event={event} onClose={() => setProposing(false)} />}
      {editing && event.calendarId && (
        <EventDialog
          calendars={calendars}
          event={{
            id: event.id,
            calendarId: event.calendarId,
            title: event.title,
            description: event.description,
            location: event.location,
            videoLink: event.videoLink,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            allDay: event.allDay,
            timeZone: event.timeZone,
            visibility: event.visibility,
            showAs: event.showAs,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function Fact({ icon: Icon, term, children }: { icon: typeof Clock; term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink3)]" aria-hidden />
      <div className="min-w-0">
        <dt className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{term}</dt>
        <dd className="text-[12px] text-[var(--ink3)]">{children}</dd>
      </div>
    </div>
  );
}

/** The amber notice above the answer buttons. */
function Callout({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="mt-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] text-[#F2C46D]"
      style={{ backgroundColor: "color-mix(in srgb, #E0A33A 12%, transparent)", borderColor: "color-mix(in srgb, #E0A33A 45%, transparent)" }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function RsvpButton({
  label,
  icon: Icon,
  hex,
  active,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Clock;
  hex: string;
  active: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      className="flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-semibold transition hover:brightness-110 disabled:opacity-60"
      style={{
        color: active ? "#fff" : hex,
        backgroundColor: active ? hex : `color-mix(in srgb, ${hex} 14%, transparent)`,
        borderColor: `color-mix(in srgb, ${hex} 55%, transparent)`,
      }}
    >
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-10 w-10 text-[13px]" : "h-8 w-8 text-[11px]";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-semibold text-white ${box}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

function ResponsesCard({ event, onSeeAll }: { event: EventDetail; onSeeAll: () => void }) {
  const total = Math.max(1, event.attendees.length);
  const segments = [
    ["ACCEPTED", event.counts.accepted],
    ["TENTATIVE", event.counts.tentative],
    ["NEEDS_ACTION", event.counts.needsAction],
    ["DECLINED", event.counts.declined],
  ] as const;
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="attendee-responses">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
        <Users className="h-4 w-4" aria-hidden /> Attendee responses
      </h3>
      <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
        {event.attendees.length} invited {event.attendees.length === 1 ? "participant" : "participants"}
        {!event.isOrganizer && event.myResponse === "NEEDS_ACTION" ? " · your RSVP pending" : ""}
      </p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--s2)]" aria-hidden>
        {segments.map(([key, n]) => (n ? <span key={key} style={{ width: `${(n / total) * 100}%`, backgroundColor: RESPONSE_HEX[key] }} /> : null))}
      </div>
      <ul className="mt-3 space-y-1 text-[12.5px]">
        {segments.map(([key, n]) => (
          <li key={key} className="flex items-center justify-between text-[var(--ink2)]">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RESPONSE_HEX[key] }} aria-hidden />
              {key === "NEEDS_ACTION" ? "Awaiting reply" : RESPONSE_LABEL[key]}
            </span>
            <span className="tabular-nums text-[var(--ink)]">{n}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        <li className="flex items-center gap-2.5">
          <Avatar name={event.organizer.name ?? event.organizer.email} />
          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">{event.organizer.name ?? event.organizer.email}</span>
          <span className="text-[11.5px] text-[var(--ink3)]">Organizer</span>
        </li>
        {event.attendees.slice(0, 3).map((a) => (
          <li key={a.id} className="flex items-center gap-2.5">
            <Avatar name={a.name} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">
              {a.name}
              {a.isMe ? " (you)" : ""}
            </span>
            <span className="text-[11.5px]" style={{ color: RESPONSE_HEX[a.response] }}>
              {RESPONSE_LABEL[a.response]}
            </span>
          </li>
        ))}
      </ul>
      {event.attendees.length > 0 && (
        <button type="button" onClick={onSeeAll} className="mt-3 text-[12.5px] font-medium text-[var(--accent-ink)] hover:underline">
          See all attendee responses →
        </button>
      )}
    </div>
  );
}

/** Real conflicts: my other busy events overlapping this one. */
function ScheduleCheck({ event }: { event: EventDetail }) {
  const { start, end } = eventSpan(event);
  // A finished meeting can no longer be answered (the server refuses it too).
  const ended = end.getTime() <= Date.now();
  const events = useCalendarEvents(start, end);
  const clashes = (events.data ?? []).filter(
    (e: CalendarEvent) => e.id !== event.id && e.showAs === "BUSY" && e.myResponse !== "DECLINED"
  );
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="schedule-check">
      <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
        <Clock className="h-4 w-4" aria-hidden /> Schedule check
      </h3>
      {events.isLoading ? (
        <p className="text-[12.5px] text-[var(--ink3)]">Checking your calendar…</p>
      ) : clashes.length === 0 ? (
        <p
          className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] text-[#4FD1A1]"
          style={{ backgroundColor: "color-mix(in srgb, #22B07D 12%, transparent)", borderColor: "color-mix(in srgb, #22B07D 40%, transparent)" }}
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> No conflicts with your calendar at this time.
        </p>
      ) : (
        <div
          className="rounded-xl border px-3 py-2.5 text-[12.5px] text-[#F2C46D]"
          style={{ backgroundColor: "color-mix(in srgb, #E0A33A 12%, transparent)", borderColor: "color-mix(in srgb, #E0A33A 45%, transparent)" }}
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Overlaps {clashes.length} {clashes.length === 1 ? "event" : "events"}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {clashes.slice(0, 3).map((c) => {
              const s = eventSpan(c);
              return (
                <li key={c.id} className="truncate">
                  {c.allDay ? "All day" : `${formatTime(s.start)}–${formatTime(s.end)}`} · {c.title}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link
        href={`/mail/calendar?date=${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`}
        className="zoiko-btn mt-3 w-full justify-center"
      >
        <CalendarDays className="h-4 w-4" aria-hidden /> Check availability
      </Link>
    </div>
  );
}

function AttendeeList({ event }: { event: EventDetail }) {
  const update = useUpdateEvent();
  if (event.attendees.length === 0) return <p className="text-[13px] text-[var(--ink3)]">Nobody else is invited.</p>;
  return (
    <ul className="divide-y divide-[var(--border)]" data-testid="attendee-list">
      {event.attendees.map((a) => (
        <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
          <Avatar name={a.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-[var(--ink)]">
              {a.name}
              {a.isMe ? " (you)" : ""}
              {!a.isMember && <span className="ml-2 rounded border border-[var(--border)] px-1 text-[10.5px] text-[var(--ink3)]">Guest</span>}
            </p>
            <p className="truncate text-[12px] text-[var(--ink3)]">{a.email}</p>
            {a.comment && <p className="mt-1 text-[12.5px] italic text-[var(--ink2)]">“{a.comment}”</p>}
            {a.proposedStartsAt && a.proposedEndsAt && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink2)]">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                Proposed {dayTime.format(new Date(a.proposedStartsAt))} {formatTime(new Date(a.proposedStartsAt))}–
                {formatTime(new Date(a.proposedEndsAt))}
                {event.isOrganizer && (
                  <button
                    type="button"
                    className="zoiko-btn sm"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: event.id, input: { startsAt: a.proposedStartsAt!, endsAt: a.proposedEndsAt! } })}
                  >
                    Use this time
                  </button>
                )}
              </p>
            )}
          </div>
          <span className="rounded-md border px-2 py-0.5 text-[11.5px] font-semibold" style={pillStyle(a.response)}>
            {RESPONSE_LABEL[a.response]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function describeHistory(entry: EventDetail["history"][number]): string {
  const d = entry.detail as { emails?: string[]; response?: string; changed?: string[]; email?: string; startsAt?: string };
  switch (entry.type) {
    case "INVITED":
      return `${entry.actorName} invited ${d.emails?.length ?? 0} ${d.emails?.length === 1 ? "person" : "people"}`;
    case "REMOVED":
      return `${entry.actorName} removed ${d.emails?.join(", ") ?? "someone"}`;
    case "RESPONDED":
      return `${entry.actorName} ${({ ACCEPTED: "accepted", TENTATIVE: "tentatively accepted", DECLINED: "declined" } as Record<string, string>)[d.response ?? ""] ?? "responded"}`;
    case "PROPOSED_TIME":
      return `${entry.actorName} proposed ${d.startsAt ? `${dayTime.format(new Date(d.startsAt))} ${formatTime(new Date(d.startsAt))}` : "a new time"}`;
    case "UPDATED":
      return `${entry.actorName} changed the ${d.changed?.join(", ") ?? "meeting"}`;
    default:
      return entry.actorName;
  }
}

function HistoryList({ event, compact = false }: { event: EventDetail; compact?: boolean }) {
  const entries = compact ? event.history.slice(0, 5) : event.history;
  if (entries.length === 0) return <p className="text-[12.5px] text-[var(--ink3)]">No activity yet.</p>;
  return (
    <ol className="relative space-y-3 border-l border-[var(--border)] pl-4" data-testid={compact ? undefined : "history-list"}>
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" aria-hidden />
          <p className="text-[12.5px] font-medium text-[var(--ink)]">{describeHistory(entry)}</p>
          <p className="text-[11.5px] text-[var(--ink3)]">{stamp.format(new Date(entry.createdAt))}</p>
        </li>
      ))}
    </ol>
  );
}

