"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  DoorOpen,
  LayoutGrid,
  MapPin,
  MonitorSpeaker,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Settings2,
  Users,
} from "lucide-react";
import type { BoardBooking, CalendarResource, ResourceBookingView } from "@/lib/calendar-api";
import {
  useCancelBooking,
  useDecideBooking,
  useMyBookings,
  usePendingBookings,
  useResourceBoard,
  useResources,
  useUpdateResource,
} from "@/lib/calendar-hooks";
import { addDays, formatTime, fromInputs, localZone, startOfDay, toDateInput } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { BookingDialog, FeatureList, ResourceEditDialog } from "./ResourceDialogs";

type RoomsView = "board" | "mine" | "pending" | "manage";
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16];
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const when = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

const TONE = {
  free: "#22B07D",
  approval: "#E0A33A",
  booked: "#3B7BF6",
  mine: "#8B6CF6",
  closed: "#7C8DA6",
} as const;

function tint(hex: string, fill = 18, line = 55) {
  return { backgroundColor: `color-mix(in srgb, ${hex} ${fill}%, var(--surface))`, borderColor: `color-mix(in srgb, ${hex} ${line}%, transparent)` };
}

type Cell =
  | { state: "free" | "approval" }
  | { state: "booked"; booking: BoardBooking }
  | { state: "closed" };

/** What one resource is doing in the hour starting at `hour` on `day`. */
function cellFor(resource: CalendarResource, bookings: BoardBooking[], day: Date, hour: number): Cell {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
  const end = new Date(start.getTime() + 3_600_000);
  const booking = bookings.find((b) => b.resourceId === resource.id && new Date(b.startsAt) < end && new Date(b.endsAt) > start);
  if (booking) return { state: "booked", booking };
  if (end.getTime() <= Date.now()) return { state: "closed" };
  return { state: resource.requiresApproval ? "approval" : "free" };
}

/** Meeting Rooms & Resources: the availability board, my reservations, and approvals. */
export function RoomsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const zone = useMemo(() => localZone(), []);
  const view = (params.get("view") as RoomsView) ?? "board";
  const setView = (next: RoomsView) => router.replace(next === "board" ? "/mail/calendar/rooms" : `/mail/calendar/rooms?view=${next}`, { scroll: false });

  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [query, setQuery] = useState("");
  const [minSeats, setMinSeats] = useState(0);
  const [location, setLocation] = useState("");
  const [feature, setFeature] = useState("");
  const [kind, setKind] = useState<"" | "ROOM" | "EQUIPMENT">("");
  const [selected, setSelected] = useState<{ resourceId: string; hour: number } | null>(null);
  const [attendees, setAttendees] = useState(1);
  const [dialog, setDialog] = useState<
    | { kind: "book"; resource: CalendarResource; start: Date; end: Date; choose?: boolean }
    | { kind: "edit"; resource: CalendarResource | null }
    | null
  >(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);

  const board = useResourceBoard(day, addDays(day, 1));
  const resources = useMemo(() => board.data?.resources ?? [], [board.data]);
  const bookings = useMemo(() => board.data?.bookings ?? [], [board.data]);
  const pending = usePendingBookings(true);
  const isManager = pending.isSuccess;
  const mine = useMyBookings();

  const locations = useMemo(() => Array.from(new Set(resources.map((r) => r.location).filter((l): l is string => Boolean(l)))).sort(), [resources]);
  const features = useMemo(() => Array.from(new Set(resources.flatMap((r) => r.features))).sort(), [resources]);
  const filtered = resources.filter(
    (r) =>
      (!query || `${r.name} ${r.location ?? ""} ${r.floor ?? ""}`.toLowerCase().includes(query.toLowerCase())) &&
      (!minSeats || (r.capacity ?? 0) >= minSeats) &&
      (!location || r.location === location) &&
      (!feature || r.features.includes(feature)) &&
      (!kind || r.kind === kind)
  );
  const counts = { rooms: resources.filter((r) => r.kind === "ROOM").length, equipment: resources.filter((r) => r.kind === "EQUIPMENT").length };

  // Start on the first resource with a free hour, so the panel is never empty.
  useEffect(() => {
    if (selected || filtered.length === 0) return;
    for (const r of filtered) {
      const hour = HOURS.find((h) => {
        const c = cellFor(r, bookings, day, h);
        return c.state === "free" || c.state === "approval";
      });
      if (hour !== undefined) {
        setSelected({ resourceId: r.id, hour });
        return;
      }
    }
  }, [filtered, bookings, day, selected]);

  const selectedResource = resources.find((r) => r.id === selected?.resourceId) ?? null;
  const selectedCell = selectedResource && selected ? cellFor(selectedResource, bookings, day, selected.hour) : null;
  const slotStart = selected ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), selected.hour) : null;
  const slotEnd = slotStart ? new Date(slotStart.getTime() + 3_600_000) : null;
  const alternatives = selected
    ? resources.filter((r) => {
        if (r.id === selected.resourceId || r.kind !== selectedResource?.kind) return false;
        if (r.capacity && r.capacity < attendees) return false;
        const c = cellFor(r, bookings, day, selected.hour);
        return c.state === "free" || c.state === "approval";
      })
    : [];

  /**
   * "New booking" always leads somewhere: the selected free slot if there is
   * one, otherwise the booking form at the next half hour with a choice of
   * room. With no rooms at all, Owners and Admins are taken to add one and
   * everyone else is told why there is nothing to book.
   */
  function startNewBooking() {
    setView("board");
    const bookable = resources.filter((r) => r.isActive);
    if (bookable.length === 0) {
      if (isManager) setDialog({ kind: "edit", resource: null });
      else setNotice({ text: "There are no rooms or resources to book yet. A workspace Owner or Admin needs to add them first.", tone: "warn" });
      return;
    }
    if (selectedResource && slotStart && slotEnd && (selectedCell?.state === "free" || selectedCell?.state === "approval")) {
      setDialog({ kind: "book", resource: selectedResource, start: slotStart, end: slotEnd, choose: true });
      return;
    }
    const start = new Date();
    if (day > start) start.setTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).getTime());
    else start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
    setDialog({ kind: "book", resource: bookable[0]!, start, end: new Date(start.getTime() + 3_600_000), choose: true });
  }

  const sidebarSection = (
    <>
      <div className="px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Resource categories</h2>
      </div>
      <ul className="space-y-0.5">
        {(
          [
            ["ROOM", "Meeting rooms", DoorOpen, counts.rooms],
            ["EQUIPMENT", "Equipment", MonitorSpeaker, counts.equipment],
          ] as const
        ).map(([key, text, Icon, n]) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => {
                setKind(kind === key ? "" : key);
                setView("board");
              }}
              aria-pressed={kind === key}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] ${
                kind === key ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)]" : "text-[var(--ink2)] hover:bg-[var(--s2)]"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {text}
              <span className="ml-auto rounded-md bg-[var(--s2)] px-1.5 text-[11px] text-[var(--ink2)]">{n}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Booking workspace</h2>
      </div>
      <ul className="space-y-0.5">
        {(
          [
            ["board", "Availability board", LayoutGrid, null],
            ["mine", "My reservations", CalendarCheck, (mine.data ?? []).filter((b) => b.status === "CONFIRMED" || b.status === "PENDING").length],
            ...(isManager ? ([["pending", "Pending approvals", ShieldCheck, pending.data?.length ?? 0]] as const) : []),
            ...(isManager ? ([["manage", "Manage resources", Settings2, null]] as const) : []),
          ] as const
        ).map(([key, text, Icon, n]) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => setView(key as RoomsView)}
              aria-current={view === key ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] ${
                view === key ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)]" : "text-[var(--ink2)] hover:bg-[var(--s2)]"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {text}
              {n ? (
                <span className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {n}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="m-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
        <p className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--ink)]">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Resource access
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--ink3)]">
          Anyone in the workspace can book. Some resources need approval from an Owner or Admin. A room is never booked twice.
        </p>
      </div>
    </>
  );

  return (
    <CalendarWorkspace active="rooms" sidebarSection={sidebarSection}>
      <CalendarPageHeader
        icon={DoorOpen}
        eyebrow="Calendar / Resource booking"
        title="Meeting Rooms & Resources"
        subtitle="Find the right space, compare availability and request bookings within your organisation."
        actions={
          <>
            <button type="button" className="zoiko-btn" onClick={() => setView("mine")}>
              <CalendarCheck className="h-4 w-4" aria-hidden /> My reservations
            </button>
            {isManager && (
              <button type="button" className="zoiko-btn" onClick={() => setDialog({ kind: "edit", resource: null })}>
                <Plus className="h-4 w-4" aria-hidden /> Add resource
              </button>
            )}
            <button type="button" className="zoiko-btn pri" onClick={startNewBooking}>
              <Plus className="h-4 w-4" aria-hidden /> New booking
            </button>
          </>
        }
      />

      {notice && (
        <p
          role="status"
          className={`mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${
            notice.tone === "ok"
              ? "border-[#22B07D]/50 bg-[color-mix(in_srgb,#22B07D_12%,transparent)] text-[#4FD1A1]"
              : "border-[#E0A33A]/50 bg-[color-mix(in_srgb,#E0A33A_12%,transparent)] text-[#F2C46D]"
          }`}
        >
          <Check className="h-4 w-4" aria-hidden /> {notice.text}
        </p>
      )}

      {view === "mine" && <BookingList title="My reservations" query={mine} mode="mine" />}
      {view === "pending" && isManager && <BookingList title="Pending approvals" query={pending} mode="pending" />}
      {view === "manage" && isManager && <ManageResources onEdit={(r) => setDialog({ kind: "edit", resource: r })} />}

      {view === "board" && (
        <div className="flex min-h-[620px] flex-1 gap-4">
          <section aria-label="Availability board" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-[17px] font-semibold text-[var(--ink)]">
                Availability board <span className="ml-2 text-[13px] font-normal text-[var(--ink3)]">{longDay.format(day)}</span>
              </h2>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  aria-label="Day"
                  className="zoiko-input !w-[170px]"
                  value={toDateInput(day)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setDay(fromInputs(e.target.value, "00:00"));
                    setSelected(null);
                  }}
                />
                <span className="text-[12px] text-[var(--ink3)]">{zone.offsetLabel.replace("GMT", "UTC")}</span>
                <button
                  type="button"
                  className="zoiko-btn"
                  onClick={() => {
                    setMinSeats(Math.max(minSeats, attendees));
                    setSelected(null);
                  }}
                >
                  <Search className="h-4 w-4" aria-hidden /> Find a space
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              <label className="relative min-w-[220px] flex-1">
                <span className="sr-only">Search rooms or equipment</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
                <input className="zoiko-input w-full" style={{ paddingLeft: 34 }} placeholder="Search rooms or equipment…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <select aria-label="Capacity" className="zoiko-input !w-[150px]" value={minSeats} onChange={(e) => setMinSeats(Number(e.target.value))}>
                <option value={0}>Any capacity</option>
                {[2, 4, 6, 8, 12, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}+ seats
                  </option>
                ))}
              </select>
              <select aria-label="Location" className="zoiko-input !w-[160px]" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
              <select aria-label="Features" className="zoiko-input !w-[170px]" value={feature} onChange={(e) => setFeature(e.target.value)}>
                <option value="">All features</option>
                {features.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="availability-board">
              {board.isLoading ? (
                <p className="text-[13px] text-[var(--ink3)]">Loading…</p>
              ) : board.isError ? (
                <p role="alert" className="p-6 text-center text-[13px] text-[var(--crit)]">
                  Could not load rooms and resources. {(board.error as Error).message}
                </p>
              ) : resources.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-10 text-center">
                  <DoorOpen className="h-10 w-10 text-[var(--accent-ink)]" aria-hidden />
                  <h3 className="mt-3 text-[17px] font-semibold text-[var(--ink)]">No rooms or resources yet</h3>
                  <p className="mt-1 max-w-md text-[13px] text-[var(--ink2)]">
                    {isManager ? "Add your meeting rooms and shared equipment so people can book them." : "Ask a workspace Owner or Admin to add the rooms people can book."}
                  </p>
                  {isManager && (
                    <button type="button" className="zoiko-btn pri mt-4" onClick={() => setDialog({ kind: "edit", resource: null })}>
                      <Plus className="h-4 w-4" aria-hidden /> Add resource
                    </button>
                  )}
                </div>
              ) : filtered.length === 0 ? (
                <p className="p-6 text-center text-[13px] text-[var(--ink3)]">No resource matches these filters.</p>
              ) : (
                <table className="w-full min-w-[860px] border-separate border-spacing-1.5 text-[12px]">
                  <thead>
                    <tr className="text-[12px] text-[var(--ink2)]">
                      <th className="w-[200px] rounded-lg bg-[var(--s2)] px-3 py-2.5 text-left font-semibold">Room / resource</th>
                      {HOURS.map((h) => (
                        <th key={h} className="rounded-lg bg-[var(--s2)] py-2.5 font-semibold tabular-nums">
                          {String(h).padStart(2, "0")}:00
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <th scope="row" className={`rounded-lg px-3 py-2 text-left font-normal ${selected?.resourceId === r.id ? "bg-[var(--zm-selected)]" : "bg-[var(--s2)]"}`}>
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink2)]" aria-hidden>
                              {r.kind === "ROOM" ? <DoorOpen className="h-4 w-4" /> : <MonitorSpeaker className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{r.name}</span>
                              <span className="block truncate text-[11px] text-[var(--ink3)]">
                                {r.kind === "ROOM" ? `${r.capacity ?? "?"} seats` : "Equipment"}
                                {r.floor ? ` · ${r.floor}` : r.location ? ` · ${r.location}` : ""}
                              </span>
                            </span>
                          </span>
                        </th>
                        {HOURS.map((h) => {
                          const cell = cellFor(r, bookings, day, h);
                          const isSelected = selected?.resourceId === r.id && selected.hour === h;
                          if (cell.state === "booked") {
                            const tone = cell.booking.isMine ? TONE.mine : cell.booking.status === "PENDING" ? TONE.approval : TONE.booked;
                            return (
                              <td key={h} className="h-[64px] rounded-lg border p-1.5 text-center align-middle" style={tint(tone)}>
                                <span className="block truncate text-[11.5px] font-semibold text-[var(--ink)]" title={`${cell.booking.title} · ${cell.booking.bookedBy}`}>
                                  {cell.booking.title}
                                </span>
                                <span className="block text-[10.5px] text-[var(--ink2)]">{cell.booking.status === "PENDING" ? "Pending approval" : cell.booking.isMine ? "Yours" : "Reserved"}</span>
                              </td>
                            );
                          }
                          if (cell.state === "closed") {
                            return (
                              <td key={h} className="h-[64px] rounded-lg border border-dashed text-center align-middle text-[11.5px] text-[var(--ink3)]" style={tint(TONE.closed, 8, 40)}>
                                Unavailable
                              </td>
                            );
                          }
                          const tone = cell.state === "approval" ? TONE.approval : TONE.free;
                          return (
                            <td key={h} className="h-[64px] p-0 align-middle">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelected({ resourceId: r.id, hour: h });
                                  setShowAlternatives(false);
                                }}
                                aria-pressed={isSelected}
                                aria-label={`${r.name} ${String(h).padStart(2, "0")}:00 ${cell.state === "approval" ? "approval needed" : "available"}`}
                                className={`flex h-full w-full flex-col items-center justify-center rounded-lg border text-[11.5px] font-semibold transition hover:brightness-125 ${
                                  isSelected ? "ring-2 ring-[var(--accent-ink)]" : ""
                                }`}
                                style={isSelected ? { backgroundColor: "var(--accent)", borderColor: "var(--accent)", color: "#fff" } : { ...tint(tone), color: tone }}
                              >
                                {cell.state === "approval" ? "Approval needed" : "Available"}
                                {cell.state === "approval" && <span className="text-[10px] font-normal opacity-80">Request only</span>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--ink2)]">
              <span className="flex flex-wrap gap-4">
                {(
                  [
                    ["Available", TONE.free],
                    ["Booked", TONE.booked],
                    ["Yours", TONE.mine],
                    ["Approval needed", TONE.approval],
                    ["Unavailable", TONE.closed],
                  ] as const
                ).map(([text, hex]) => (
                  <span key={text} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hex }} aria-hidden /> {text}
                  </span>
                ))}
              </span>
              <span className="text-[var(--ink3)]">Click an available slot to review it</span>
            </div>
            <p className="flex items-start gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <b className="text-[var(--ink2)]">Booking safeguard:</b> the server checks availability and capacity again when you confirm, so a room is never booked twice — even if two people ask at the same moment.
              </span>
            </p>
          </section>

          <aside className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex" aria-label="Booking">
            {selectedResource ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="resource-card">
                <div className="flex items-center justify-between">
                  <h3 className="text-[16px] font-semibold text-[var(--ink)]">{selectedResource.name}</h3>
                  <span className="rounded-md border border-[var(--accent)]/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
                    {selectedResource.kind === "ROOM" ? "Meeting space" : "Equipment"}
                  </span>
                </div>
                <div className="relative mt-3 flex h-[110px] items-end overflow-hidden rounded-xl border border-[var(--border)] bg-[radial-gradient(circle_at_30%_20%,color-mix(in_srgb,var(--accent)_45%,transparent),transparent_60%),linear-gradient(135deg,#1a2a44,#0d1828)] p-2">
                  {selectedResource.kind === "ROOM" ? <DoorOpen className="absolute right-4 top-4 h-10 w-10 text-white/30" aria-hidden /> : <MonitorSpeaker className="absolute right-4 top-4 h-10 w-10 text-white/30" aria-hidden />}
                  {(selectedResource.location || selectedResource.floor) && (
                    <span className="rounded-md bg-black/50 px-2 py-0.5 text-[11px] text-white">
                      {[selectedResource.location, selectedResource.floor].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex justify-between text-[12.5px] text-[var(--ink2)]">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" aria-hidden /> {selectedResource.capacity ? `${selectedResource.capacity} seats` : "—"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {[selectedResource.floor, selectedResource.location].filter(Boolean).join(" · ") || "—"}
                  </span>
                </div>
                <div className="mt-3">
                  <FeatureList features={selectedResource.features} />
                </div>
                <p className="mt-3 text-[12.5px] font-semibold text-[var(--ink)]">Reservation policy</p>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink3)]">
                  {selectedResource.description ||
                    (selectedResource.requiresApproval
                      ? "Bookings need approval from an Owner or Admin. The slot is held while they decide."
                      : "Bookings are confirmed straight away when the slot is free.")}
                </p>
              </div>
            ) : null}

            {selectedResource && slotStart && slotEnd && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="booking-preview">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold text-[var(--ink)]">Booking preview</h3>
                  <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">Unconfirmed</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  {(
                    [
                      ["Date", shortDay.format(slotStart)],
                      ["Selected time", `${formatTime(slotStart)}–${formatTime(slotEnd)}`],
                    ] as const
                  ).map(([term, value]) => (
                    <div key={term} className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-2">
                      <dt className="text-[var(--ink3)]">{term}</dt>
                      <dd className="font-semibold text-[var(--ink)]">{value}</dd>
                    </div>
                  ))}
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-2">
                    <dt>
                      <label htmlFor="bp-attendees" className="text-[var(--ink3)]">
                        Attendees
                      </label>
                    </dt>
                    <dd>
                      <input
                        id="bp-attendees"
                        type="number"
                        min={1}
                        className="w-full bg-transparent font-semibold text-[var(--ink)] focus:outline-none"
                        value={attendees}
                        onChange={(e) => setAttendees(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </dd>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-2">
                    <dt className="text-[var(--ink3)]">{selectedResource.kind === "ROOM" ? "Room" : "Resource"}</dt>
                    <dd className="truncate font-semibold text-[var(--ink)]">{selectedResource.name}</dd>
                  </div>
                </dl>
                {selectedResource.capacity && attendees > selectedResource.capacity ? (
                  <p className="mt-3 rounded-xl border border-[#E5484D]/50 bg-[color-mix(in_srgb,#E5484D_12%,transparent)] px-3 py-2 text-[12px] text-[#F06A6E]">
                    Seats {selectedResource.capacity} — too small for {attendees}. See alternatives.
                  </p>
                ) : selectedCell?.state === "approval" ? (
                  <p className="mt-3 rounded-xl border border-[#E0A33A]/50 bg-[color-mix(in_srgb,#E0A33A_12%,transparent)] px-3 py-2 text-[12px] text-[#F2C46D]">
                    Free, but needs approval. The slot is held while an Owner or Admin decides.
                  </p>
                ) : selectedCell?.state === "free" ? (
                  <p className="mt-3 rounded-xl border border-[#22B07D]/50 bg-[color-mix(in_srgb,#22B07D_12%,transparent)] px-3 py-2 text-[12px] text-[#4FD1A1]">
                    Available. Checked again when you confirm.
                  </p>
                ) : (
                  <p className="mt-3 text-[12px] text-[var(--ink3)]">This slot is taken. Choose an available one.</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="zoiko-btn pri flex-1 justify-center whitespace-nowrap"
                    disabled={!(selectedCell?.state === "free" || selectedCell?.state === "approval")}
                    onClick={() => setDialog({ kind: "book", resource: selectedResource, start: slotStart, end: slotEnd })}
                  >
                    Review booking <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                  <button type="button" className="zoiko-btn flex-1 justify-center" onClick={() => setShowAlternatives((v) => !v)} aria-expanded={showAlternatives}>
                    Alternatives
                  </button>
                </div>
                {showAlternatives && (
                  <ul className="mt-3 space-y-1.5" data-testid="alternatives">
                    {alternatives.length === 0 ? (
                      <li className="text-[12px] text-[var(--ink3)]">No other {selectedResource.kind === "ROOM" ? "room" : "resource"} is free then for {attendees}.</li>
                    ) : (
                      alternatives.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelected({ resourceId: r.id, hour: selected!.hour });
                              setShowAlternatives(false);
                            }}
                            className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-left text-[12.5px] text-[var(--ink)] hover:border-[var(--accent)]"
                          >
                            <span className="truncate">{r.name}</span>
                            <span className="text-[11px] text-[var(--ink3)]">{r.capacity ? `${r.capacity} seats` : ""}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {dialog?.kind === "book" && (
        <BookingDialog
          resource={dialog.resource}
          resources={dialog.choose ? resources.filter((r) => r.isActive) : undefined}
          start={dialog.start}
          end={dialog.end}
          attendeeCount={attendees}
          onClose={() => setDialog(null)}
          onBooked={(status) => {
            setDialog(null);
            setSelected(null);
            setNotice({
              tone: "ok",
              text:
                status === "PENDING"
                  ? "Booking requested. The slot is held for you until an Owner or Admin decides."
                  : "Booked. The meeting is in your calendar.",
            });
          }}
        />
      )}
      {dialog?.kind === "edit" && <ResourceEditDialog resource={dialog.resource} onClose={() => setDialog(null)} />}
    </CalendarWorkspace>
  );
}

const STATUS_TONE: Record<string, string> = { CONFIRMED: "#22B07D", PENDING: "#E0A33A", DECLINED: "#E5484D", CANCELLED: "#7C8DA6" };
const STATUS_TEXT: Record<string, string> = { CONFIRMED: "Confirmed", PENDING: "Pending approval", DECLINED: "Declined", CANCELLED: "Cancelled" };

function BookingList({
  title,
  query,
  mode,
}: {
  title: string;
  query: { data?: ResourceBookingView[]; isLoading: boolean; error: unknown };
  mode: "mine" | "pending";
}) {
  const cancel = useCancelBooking();
  const decide = useDecideBooking();
  const list = query.data ?? [];
  const error = (cancel.error ?? decide.error) as Error | null;
  return (
    <section aria-label={title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid={mode === "mine" ? "my-reservations" : "pending-approvals"}>
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-[16px] font-semibold text-[var(--ink)]">{title}</h2>
      {query.isLoading ? (
        <p className="p-4 text-[13px] text-[var(--ink3)]">Loading…</p>
      ) : list.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-[var(--ink3)]">{mode === "mine" ? "You have no room or resource bookings." : "Nothing is waiting for approval."}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink2)]" aria-hidden>
                {b.resource.kind === "ROOM" ? <DoorOpen className="h-4 w-4" /> : <MonitorSpeaker className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">
                  {b.resource.name} · {b.event.title}
                </span>
                <span className="block text-[12px] text-[var(--ink3)]">
                  <CalendarDays className="mr-1 inline h-3 w-3" aria-hidden />
                  {when.format(new Date(b.startsAt))} · {formatTime(new Date(b.startsAt))}–{formatTime(new Date(b.endsAt))}
                  {mode === "pending" ? ` · requested by ${b.bookedBy.name}` : ""}
                  {b.attendeeCount ? ` · ${b.attendeeCount} people` : ""}
                </span>
              </span>
              <span
                className="rounded-md border px-2 py-0.5 text-[11px] font-semibold"
                style={{ color: STATUS_TONE[b.status], borderColor: `color-mix(in srgb, ${STATUS_TONE[b.status]} 45%, transparent)` }}
              >
                {STATUS_TEXT[b.status]}
              </span>
              {mode === "pending" ? (
                <span className="flex gap-2">
                  <button type="button" className="zoiko-btn sm pri" disabled={decide.isPending} onClick={() => decide.mutate({ id: b.id, approve: true })}>
                    Approve
                  </button>
                  <button type="button" className="zoiko-btn sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: b.id, approve: false })}>
                    Decline
                  </button>
                </span>
              ) : (
                (b.status === "CONFIRMED" || b.status === "PENDING") &&
                new Date(b.endsAt) > new Date() && (
                  <button type="button" className="zoiko-btn sm" disabled={cancel.isPending} onClick={() => cancel.mutate(b.id)}>
                    Cancel booking
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="px-4 pb-3 text-[12px] text-[var(--crit)]">
          {error.message}
        </p>
      )}
    </section>
  );
}

function ManageResources({ onEdit }: { onEdit: (r: CalendarResource) => void }) {
  const resources = useResources();
  const update = useUpdateResource();
  return (
    <section aria-label="Manage resources" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="manage-resources">
      <h2 className="border-b border-[var(--border)] px-4 py-3 text-[16px] font-semibold text-[var(--ink)]">Manage resources</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink3)]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Seats</th>
              <th className="px-4 py-2.5">Where</th>
              <th className="px-4 py-2.5">Approval</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(resources.data ?? []).map((r) => (
              <tr key={r.id} className={`border-b border-[var(--border)] ${r.isActive ? "" : "opacity-60"}`}>
                <td className="px-4 py-2.5 font-medium text-[var(--ink)]">
                  {r.name}
                  {!r.isActive && <span className="ml-2 text-[11px] text-[var(--ink3)]">(retired)</span>}
                </td>
                <td className="px-4 py-2.5 text-[var(--ink2)]">{r.kind === "ROOM" ? "Room" : "Equipment"}</td>
                <td className="px-4 py-2.5 text-[var(--ink2)]">{r.capacity ?? "—"}</td>
                <td className="px-4 py-2.5 text-[var(--ink2)]">{[r.location, r.floor].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-4 py-2.5 text-[var(--ink2)]">{r.requiresApproval ? "Needed" : "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className="inline-flex gap-2">
                    <button type="button" className="zoiko-btn sm" onClick={() => onEdit(r)} aria-label={`Edit ${r.name}`}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </button>
                    <button
                      type="button"
                      className="zoiko-btn sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: r.id, input: { isActive: !r.isActive } })}
                    >
                      {r.isActive ? "Retire" : "Bring back"}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {(resources.data ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--ink3)]">
                  No resources yet. Use Add resource.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
