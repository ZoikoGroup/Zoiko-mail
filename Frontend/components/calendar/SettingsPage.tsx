"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock,
  Columns3,
  Info,
  LayoutList,
  Mail,
  Plug,
  Settings,
  Share2,
  ShieldCheck,
  Square,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import type { CalendarEvent, CalendarPreferences, PreferencesInput } from "@/lib/calendar-api";
import { useAccessibleCalendars, useCalendarEvents, useCalendarPreferences, useCalendars, useUpdatePreferences } from "@/lib/calendar-hooks";
import { DEFAULT_CALENDAR_PREFERENCES } from "@/lib/calendar-api";
import { addDays, eventSpan, localZone, startOfDay } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { swatchStyle, eventBlockStyle } from "./palette";

type Section = "general" | "hours" | "availability" | "invitations" | "notifications" | "sharing" | "integrations";

const SECTIONS: { key: Section; label: string; icon: LucideIcon; title: string; subtitle: string }[] = [
  { key: "general", label: "General & display", icon: Square, title: "General & display", subtitle: "Set your default calendar view, dates, time zone and event preferences." },
  { key: "hours", label: "Working hours", icon: Clock, title: "Working hours", subtitle: "When you usually work. Your calendar shades the rest, and new booking links start from these hours." },
  { key: "availability", label: "Availability & privacy", icon: ShieldCheck, title: "Availability & privacy", subtitle: "How new events show to colleagues who can see your calendar." },
  { key: "invitations", label: "Invitations & RSVP", icon: Mail, title: "Invitations & RSVP", subtitle: "How invitations appear in your calendar, and what you hear about replies." },
  { key: "notifications", label: "Notifications", icon: Bell, title: "Notifications", subtitle: "Choose which calendar notifications reach your bell." },
  { key: "sharing", label: "Sharing & access", icon: Share2, title: "Sharing & access", subtitle: "Who can ask to see your calendar, and who already can." },
  { key: "integrations", label: "Integrations", icon: Plug, title: "Integrations", subtitle: "Connect other calendars and meeting tools." },
];

const VIEWS: { key: CalendarPreferences["defaultView"]; label: string; icon: LucideIcon }[] = [
  { key: "day", label: "Day", icon: Square },
  { key: "week", label: "Week", icon: Columns3 },
  { key: "month", label: "Month", icon: CalendarRange },
  { key: "agenda", label: "Agenda", icon: LayoutList },
];
const LOCALES: [string, string][] = [
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["en-IN", "English (India)"],
  ["fr-FR", "Français"],
  ["de-DE", "Deutsch"],
  ["es-ES", "Español"],
];
const DAYS: [number, string][] = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
];
const NOTIFY: { key: keyof CalendarPreferences; label: string; hint: string }[] = [
  { key: "notifyInvitations", label: "New invitations", hint: "When someone invites you to a meeting." },
  { key: "notifyResponses", label: "Replies to your meetings", hint: "Accepts, declines and proposed new times." },
  { key: "notifyUpdates", label: "Changes and cancellations", hint: "When a meeting you are in moves or is cancelled." },
  { key: "notifyBookings", label: "Rooms and bookings", hint: "Room approvals, and guests booking through your links." },
  { key: "notifySharing", label: "Sharing and access", hint: "Calendars shared with you, and access requests." },
  { key: "notifyTemplates", label: "Meeting templates", hint: "Team templates to review, and review decisions." },
];

function timeZones(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all?.length) return all;
  } catch {
    // Older browsers: a short list.
  }
  return ["UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"];
}

/** "Europe/London · BST" for a zone, now. */
function zoneLabel(zone: string): string {
  try {
    const short = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return short ? `${zone} · ${short}` : zone;
  } catch {
    return zone;
  }
}

function timeText(date: Date, format: CalendarPreferences["timeFormat"]): string {
  return format === "H12"
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(date)
    : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function dateText(date: Date, format: CalendarPreferences["dateFormat"]): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return format === "MDY" ? `${mm}/${dd}/${y}` : format === "YMD" ? `${y}-${mm}-${dd}` : `${dd}/${mm}/${y}`;
}

const minutesOf = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const label = "mb-1.5 block text-[13px] font-semibold text-[var(--ink)]";
const hint = "mt-1 text-[11.5px] text-[var(--ink3)]";
const sectionTitle = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]";

/** Calendar Settings & Preferences: saved to the member's account, used by every Calendar page. */
export function SettingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("section");
  const section: Section = SECTIONS.some((s) => s.key === raw) ? (raw as Section) : "general";
  const meta = SECTIONS.find((s) => s.key === section)!;

  const saved = useCalendarPreferences();
  const update = useUpdatePreferences();
  const [draft, setDraft] = useState<PreferencesInput>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const prefs = saved.data ?? DEFAULT_CALENDAR_PREFERENCES;
  const v = { ...prefs, ...draft } as CalendarPreferences;
  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof PreferencesInput>(key: K, value: PreferencesInput[K]) => {
    setNotice(null);
    setDraft((d) => {
      const next = { ...d, [key]: value };
      // Back to what is saved: no longer a change.
      if (JSON.stringify(prefs[key as keyof CalendarPreferences]) === JSON.stringify(value)) delete next[key];
      return next;
    });
  };
  const problem = v.workDays.length === 0 ? "Choose at least one working day." : minutesOf(v.workStart) >= minutesOf(v.workEnd) ? "Working hours must end after they start." : null;

  const go = (next: Section) => router.replace(next === "general" ? "/mail/calendar/settings" : `/mail/calendar/settings?section=${next}`, { scroll: false });
  const save = () => {
    if (!dirty || problem || update.isPending) return;
    update.mutate(draft, {
      onSuccess: () => {
        setDraft({});
        setNotice("Preferences saved. Every calendar page now uses them.");
      },
    });
  };

  return (
    <CalendarWorkspace active="settings">
      <CalendarPageHeader
        icon={Settings}
        eyebrow="Calendar / Preferences"
        title="Calendar Settings & Preferences"
        subtitle="Personalise how you schedule, view and protect your time."
        actions={
          <>
            <span className="rounded-md border px-2 py-1 text-[11.5px] font-medium" style={{ color: "#22B07D", borderColor: "color-mix(in srgb, #22B07D 45%, transparent)", backgroundColor: "color-mix(in srgb, #22B07D 12%, transparent)" }}>
              Personal settings
            </span>
            <button type="button" className="zoiko-btn" onClick={() => setHelp(true)}>
              <Info className="h-4 w-4" aria-hidden /> Help
            </button>
          </>
        }
      />

      <div className="grid min-h-[640px] flex-1 gap-4 lg:grid-cols-[210px_minmax(0,1fr)] 2xl:grid-cols-[210px_minmax(0,1fr)_320px]">
        <nav aria-label="Settings sections" className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Settings</p>
          <ul className="space-y-1">
            {SECTIONS.map((s) => {
              const active = s.key === section;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => go(s.key)}
                    aria-current={active ? "page" : undefined}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition ${
                      active ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)] ring-1 ring-[var(--accent)]/40" : "text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
                    }`}
                  >
                    <s.icon className="h-4 w-4 shrink-0" aria-hidden /> {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mx-2 mt-4 border-t border-[var(--border)] pt-4 text-[11.5px] leading-relaxed text-[var(--ink3)]">
            These are your personal settings. They never override your workspace&apos;s security policy, and colleagues only ever see what you have shared.
          </p>
        </nav>

        <section aria-label={meta.title} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="settings-panel">
          <div className="border-b border-[var(--border)] p-5">
            <h2 className="text-[19px] font-semibold text-[var(--ink)]">{meta.title}</h2>
            <p className="mt-1 text-[13px] text-[var(--ink2)]">{meta.subtitle}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {saved.isError && (
              <p role="alert" className="mb-4 text-[12.5px] text-[var(--crit)]">
                Could not load your saved preferences ({(saved.error as Error).message}). The defaults are shown.
              </p>
            )}
            {section === "general" && <General v={v} set={set} />}
            {section === "hours" && <WorkingHours v={v} set={set} />}
            {section === "availability" && <Availability v={v} set={set} />}
            {section === "invitations" && <Invitations v={v} set={set} />}
            {section === "notifications" && <Notifications v={v} set={set} />}
            {section === "sharing" && <Sharing v={v} set={set} />}
            {section === "integrations" && <Integrations />}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4">
            <p className="mr-auto text-[12px] text-[var(--ink3)]" role="status" data-testid="save-state">
              {problem ? (
                <span className="text-[var(--crit)]">{problem}</span>
              ) : update.error ? (
                <span className="text-[var(--crit)]">{(update.error as Error).message}</span>
              ) : notice ? (
                <span className="flex items-center gap-1.5 text-[#22B07D]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {notice}
                </span>
              ) : dirty ? (
                `${Object.keys(draft).length} unsaved change${Object.keys(draft).length === 1 ? "" : "s"}`
              ) : (
                "Saved to your account · applies on all your devices"
              )}
            </p>
            <button type="button" className="zoiko-btn" onClick={() => setDraft({})} disabled={!dirty || update.isPending}>
              Discard
            </button>
            <button type="button" className="zoiko-btn pri" onClick={save} disabled={!dirty || Boolean(problem) || update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </section>

        <aside className="hidden flex-col gap-4 2xl:flex" aria-label="Preview">
          <WeekPreview v={v} />
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">Privacy &amp; access</h3>
            <p className="text-[12px] text-[var(--ink3)]">Calendar access remains under workspace policy.</p>
            <div className="mt-3 flex gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#22B07D]" aria-hidden />
              <div>
                <p className="text-[12.5px] font-semibold text-[var(--ink)]">Private events stay private</p>
                <p className="mt-0.5 text-[12px] text-[var(--ink2)]">People without access see only Busy — never sensitive event details.</p>
              </div>
            </div>
            <Link href="/mail/calendar/shared" className="mt-3 inline-flex items-center gap-1 text-[12.5px] text-[var(--accent-ink)] hover:underline">
              Review calendar sharing <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </aside>
      </div>

      {help && (
        <Modal open onClose={() => setHelp(false)} title="About calendar settings" footer={<button type="button" className="zoiko-btn pri" onClick={() => setHelp(false)}>Got it</button>}>
          <ul className="space-y-2 text-[13px] text-[var(--ink2)]">
            <li>• Settings are saved to your account, so they follow you to every device.</li>
            <li>• Display choices (first day of the week, weekends, 12/24-hour time, date order) change every Calendar page as soon as you save.</li>
            <li>• Defaults for new events — length, privacy, busy or free, time zone — fill in the new-event form; you can still change them per event.</li>
            <li>• Turning a notification off stops it reaching your bell. The item itself still appears on its page (for example, invitations under Invitations &amp; RSVP).</li>
            <li>• Nothing here can widen what colleagues see: sharing stays exactly as you set it under Shared Calendars.</li>
          </ul>
        </Modal>
      )}
    </CalendarWorkspace>
  );
}

type Props = { v: CalendarPreferences; set: <K extends keyof PreferencesInput>(key: K, value: PreferencesInput[K]) => void };

function Toggle({ id, checked, onChange, title, description }: { id: string; checked: boolean; onChange: (next: boolean) => void; title: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <p id={`${id}-label`} className="text-[13.5px] font-semibold text-[var(--ink)]">
          {title}
        </p>
        <p className="text-[12px] text-[var(--ink3)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-[var(--accent)]" : "bg-[var(--s2)] ring-1 ring-inset ring-[var(--border)]"}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--s2)] px-3 py-2.5 text-[12.5px] text-[var(--ink2)]">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]" aria-hidden /> <span>{children}</span>
    </p>
  );
}

function General({ v, set }: Props) {
  const zones = useMemo(() => timeZones(), []);
  const device = useMemo(() => localZone(), []);
  const sample = new Date(2026, 9, 23, 13, 0);
  return (
    <>
      <p className={sectionTitle}>Default calendar view</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Default calendar view">
        {VIEWS.map((view) => {
          const on = v.defaultView === view.key;
          return (
            <button
              key={view.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set("defaultView", view.key)}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-[13.5px] transition ${
                on ? "border-[var(--accent)] bg-[var(--zm-selected)] font-semibold text-[var(--ink)] ring-1 ring-[var(--accent)]" : "border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--s2)]"
              }`}
            >
              <view.icon className="h-4 w-4" aria-hidden /> {view.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="st-week" className={label}>
            Start of week
          </label>
          <select id="st-week" className="zoiko-input w-full" value={v.weekStart} onChange={(e) => set("weekStart", Number(e.target.value) as 0 | 1 | 6)}>
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
            <option value={6}>Saturday</option>
          </select>
        </div>
        <div>
          <label htmlFor="st-duration" className={label}>
            Default event duration
          </label>
          <select id="st-duration" className="zoiko-input w-full" value={v.defaultDurationMinutes} onChange={(e) => set("defaultDurationMinutes", Number(e.target.value))}>
            {[15, 20, 25, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : `${m / 60} hours`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="st-zone" className={label}>
            Time zone
          </label>
          <select id="st-zone" className="zoiko-input w-full" value={v.timeZone ?? ""} onChange={(e) => set("timeZone", e.target.value || null)}>
            <option value="">Use this device ({device.zone})</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <p className={hint}>Used for new events and booking links, and adjusts for daylight saving. The calendar shows times in this device&apos;s zone.</p>
        </div>
        <div>
          <label htmlFor="st-locale" className={label}>
            Language
          </label>
          <select id="st-locale" className="zoiko-input w-full" value={v.locale} onChange={(e) => set("locale", e.target.value)}>
            {LOCALES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <p className={hint}>For day and month names in your calendar.</p>
        </div>
        <div>
          <label htmlFor="st-date" className={label}>
            Date format
          </label>
          <select id="st-date" className="zoiko-input w-full" value={v.dateFormat} onChange={(e) => set("dateFormat", e.target.value as CalendarPreferences["dateFormat"])}>
            <option value="DMY">DD/MM/YYYY ({dateText(sample, "DMY")})</option>
            <option value="MDY">MM/DD/YYYY ({dateText(sample, "MDY")})</option>
            <option value="YMD">YYYY-MM-DD ({dateText(sample, "YMD")})</option>
          </select>
        </div>
        <div>
          <label htmlFor="st-time" className={label}>
            Time format
          </label>
          <select id="st-time" className="zoiko-input w-full" value={v.timeFormat} onChange={(e) => set("timeFormat", e.target.value as CalendarPreferences["timeFormat"])}>
            <option value="H24">24-hour ({timeText(sample, "H24")})</option>
            <option value="H12">12-hour ({timeText(sample, "H12")})</option>
          </select>
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <p className={sectionTitle}>Display options</p>
        <Toggle id="st-weekends" checked={v.showWeekends} onChange={(next) => set("showWeekends", next)} title="Show weekends" description="Include Saturday and Sunday in your calendar's week view." />
        <Toggle
          id="st-descriptions"
          checked={v.showDescriptions}
          onChange={(next) => set("showDescriptions", next)}
          title="Show event descriptions in preview"
          description="Show agenda notes in the day summary and agenda view, where you can see them."
        />
      </div>
      <Note>Calendar availability and scheduling are governed by your access rights and workspace policies.</Note>
    </>
  );
}

function WorkingHours({ v, set }: Props) {
  return (
    <>
      <p className={sectionTitle}>Working days</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Working days">
        {DAYS.map(([n, name]) => {
          const on = v.workDays.includes(n);
          return (
            <button
              key={n}
              type="button"
              aria-pressed={on}
              onClick={() => set("workDays", on ? v.workDays.filter((d) => d !== n) : [...v.workDays, n].sort((a, b) => a - b))}
              className={`rounded-lg border px-3.5 py-2 text-[13px] font-semibold ${on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--border)] text-[var(--ink3)]"}`}
            >
              {name}
            </button>
          );
        })}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="st-start" className={label}>
            Day starts
          </label>
          <input id="st-start" type="time" className="zoiko-input w-full" value={v.workStart} onChange={(e) => e.target.value && set("workStart", e.target.value)} />
        </div>
        <div>
          <label htmlFor="st-end" className={label}>
            Day ends
          </label>
          <input id="st-end" type="time" className="zoiko-input w-full" value={v.workEnd} onChange={(e) => e.target.value && set("workEnd", e.target.value)} />
        </div>
      </div>
      <Note>Time outside these hours is shaded in My Calendar and Team Calendar, which open at the start of your day. Work-week views show these days, and new scheduling links offer these hours.</Note>
    </>
  );
}

function Availability({ v, set }: Props) {
  return (
    <>
      <p className={sectionTitle}>New events</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="st-showas" className={label}>
            Show me as
          </label>
          <select id="st-showas" className="zoiko-input w-full" value={v.defaultShowAs} onChange={(e) => set("defaultShowAs", e.target.value as "BUSY" | "FREE")}>
            <option value="BUSY">Busy</option>
            <option value="FREE">Free</option>
          </select>
          <p className={hint}>Busy time is what colleagues, Find a time and your booking links work around.</p>
        </div>
        <div>
          <label htmlFor="st-visibility" className={label}>
            Visibility
          </label>
          <select id="st-visibility" className="zoiko-input w-full" value={v.defaultVisibility} onChange={(e) => set("defaultVisibility", e.target.value as "DEFAULT" | "PRIVATE")}>
            <option value="DEFAULT">Follow the calendar&apos;s sharing</option>
            <option value="PRIVATE">Private (others see only Busy)</option>
          </select>
          <p className={hint}>You can change both on each event.</p>
        </div>
      </div>
      <div className="mt-6 border-t border-[var(--border)] pt-5">
        <p className={sectionTitle}>What colleagues see</p>
        <ul className="space-y-2 text-[12.5px] text-[var(--ink2)]">
          <li>
            <b className="text-[var(--ink)]">Free/busy:</b> only that time is taken.
          </li>
          <li>
            <b className="text-[var(--ink)]">View or more:</b> titles and details — except private events, which always show as Busy.
          </li>
          <li>
            <b className="text-[var(--ink)]">Everyone else:</b> nothing. Your calendar does not appear to them at all.
          </li>
        </ul>
      </div>
    </>
  );
}

function Invitations({ v, set }: Props) {
  return (
    <>
      <p className={sectionTitle}>In your calendar</p>
      <Toggle
        id="st-pending"
        checked={v.showPendingInvitations}
        onChange={(next) => set("showPendingInvitations", next)}
        title="Show invitations I haven't answered"
        description="Unanswered invitations appear in My Calendar beside your own events. Declined ones never do."
      />
      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <p className={sectionTitle}>Notifications</p>
        <Toggle id="st-n-inv" checked={v.notifyInvitations} onChange={(next) => set("notifyInvitations", next)} title="New invitations" description="When someone invites you to a meeting." />
        <Toggle id="st-n-resp" checked={v.notifyResponses} onChange={(next) => set("notifyResponses", next)} title="Replies to your meetings" description="Accepts, declines and proposed new times from people you invite." />
      </div>
      <Note>
        Invitations always wait for you under{" "}
        <Link href="/mail/calendar/invitations" className="text-[var(--accent-ink)] hover:underline">
          Invitations &amp; RSVP
        </Link>
        , whatever you choose here.
      </Note>
    </>
  );
}

function Notifications({ v, set }: Props) {
  return (
    <>
      <p className={sectionTitle}>Send to my bell</p>
      {NOTIFY.map((n) => (
        <Toggle key={n.key} id={`st-${n.key}`} checked={v[n.key] as boolean} onChange={(next) => set(n.key as keyof PreferencesInput, next)} title={n.label} description={n.hint} />
      ))}
      <Note>Turning one off stops that kind of notification reaching your bell. The item still appears on its page.</Note>
    </>
  );
}

function Sharing({ v, set }: Props) {
  const accessible = useAccessibleCalendars();
  const mine = (accessible.data ?? []).filter((c) => c.access === "OWNER");
  return (
    <>
      <p className={sectionTitle}>Access requests</p>
      <Toggle
        id="st-requests"
        checked={v.allowAccessRequests}
        onChange={(next) => set("allowAccessRequests", next)}
        title="Let colleagues ask for access"
        description="When off, colleagues cannot request your personal calendars; you can still share them yourself."
      />
      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className={sectionTitle + " mb-0"}>Your calendars</p>
          <Link href="/mail/calendar/shared" className="inline-flex items-center gap-1 text-[12.5px] text-[var(--accent-ink)] hover:underline">
            Manage sharing <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        {accessible.isLoading ? (
          <Spinner size="sm" label="Loading your calendars" className="text-[12.5px]" />
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]" data-testid="my-calendar-shares">
            {mine.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <span className="h-2.5 w-2.5 rounded-full" style={swatchStyle(c.color)} aria-hidden />
                <span className="flex-1 text-[var(--ink)]">
                  {c.name}
                  {c.kind === "TEAM" ? " (team)" : ""}
                </span>
                <span className="text-[12px] text-[var(--ink3)]">{c.sharedWithCount === 0 ? "Only you" : `Shared with ${c.sharedWithCount}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Integrations() {
  const items = [
    ["Google Calendar", "Two-way sync with a Google calendar."],
    ["Microsoft Outlook", "Two-way sync with an Outlook or Microsoft 365 calendar."],
    ["Zoom", "Add a Zoom link to new meetings automatically."],
    ["Calendar feed (iCal)", "Subscribe to your calendar from another app."],
  ];
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map(([name, text]) => (
          <li key={name} className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13.5px] font-semibold text-[var(--ink)]">{name}</p>
              <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--ink3)]">Not available yet</span>
            </div>
            <p className="mt-1 text-[12px] text-[var(--ink3)]">{text}</p>
          </li>
        ))}
      </ul>
      <Note>Integrations are not connected in this workspace yet. Your calendar works fully without them.</Note>
    </>
  );
}

/** This week, drawn with the (unsaved) choices: first day, weekends, time format, working hours. */
function WeekPreview({ v }: { v: CalendarPreferences }) {
  const today = startOfDay(new Date());
  const offset = (today.getDay() - v.weekStart + 7) % 7;
  const first = addDays(today, -offset);
  const week = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const days = v.showWeekends ? week : week.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  const startHour = Math.min(Math.floor(minutesOf(v.workStart) / 60), 20);
  const hours = Array.from({ length: 4 }, (_, i) => startHour + i);
  const events = useCalendarEvents(first, addDays(first, 7));
  const calendars = useCalendars();
  const colors = new Map((calendars.data ?? []).map((c) => [c.id, c.color]));
  const dayName = new Intl.DateTimeFormat(v.locale, { weekday: "short" });
  const monthName = new Intl.DateTimeFormat(v.locale, { month: "long", year: "numeric" });
  const zone = v.timeZone ?? localZone().zone;
  const timed = (events.data ?? []).filter((e: CalendarEvent) => !e.allDay);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="settings-preview">
      <h3 className="text-[15px] font-semibold text-[var(--ink)]">Calendar preview</h3>
      <p className="text-[12px] text-[var(--ink3)]">See how your preferences affect the weekly view.</p>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-[var(--ink)]">
          {days[0]!.getDate()}–{days[days.length - 1]!.getDate()} {monthName.format(days[days.length - 1]!)}
        </p>
        <p className="truncate text-[11px] text-[var(--ink3)]">{zoneLabel(zone)}</p>
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid border-b border-[var(--border)]" style={{ gridTemplateColumns: `40px repeat(${days.length}, minmax(0,1fr))` }}>
          <span />
          {days.map((d) => (
            <span key={d.toISOString()} className="border-l border-[var(--border)] py-1.5 text-center text-[10.5px] leading-tight text-[var(--ink2)]" data-testid="preview-day">
              {dayName.format(d)}
              <br />
              <b className="text-[var(--ink)]">{d.getDate()}</b>
            </span>
          ))}
        </div>
        {hours.map((h) => (
          <div key={h} className="grid border-b border-[var(--border)] last:border-b-0" style={{ gridTemplateColumns: `40px repeat(${days.length}, minmax(0,1fr))` }}>
            <span className="px-1 pt-1 text-[9.5px] tabular-nums text-[var(--ink3)]" data-testid="preview-hour">
              {timeText(new Date(2026, 0, 1, h), v.timeFormat)}
            </span>
            {days.map((d) => {
              const slotStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
              const slotEnd = new Date(slotStart.getTime() + 3_600_000);
              const working = v.workDays.includes(d.getDay() || 7) && h * 60 >= minutesOf(v.workStart) - 59 && h * 60 < minutesOf(v.workEnd);
              const here = timed.filter((e) => {
                const s = eventSpan(e).start;
                return s >= slotStart && s < slotEnd;
              });
              return (
                <div key={d.toISOString()} className={`min-h-[48px] border-l border-[var(--border)] p-0.5 ${working ? "" : "bg-[var(--s2)]/70"}`}>
                  {here.slice(0, 2).map((e) => (
                    <div key={e.id} className="mb-0.5 line-clamp-2 break-words rounded border px-1 py-0.5 text-[9.5px] font-semibold leading-tight text-[var(--ink)]" style={eventBlockStyle(e.source === "INVITED" ? "teal" : colors.get(e.calendarId))} title={e.title}>
                      {e.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--ink3)]">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[#3B7BF6]" aria-hidden /> Your events
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[#22B0A0]" aria-hidden /> Invitations
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--s2)] ring-1 ring-[var(--border)]" aria-hidden /> Outside working hours
        </span>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ink3)]">
        <CalendarDays className="h-3 w-3" aria-hidden /> Opens in {VIEWS.find((x) => x.key === v.defaultView)?.label} view · new events {v.defaultDurationMinutes} min
      </p>
    </div>
  );
}
