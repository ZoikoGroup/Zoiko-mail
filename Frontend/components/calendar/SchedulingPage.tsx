"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Inbox,
  Link2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import type { BookingLink, BookingLinkInput, GuestBookingView } from "@/lib/calendar-api";
import {
  useAccessibleCalendars,
  useBookingLinkSlots,
  useBookingLinks,
  useCancelGuestBooking,
  useCreateBookingLink,
  useDecideGuestBooking,
  useDeleteBookingLink,
  useGuestBookings,
  usePrefs,
  useUpdateBookingLink,
} from "@/lib/calendar-hooks";
import { addMonths, formatTime, localZone, preferredZone, startOfMonth } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { SlotPicker } from "./SlotPicker";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { ErrorState } from "@/components/ui/ErrorState";

type Tab = "mine" | "team" | "requests";
const DAYS = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
] as const;
const LOCATION: Record<BookingLink["locationType"], { label: string; icon: typeof Video }> = {
  VIDEO: { label: "Video call", icon: Video },
  PHONE: { label: "Phone call", icon: Phone },
  IN_PERSON: { label: "In person", icon: MapPin },
};
const STATUS_HEX: Record<BookingLink["status"], string> = { PUBLISHED: "#22B07D", DRAFT: "#E0A33A", PAUSED: "#7C8DA6" };
const STATUS_TEXT: Record<BookingLink["status"], string> = { PUBLISHED: "Published", DRAFT: "Draft", PAUSED: "Paused" };
const when = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

function pill(hex: string) {
  return { color: hex, borderColor: `color-mix(in srgb, ${hex} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${hex} 14%, transparent)` };
}

function timeZones(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all?.length) return all;
  } catch {
    // Older browsers: a short list.
  }
  return ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"];
}

export function bookingUrl(slug: string): string {
  return `${typeof window === "undefined" ? "" : window.location.origin}/book/${slug}`;
}

/** Scheduling Links: booking pages, their rules and preview, and the bookings made through them. */
export function SchedulingPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "requests" ? "requests" : params.get("tab") === "team" ? "team" : "mine";
  const setTab = (next: Tab) => router.replace(next === "mine" ? "/mail/calendar/scheduling" : `/mail/calendar/scheduling?tab=${next}`, { scroll: false });

  const links = useBookingLinks();
  const requests = useGuestBookings();
  const create = useCreateBookingLink();
  const prefs = usePrefs();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const all = useMemo(() => links.data ?? [], [links.data]);
  const mine = all.filter((l) => l.isMine && l.kind === "PERSONAL");
  const team = all.filter((l) => l.kind === "TEAM");
  const listed = (tab === "team" ? team : mine).filter((l) => !query || l.title.toLowerCase().includes(query.toLowerCase()));
  const pendingCount = (requests.data ?? []).filter((r) => r.status === "PENDING").length;
  const selected = all.find((l) => l.id === selectedId) ?? listed[0] ?? null;

  useEffect(() => {
    if (!selectedId && listed[0]) setSelectedId(listed[0].id);
  }, [listed, selectedId]);

  const newLink = () =>
    create.mutate(
      // Starts from the working hours in Calendar Settings.
      { title: "New booking link", timeZone: preferredZone(), weekdays: prefs.workDays, dayStart: prefs.workStart, dayEnd: prefs.workEnd, status: "DRAFT" },
      {
        onSuccess: (link) => {
          setTab("mine");
          setSelectedId(link.id);
        },
      }
    );

  return (
    <CalendarWorkspace active="scheduling">
      <CalendarPageHeader
        icon={Link2}
        eyebrow="Calendar / Scheduling"
        title="Scheduling Links & Appointment Booking"
        subtitle="Create personal or team booking pages. Control availability, meeting rules, and guest access."
        actions={
          <>
            <button
              type="button"
              className="zoiko-btn"
              onClick={() => {
                void links.refetch();
                void requests.refetch();
              }}
            >
              <RefreshCw className={`h-4 w-4 ${links.isFetching ? "animate-spin" : ""}`} aria-hidden /> Refresh
            </button>
            <button type="button" className="zoiko-btn pri" onClick={newLink} disabled={create.isPending}>
              <Plus className="h-4 w-4" aria-hidden /> New booking link
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="scheduling-stats">
        <Stat icon={Link2} hex="#3B7BF6" value={all.length} label="Booking links" hint={`${mine.length} personal · ${team.length} team`} />
        <Stat icon={CheckCircle2} hex="#22B07D" value={all.filter((l) => l.status === "PUBLISHED").length} label="Published links" hint="Open to guests now" />
        <Stat icon={Clock} hex="#E0A33A" value={pendingCount} label="Pending requests" hint="Awaiting host review" />
        <Stat icon={Globe} hex="#8B6CF6" value={new Set(all.map((l) => l.timeZone)).size || 1} label="Availability time zones" hint={selected?.timeZone ?? localZone().zone} />
      </div>

      <div role="tablist" aria-label="Scheduling" className="mb-4 flex gap-1 border-b border-[var(--border)]">
        {(
          [
            ["mine", "My Links", 0],
            ["team", "Team Links", 0],
            ["requests", "Booking Requests", pendingCount],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-[13.5px] ${
              tab === key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink2)] hover:text-[var(--ink)]"
            }`}
          >
            {label}
            {n > 0 && <span className="text-[#E0A33A]">({n})</span>}
          </button>
        ))}
      </div>

      {tab === "requests" ? (
        <RequestList requests={requests.data ?? []} loading={requests.isLoading}
          loadError={requests.data ? null : (requests.error as Error | null)}
          onRetry={() => void requests.refetch()}
        />
      ) : (
        <div className="grid min-h-[600px] flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <section aria-label="Booking links" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--ink)]">{tab === "team" ? "Team booking links" : "My booking links"}</h2>
                <p className="text-[12px] text-[var(--ink3)]">Choose a link to manage</p>
              </div>
              {tab === "mine" && (
                <button type="button" className="zoiko-btn sm" onClick={newLink} disabled={create.isPending}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> New
                </button>
              )}
            </div>
            <div className="border-b border-[var(--border)] p-3">
              <input className="zoiko-input w-full" placeholder="Search booking links…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search booking links" />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="link-list">
              {links.isError && !links.data ? (
                <li>
                  <ErrorState compact message={(links.error as Error).message || undefined} onRetry={() => void links.refetch()} />
                </li>
              ) : links.isLoading ? (
                <li>
                  <BrandLoader variant="compact" label="Loading booking links" onRetry={() => void links.refetch()} />
                </li>
              ) : listed.length === 0 ? (
                <li className="p-4 text-center text-[12.5px] text-[var(--ink3)]">
                  {tab === "team" ? "No links book into a team calendar you belong to." : "No booking links yet. Create one to share your availability."}
                </li>
              ) : (
                listed.map((l) => {
                  const active = selected?.id === l.id;
                  const Loc = LOCATION[l.locationType].icon;
                  return (
                    <li key={l.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(l.id)}
                        aria-current={active ? "true" : undefined}
                        className={`mb-1 flex w-full gap-3 rounded-xl border p-3 text-left transition ${
                          active ? "border-[var(--accent)] bg-[var(--zm-selected)]" : "border-transparent hover:bg-[var(--s2)]"
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]" aria-hidden>
                          <Loc className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{l.title}</span>
                            <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold" style={pill(STATUS_HEX[l.status])}>
                              {STATUS_TEXT[l.status]}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[12px] text-[var(--ink3)]">One-to-one · {LOCATION[l.locationType].label}</span>
                          <span className="block text-[12px] text-[var(--ink3)]">
                            {l.durationMinutes} min · {l.kind === "TEAM" ? `Team · ${l.calendarName}` : "Personal"}
                            {l.pendingCount ? ` · ${l.pendingCount} waiting` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">Guests see only free times — never what fills the rest.</p>
          </section>

          {selected ? (
            <>
              <LinkEditor key={selected.id + selected.updatedAt} link={selected} onDeleted={() => setSelectedId(null)} />
              <GuestPreview link={selected} />
            </>
          ) : (
            <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[13px] text-[var(--ink3)] 2xl:col-span-2">
              {/* While the links load (or fail), the list says so. */}
              {links.isLoading || (links.isError && !links.data) ? null : "Create a booking link to let people pick a time with you."}
            </div>
          )}
        </div>
      )}
    </CalendarWorkspace>
  );
}

function Stat({ icon: Icon, hex, value, label, hint }: { icon: typeof Clock; hex: string; value: number; label: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={pill(hex)} aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-[22px] font-bold leading-none text-[var(--ink)]">{value}</span>
        <span className="mt-1 block text-[13px] font-semibold text-[var(--ink)]">{label}</span>
        <span className="block text-[11.5px] text-[var(--ink3)]">{hint}</span>
      </span>
    </div>
  );
}

const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";
const card = "rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3";

function LinkEditor({ link, onDeleted }: { link: BookingLink; onDeleted: () => void }) {
  const [draft, setDraft] = useState<BookingLinkInput>({});
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateBookingLink();
  const remove = useDeleteBookingLink();
  const accessible = useAccessibleCalendars();
  const writable = (accessible.data ?? []).filter((c) => c.access === "OWNER" || c.access === "EDIT" || c.access === "MANAGE");
  const zones = useMemo(() => timeZones(), []);
  const v = { ...link, ...draft } as BookingLink;
  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof BookingLinkInput>(key: K, value: BookingLinkInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const readOnly = !link.isMine;
  const problem = v.dayStart >= v.dayEnd ? "The day must end after it starts." : v.weekdays.length === 0 ? "Choose at least one day." : !v.title.trim() ? "Give the link a title." : null;

  const save = (extra: BookingLinkInput = {}) => {
    if (problem) return;
    update.mutate({ id: link.id, input: { ...draft, ...extra } }, { onSuccess: () => setDraft({}) });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl(link.slug));
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 3000);
  };
  const Loc = LOCATION[v.locationType].icon;

  return (
    <section aria-label={link.title} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="link-editor">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]" aria-hidden>
          <Loc className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <input
            aria-label="Link title"
            className="w-full bg-transparent text-[20px] font-semibold text-[var(--ink)] focus:outline-none disabled:opacity-100"
            value={v.title}
            disabled={readOnly}
            onChange={(e) => set("title", e.target.value)}
          />
          <p className="text-[12.5px] text-[var(--ink3)]">
            One-to-one · {LOCATION[v.locationType].label}
            {readOnly ? ` · owned by ${link.owner.name}` : ""}
          </p>
        </div>
        <select
          aria-label="Link status"
          className="zoiko-input !w-[140px] font-semibold"
          style={pill(STATUS_HEX[v.status])}
          value={v.status}
          disabled={readOnly}
          onChange={(e) => set("status", e.target.value as BookingLink["status"])}
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="PAUSED">Paused</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 text-[14px] font-semibold text-[var(--ink)]">Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="bl-description" className={label}>
                Description guests see
              </label>
              <textarea
                id="bl-description"
                className="zoiko-input min-h-[56px] w-full"
                disabled={readOnly}
                value={v.description ?? ""}
                placeholder="e.g. Book an introductory conversation with me."
                onChange={(e) => set("description", e.target.value || null)}
              />
            </div>
            <div>
              <label htmlFor="bl-location" className={label}>
                Meeting type
              </label>
              <select id="bl-location" className="zoiko-input w-full" disabled={readOnly} value={v.locationType} onChange={(e) => set("locationType", e.target.value as BookingLink["locationType"])}>
                <option value="VIDEO">Video call</option>
                <option value="PHONE">Phone call</option>
                <option value="IN_PERSON">In person</option>
              </select>
            </div>
            <div>
              <label htmlFor="bl-location-detail" className={label}>
                {v.locationType === "VIDEO" ? "Meeting link" : v.locationType === "PHONE" ? "Phone number" : "Address"}
              </label>
              <input
                id="bl-location-detail"
                className="zoiko-input w-full"
                disabled={readOnly}
                value={v.locationDetail ?? ""}
                placeholder={v.locationType === "VIDEO" ? "https://" : ""}
                onChange={(e) => set("locationDetail", e.target.value || null)}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bl-calendar" className={label}>
                Bookings go in
              </label>
              <select id="bl-calendar" className="zoiko-input w-full" disabled={readOnly} value={v.calendarId} onChange={(e) => set("calendarId", e.target.value)}>
                {writable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.kind === "TEAM" ? " (team)" : ""}
                  </option>
                ))}
                {!writable.some((c) => c.id === v.calendarId) && <option value={v.calendarId}>{link.calendarName}</option>}
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-semibold text-[var(--ink)]">Availability &amp; working hours</h3>
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-[var(--ink)]">Weekly availability</p>
              <select aria-label="Time zone" className="zoiko-input !w-[220px] py-1 text-[12px]" disabled={readOnly} value={v.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Days offered">
              {DAYS.map(([n, name]) => {
                const on = v.weekdays.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={on}
                    onClick={() => set("weekdays", on ? v.weekdays.filter((d) => d !== n) : [...v.weekdays, n].sort())}
                    className={`rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${
                      on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--border)] text-[var(--ink3)]"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ink2)]">
              <label className="flex items-center gap-2">
                From
                <input type="time" aria-label="Day starts" className="zoiko-input !w-[120px] py-1" disabled={readOnly} value={v.dayStart} onChange={(e) => set("dayStart", e.target.value)} />
              </label>
              <label className="flex items-center gap-2">
                to
                <input type="time" aria-label="Day ends" className="zoiko-input !w-[120px] py-1" disabled={readOnly} value={v.dayEnd} onChange={(e) => set("dayEnd", e.target.value)} />
              </label>
              <span className="text-[var(--ink3)]">· Times follow daylight saving in {v.timeZone}</span>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Meeting duration</span>
                <span className="text-[11.5px] text-[var(--ink3)]">How long each booking is</span>
              </span>
              <select aria-label="Meeting duration" className="zoiko-input !w-[110px]" disabled={readOnly} value={v.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))}>
                {[15, 20, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Buffer between meetings</span>
                <span className="text-[11.5px] text-[var(--ink3)]">Prevent back-to-back calls</span>
              </span>
              <select aria-label="Buffer between meetings" className="zoiko-input !w-[110px]" disabled={readOnly} value={v.bufferMinutes} onChange={(e) => set("bufferMinutes", Number(e.target.value))}>
                {[0, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-semibold text-[var(--ink)]">Booking rules</h3>
          <div className="space-y-2">
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Minimum notice</span>
                <span className="text-[11.5px] text-[var(--ink3)]">Guests cannot book at short notice</span>
              </span>
              <select aria-label="Minimum notice" className="zoiko-input !w-[130px]" disabled={readOnly} value={v.minNoticeHours} onChange={(e) => set("minNoticeHours", Number(e.target.value))}>
                {[0, 1, 2, 4, 12, 24, 48, 72].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? "None" : `${h} hour${h > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Booking window</span>
                <span className="text-[11.5px] text-[var(--ink3)]">How far ahead guests can book</span>
              </span>
              <select aria-label="Booking window" className="zoiko-input !w-[130px]" disabled={readOnly} value={v.maxDaysAhead} onChange={(e) => set("maxDaysAhead", Number(e.target.value))}>
                {[7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </div>
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Calendar conflict check</span>
                <span className="text-[11.5px] text-[var(--ink3)]">Your busy time and accepted meetings are never offered</span>
              </span>
              <span className="flex items-center gap-1 text-[12.5px] font-semibold text-[#22B07D]">
                <Check className="h-4 w-4" aria-hidden /> Required
              </span>
            </div>
            <label className={`${card} flex cursor-pointer items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Host approves each booking</span>
                <span className="text-[11.5px] text-[var(--ink3)]">Bookings wait under Booking Requests; the slot is held</span>
              </span>
              <input type="checkbox" disabled={readOnly} checked={v.requiresApproval} onChange={(e) => set("requiresApproval", e.target.checked)} aria-label="Host approves each booking" />
            </label>
          </div>
        </section>

        {problem && <p className="text-[12px] text-[var(--crit)]">{problem}</p>}
        {(update.error || remove.error) && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {((update.error ?? remove.error) as Error).message}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4">
        <button type="button" className="zoiko-btn" onClick={() => void copy()} disabled={link.status !== "PUBLISHED"} title={link.status !== "PUBLISHED" ? "Publish the link to share it" : undefined}>
          <Copy className="h-4 w-4" aria-hidden /> {copied === "ok" ? "Link copied" : copied === "failed" ? "Copy failed" : "Share link"}
        </button>
        <a
          className={`zoiko-btn ${link.status !== "PUBLISHED" ? "pointer-events-none opacity-50" : ""}`}
          href={`/book/${link.slug}`}
          target="_blank"
          rel="noreferrer"
          aria-disabled={link.status !== "PUBLISHED"}
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Preview
        </a>
        {link.isMine &&
          (confirmDelete ? (
            <span className="flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
              Delete this link?
              <button type="button" className="zoiko-btn sm text-[var(--crit)]" disabled={remove.isPending} onClick={() => remove.mutate(link.id, { onSuccess: onDeleted })}>
                Yes, delete
              </button>
              <button type="button" className="zoiko-btn sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="zoiko-btn" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </button>
          ))}
        {link.isMine && (
          <button type="button" className="zoiko-btn pri ml-auto" onClick={() => save()} disabled={!dirty || update.isPending || Boolean(problem)}>
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        )}
        {link.status === "PUBLISHED" && (
          <p className="w-full truncate text-[11.5px] text-[var(--ink3)]" data-testid="share-url">
            {bookingUrl(link.slug)}
          </p>
        )}
      </div>
    </section>
  );
}

/** What a guest sees, using the link's real free times (works for drafts too). */
function GuestPreview({ link }: { link: BookingLink }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [day, setDay] = useState<Date | null>(null);
  const from = useMemo(() => new Date(Math.max(month.getTime(), Date.now())), [month]);
  const to = useMemo(() => addMonths(month, 1), [month]);
  const slots = useBookingLinkSlots(link.id, from, to);
  const list = useMemo(() => slots.data ?? [], [slots.data]);
  useEffect(() => {
    if (!day && list[0]) {
      const d = new Date(list[0].start);
      setDay(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }, [list, day]);
  const Loc = LOCATION[link.locationType].icon;
  return (
    <aside className="hidden flex-col gap-3 2xl:flex" aria-label="Guest booking page preview">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">Guest booking page preview</h3>
            <p className="text-[12px] text-[var(--ink3)]">What visitors can see</p>
          </div>
          <span className="flex items-center gap-1.5 text-[12px] text-[#22B07D]">
            <span className="h-2 w-2 rounded-full bg-[#22B07D]" aria-hidden /> Preview
          </span>
        </div>
        <div className="rounded-xl bg-white p-4 text-[#0E1B2E] shadow" data-testid="guest-preview">
          <p className="text-[13px] font-bold tracking-wide text-[#2563EB]">ZOIKOMAIL</p>
          <h4 className="mt-2 text-[18px] font-bold">{link.title}</h4>
          {link.description && <p className="mt-1 text-[12.5px] text-[#3A4B63]">{link.description}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
            <span className="flex items-center gap-1 rounded-md border border-[#DCE4EF] px-2 py-1">
              <Clock className="h-3 w-3" aria-hidden /> {link.durationMinutes} minutes
            </span>
            <span className="flex items-center gap-1 rounded-md border border-[#DCE4EF] px-2 py-1">
              <Loc className="h-3 w-3" aria-hidden /> {LOCATION[link.locationType].label}
            </span>
            <span className="flex items-center gap-1 rounded-md border border-[#DCE4EF] px-2 py-1">
              <Globe className="h-3 w-3" aria-hidden /> Your local time
            </span>
          </div>
          <div className="zm-light-preview mt-3 [--accent:#2563EB] [--accent-ink:#1D4ED8] [--accent-soft:#E3ECFD] [--ink:#0E1B2E] [--ink2:#3A4B63] [--ink3:#66788F] [--s2:#F5F8FC] [--border:#DCE4EF]">
            <SlotPicker month={month} onMonthChange={setMonth} slots={list} selectedDay={day} onSelectDay={setDay} compact loading={slots.isLoading} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={`/book/${link.slug}`}
            target="_blank"
            rel="noreferrer"
            className={`zoiko-btn justify-center ${link.status !== "PUBLISHED" ? "pointer-events-none opacity-50" : ""}`}
          >
            Open preview <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <a
            href={`/book/${link.slug}`}
            target="_blank"
            rel="noreferrer"
            className={`zoiko-btn pri justify-center ${link.status !== "PUBLISHED" ? "pointer-events-none opacity-50" : ""}`}
          >
            Continue <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
        {link.status !== "PUBLISHED" && <p className="mt-2 text-[11.5px] text-[var(--ink3)]">Publish the link to open it as a guest.</p>}
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink)]">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Privacy &amp; confirmation
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink3)]">
          Every booking is checked against your calendar at the moment it is made, so a time is never given twice. Guests never see what fills your calendar.
        </p>
      </div>
    </aside>
  );
}

const REQUEST_HEX: Record<GuestBookingView["status"], string> = { PENDING: "#E0A33A", CONFIRMED: "#22B07D", DECLINED: "#E5484D", CANCELLED: "#7C8DA6" };
const REQUEST_TEXT: Record<GuestBookingView["status"], string> = { PENDING: "Awaiting your review", CONFIRMED: "Confirmed", DECLINED: "Declined", CANCELLED: "Cancelled" };

function RequestList({
  requests,
  loading,
  loadError,
  onRetry,
}: {
  requests: GuestBookingView[];
  loading: boolean;
  /** The first load failed: there is nothing to show. */
  loadError: Error | null;
  onRetry: () => void;
}) {
  const decide = useDecideGuestBooking();
  const cancel = useCancelGuestBooking();
  const sorted = [...requests].sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || a.startsAt.localeCompare(b.startsAt));
  const error = (decide.error ?? cancel.error) as Error | null;
  return (
    <section aria-label="Booking requests" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="booking-requests">
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-[16px] font-semibold text-[var(--ink)]">Booking requests</h2>
      {loadError ? (
        <ErrorState compact message={loadError.message || undefined} onRetry={onRetry} />
      ) : loading ? (
        <BrandLoader variant="compact" label="Loading booking requests" onRetry={onRetry} />
      ) : sorted.length === 0 ? (
        <p className="flex items-center justify-center gap-2 p-8 text-[13px] text-[var(--ink3)]">
          <Inbox className="h-4 w-4" aria-hidden /> No bookings through your links yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sorted.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-[12px] font-semibold text-white" aria-hidden>
                {r.guestName
                  .split(/\s+/)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">
                  {r.guestName} · {r.link.title}
                </span>
                <span className="block truncate text-[12px] text-[var(--ink3)]">
                  <CalendarClock className="mr-1 inline h-3 w-3" aria-hidden />
                  {when.format(new Date(r.startsAt))} · {formatTime(new Date(r.startsAt))}–{formatTime(new Date(r.endsAt))} · {r.guestEmail}
                </span>
                {r.notes && <span className="mt-0.5 block truncate text-[12px] italic text-[var(--ink2)]">“{r.notes}”</span>}
              </span>
              <span className="rounded-md border px-2 py-0.5 text-[11px] font-semibold" style={pill(REQUEST_HEX[r.status])}>
                {REQUEST_TEXT[r.status]}
              </span>
              {r.status === "PENDING" ? (
                <span className="flex gap-2">
                  <button type="button" className="zoiko-btn sm pri" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}>
                    Confirm
                  </button>
                  <button type="button" className="zoiko-btn sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}>
                    Decline
                  </button>
                </span>
              ) : r.status === "CONFIRMED" && new Date(r.endsAt) > new Date() ? (
                <button type="button" className="zoiko-btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                  Cancel
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="px-4 pb-3 text-[12px] text-[var(--crit)]">
          {error.message}
        </p>
      )}
      <p className="flex items-center gap-1.5 border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">
        <Users className="h-3.5 w-3.5" aria-hidden /> Confirming puts the meeting in your calendar with the guest invited. Guests are not emailed while system email is off.
      </p>
    </section>
  );
}
