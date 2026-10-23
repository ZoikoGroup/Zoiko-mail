"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarCog,
  CalendarPlus,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  FileText,
  Layers,
  LayoutTemplate,
  Link2,
  Lock,
  MapPin,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  User,
  Users,
  Video,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { ExternalGuestPolicy, MeetingTemplate, TemplateInput } from "@/lib/calendar-api";
import {
  useAccessibleCalendars,
  useCreateTemplate,
  useDeleteTemplate,
  useDuplicateTemplate,
  useReviewTemplate,
  useTemplates,
  useUpdateTemplate,
} from "@/lib/calendar-hooks";
import { formatTime } from "@/lib/calendar-dates";
import { CalendarPageHeader, CalendarWorkspace } from "./CalendarWorkspace";
import { EventDialog, type EventDraftSeed } from "./EventDialog";
import { AttendeeInput } from "./AttendeeInput";

type Tab = "all" | "mine" | "team" | "review";
const TABS: Tab[] = ["all", "mine", "team", "review"];

const LOCATION: Record<MeetingTemplate["locationType"], { label: string; icon: typeof Video; detail: string; placeholder: string }> = {
  VIDEO: { label: "Video call", icon: Video, detail: "Meeting link", placeholder: "https://" },
  PHONE: { label: "Phone call", icon: Phone, detail: "Phone number", placeholder: "+44 …" },
  IN_PERSON: { label: "In person", icon: MapPin, detail: "Address or room", placeholder: "e.g. Room 4B" },
};
const GUESTS: Record<ExternalGuestPolicy, string> = {
  NOT_ALLOWED: "Members only",
  APPROVAL: "Approval if required",
  ALLOWED: "Allowed",
};
const STATUS: Record<MeetingTemplate["status"], { text: string; hex: string }> = {
  READY: { text: "Ready", hex: "#22B07D" },
  DRAFT: { text: "Draft", hex: "#7C8DA6" },
  PENDING_REVIEW: { text: "Needs review", hex: "#E0A33A" },
};
const longDay = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });

function pill(hex: string) {
  return { color: hex, borderColor: `color-mix(in srgb, ${hex} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${hex} 14%, transparent)` };
}

function Pill({ hex, children }: { hex: string; children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold" style={pill(hex)}>
      {children}
    </span>
  );
}

function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}

/** Meeting Templates: reusable meeting formats, personal and team, with a review queue for team ones. */
export function TemplatesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "all";
  const setTab = (next: Tab) => {
    router.replace(next === "all" ? "/mail/calendar/templates" : `/mail/calendar/templates?tab=${next}`, { scroll: false });
    setSelectedId(null);
  };

  const templates = useTemplates();
  const duplicate = useDuplicateTemplate();
  const accessible = useAccessibleCalendars();
  const [selectedId, setSelectedId] = useState<string | null>(params.get("template"));
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [using, setUsing] = useState<EventDraftSeed | null>(null);

  const all = useMemo(() => templates.data ?? [], [templates.data]);
  const mine = all.filter((t) => t.isMine);
  const team = all.filter((t) => t.scope === "TEAM" && t.status !== "PENDING_REVIEW");
  const review = all.filter((t) => t.status === "PENDING_REVIEW" && (t.canReview || t.isMine));
  const reviewCount = all.filter((t) => t.status === "PENDING_REVIEW" && t.canReview).length;
  const byTab = tab === "mine" ? mine : tab === "team" ? team : tab === "review" ? review : all;
  const listed = byTab.filter((t) => !query || t.title.toLowerCase().includes(query.toLowerCase()));
  const selected = all.find((t) => t.id === selectedId) ?? listed[0] ?? null;

  useEffect(() => {
    if (!selectedId && listed[0]) setSelectedId(listed[0].id);
  }, [listed, selectedId]);

  const writable = useMemo(
    () => (accessible.data ?? []).filter((c) => c.access === "OWNER" || c.access === "EDIT" || c.access === "MANAGE"),
    [accessible.data]
  );
  const teamCalendars = writable.filter((c) => c.kind === "TEAM");

  const use = (t: MeetingTemplate) => {
    const start = nextHalfHour();
    setUsing({ start, end: new Date(start.getTime() + t.durationMinutes * 60_000), templateId: t.id });
  };

  const sidebarSection = (
    <>
      <div className="px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Template library</h2>
      </div>
      <ul className="space-y-0.5">
        {(
          [
            ["mine", "My Templates", User, mine.length],
            ["team", "Team Templates", Users, team.length],
            ["review", "Pending Review", ClipboardCheck, reviewCount],
          ] as const
        ).map(([key, text, Icon, n]) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] ${
                tab === key ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)]" : "text-[var(--ink2)] hover:bg-[var(--s2)]"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {text}
              <span className={`ml-auto rounded-md px-1.5 text-[11px] ${key === "review" && n > 0 ? "bg-[#E0A33A]/20 text-[#E0A33A]" : "bg-[var(--s2)] text-[var(--ink2)]"}`}>{n}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Calendar settings</h2>
      </div>
      <ul className="space-y-0.5 text-[13.5px]">
        {(
          [
            ["/mail/calendar/settings", "Calendar settings", CalendarCog],
            ["/mail/calendar/shared", "Sharing & permissions", Layers],
            ["/mail/calendar/scheduling", "Scheduling links", Link2],
          ] as const
        ).map(([href, text, Icon]) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]">
              <Icon className="h-4 w-4" aria-hidden /> {text}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <CalendarWorkspace active="templates" sidebarSection={sidebarSection}>
      <CalendarPageHeader
        icon={LayoutTemplate}
        eyebrow="Calendar / Templates"
        title="Meeting Templates & Event Presets"
        subtitle="Reusable meeting formats with default length, location, agenda and safeguards — for you or your team."
        actions={
          <>
            <button
              type="button"
              className="zoiko-btn"
              disabled={!selected || duplicate.isPending}
              onClick={() => selected && duplicate.mutate(selected.id, { onSuccess: (copy) => setSelectedId(copy.id) })}
            >
              <Copy className="h-4 w-4" aria-hidden /> Duplicate
            </button>
            <button type="button" className="zoiko-btn pri" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New template
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3" data-testid="template-stats">
        <Stat icon={LayoutTemplate} hex="#3B7BF6" value={all.length} label="Meeting templates" hint={`${mine.filter((t) => t.scope === "PERSONAL").length} personal · ${all.filter((t) => t.scope === "TEAM").length} team-managed`} />
        <Stat icon={Users} hex="#8B6CF6" value={all.filter((t) => t.scope === "TEAM" && t.status === "READY").length} label="Team-managed templates" hint="Ready for your teams" />
        <Stat icon={Clock} hex="#E0A33A" value={reviewCount} label="Awaiting approval" hint={reviewCount ? "Team templates to review" : "Nothing waiting"} />
      </div>

      <div role="tablist" aria-label="Templates" className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--border)]">
        {(
          [
            ["all", "All Templates", 0],
            ["mine", "My Templates", 0],
            ["team", "Team Templates", 0],
            ["review", "Review Queue", reviewCount],
          ] as const
        ).map(([key, text, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-[13.5px] ${
              tab === key ? "border-[var(--accent)] font-semibold text-[var(--ink)]" : "border-transparent text-[var(--ink2)] hover:text-[var(--ink)]"
            }`}
          >
            {text}
            {n > 0 && <span className="text-[#E0A33A]">({n})</span>}
          </button>
        ))}
      </div>

      <div className="grid min-h-[600px] flex-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_340px]">
        <section aria-label="Template library" className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] p-4">
            <h2 className="text-[15px] font-semibold text-[var(--ink)]">Template library</h2>
            <p className="text-[12px] text-[var(--ink3)]">Choose a template to edit or use</p>
          </div>
          <div className="border-b border-[var(--border)] p-3">
            <input className="zoiko-input w-full" placeholder="Search templates…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search templates" />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="template-list">
            {templates.isLoading ? (
              <li className="p-3 text-[12.5px] text-[var(--ink3)]">Loading…</li>
            ) : templates.isError ? (
              <li role="alert" className="p-3 text-[12.5px] text-[var(--crit)]">
                {(templates.error as Error).message}
              </li>
            ) : listed.length === 0 ? (
              <li className="p-4 text-center text-[12.5px] text-[var(--ink3)]">
                {tab === "review"
                  ? "No templates waiting for review."
                  : tab === "team"
                    ? "No team templates yet."
                    : "No templates yet. Create one for meetings you run often."}
              </li>
            ) : (
              listed.map((t) => {
                const active = selected?.id === t.id;
                const Loc = LOCATION[t.locationType].icon;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-current={active ? "true" : undefined}
                      className={`mb-1 flex w-full gap-3 rounded-xl border p-3 text-left transition ${
                        active ? "border-[var(--accent)] bg-[var(--zm-selected)]" : "border-transparent hover:bg-[var(--s2)]"
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]" aria-hidden>
                        <Loc className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{t.title}</span>
                        <span className="mt-0.5 block text-[12px] text-[var(--ink3)]">
                          {t.durationMinutes} min · {LOCATION[t.locationType].label}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          <Pill hex={t.scope === "TEAM" ? "#8B6CF6" : "#3B7BF6"}>{t.scope === "TEAM" ? "Team" : "Personal"}</Pill>
                          <Pill hex={STATUS[t.status].hex}>{STATUS[t.status].text}</Pill>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11.5px] text-[var(--ink3)]">Changes to a template never alter meetings already created.</p>
        </section>

        {selected ? (
          <>
            <TemplateEditor key={selected.id + selected.updatedAt} template={selected} onUse={() => use(selected)} onDeleted={() => setSelectedId(null)} />
            <InvitationPreview template={selected} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-[13px] text-[var(--ink3)] 2xl:col-span-2">
            {templates.isLoading ? (
              "Loading…"
            ) : (
              <>
                <FileText className="h-8 w-8" aria-hidden />
                Create a template for a meeting you run often — its length, place, agenda and guests are filled in for you.
                <button type="button" className="zoiko-btn pri" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" aria-hidden /> New template
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {creating && (
        <NewTemplateDialog
          teamCalendars={teamCalendars}
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            router.replace(t.status === "PENDING_REVIEW" ? "/mail/calendar/templates?tab=review" : "/mail/calendar/templates?tab=mine", { scroll: false });
            setSelectedId(t.id);
          }}
        />
      )}
      {using && <EventDialog calendars={writable} seed={using} onClose={() => setUsing(null)} />}
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

function NewTemplateDialog({
  teamCalendars,
  onClose,
  onCreated,
}: {
  teamCalendars: Array<{ id: string; name: string; access: string }>;
  onClose: () => void;
  onCreated: (t: MeetingTemplate) => void;
}) {
  const create = useCreateTemplate();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("personal");
  const [duration, setDuration] = useState(30);
  const [touched, setTouched] = useState(false);
  const problem = title.trim() ? null : "Give the template a title.";
  const forTeam = owner !== "personal";
  const managesTeam = teamCalendars.find((c) => c.id === owner)?.access;
  const needsReview = forTeam && managesTeam !== "OWNER" && managesTeam !== "MANAGE";

  const submit = () => {
    setTouched(true);
    if (problem || create.isPending) return;
    create.mutate(
      { title: title.trim(), durationMinutes: duration, ...(forTeam ? { scope: "TEAM" as const, teamCalendarId: owner } : {}), status: forTeam ? "READY" : "DRAFT" },
      { onSuccess: onCreated }
    );
  };

  return (
    <Modal
      open
      onClose={create.isPending ? () => undefined : onClose}
      title="New template"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : needsReview ? "Create and submit for review" : "Create template"}
          </button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <label htmlFor="nt-title" className={label}>
            Template name
          </label>
          <input id="nt-title" className="zoiko-input w-full" autoFocus value={title} placeholder="e.g. Customer onboarding call" onChange={(e) => setTitle(e.target.value)} />
          {touched && problem && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problem}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="nt-owner" className={label}>
              Who uses it
            </label>
            <select id="nt-owner" className="zoiko-input w-full" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="personal">Just me (personal)</option>
              {teamCalendars.map((c) => (
                <option key={c.id} value={c.id}>
                  Team · {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nt-duration" className={label}>
              Duration
            </label>
            <select id="nt-duration" className="zoiko-input w-full" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {[15, 20, 25, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[12px] text-[var(--ink3)]">
          {forTeam
            ? needsReview
              ? "A team manager reviews it before the team can use it."
              : "You manage this team calendar, so the template is ready for the team straight away."
            : "Personal templates start as a draft. Fill in the details, then mark it Ready."}
        </p>
        {create.error && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {(create.error as Error).message}
          </p>
        )}
      </form>
    </Modal>
  );
}

function TemplateEditor({ template, onUse, onDeleted }: { template: MeetingTemplate; onUse: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState<TemplateInput>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState("");
  const update = useUpdateTemplate();
  const remove = useDeleteTemplate();
  const review = useReviewTemplate();
  const v = { ...template, ...draft } as MeetingTemplate;
  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof TemplateInput>(key: K, value: TemplateInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const readOnly = !template.canEdit;
  const reviewer = template.canReview;
  const memberEditingTeam = template.scope === "TEAM" && !reviewer;
  const problem = !v.title.trim()
    ? "Give the template a title."
    : v.locationType === "VIDEO" && v.locationDetail?.trim() && !/^https?:\/\/\S+$/i.test(v.locationDetail.trim())
      ? "Enter a full meeting link, starting with https://"
      : null;
  const Loc = LOCATION[v.locationType].icon;
  const error = (update.error ?? remove.error ?? review.error) as Error | null;

  const save = (status?: "DRAFT" | "READY") => {
    if (problem || update.isPending) return;
    update.mutate({ id: template.id, input: { ...draft, ...(status ? { status } : {}) } }, { onSuccess: () => setDraft({}) });
  };

  return (
    <section aria-label={template.title} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="template-editor">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]" aria-hidden>
          <Loc className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-semibold text-[var(--ink)]">{template.title}</h2>
          <p className="text-[12.5px] text-[var(--ink3)]">
            {template.scope === "TEAM" ? `Team template · ${template.teamCalendar?.name ?? "Team"}` : "Personal template"} · by {template.isMine ? "you" : template.owner.name}
            {template.reviewedBy && template.status === "READY" && template.scope === "TEAM" ? ` · approved by ${template.reviewedBy}` : ""}
          </p>
        </div>
        <span className="flex gap-1.5">
          <Pill hex={template.scope === "TEAM" ? "#8B6CF6" : "#3B7BF6"}>{template.scope === "TEAM" ? "Team" : "Personal"}</Pill>
          <Pill hex={STATUS[template.status].hex}>{STATUS[template.status].text}</Pill>
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {template.status === "DRAFT" && template.reviewNote && (
          <p className="rounded-xl border px-3 py-2 text-[12.5px]" style={pill("#E0A33A")} data-testid="review-note">
            Sent back{template.reviewedBy ? ` by ${template.reviewedBy}` : ""}: “{template.reviewNote}”
          </p>
        )}
        {template.status === "PENDING_REVIEW" && template.isMine && !reviewer && (
          <p className="rounded-xl border px-3 py-2 text-[12.5px]" style={pill("#E0A33A")}>
            Waiting for a team manager to review it. The team cannot use it yet.
          </p>
        )}
        {readOnly && <p className="flex items-center gap-1.5 text-[12px] text-[var(--ink3)]"><Lock className="h-3.5 w-3.5" aria-hidden /> Managed by the team. You can use or duplicate it.</p>}

        <section>
          <h3 className="mb-2 text-[14px] font-semibold text-[var(--ink)]">Meeting defaults</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="tp-title" className={label}>
                Event title
              </label>
              <input id="tp-title" className="zoiko-input w-full" disabled={readOnly} value={v.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div>
              <label htmlFor="tp-host" className={label}>
                Host / organizer
              </label>
              <input id="tp-host" className="zoiko-input w-full" disabled value={template.scope === "TEAM" ? "Whoever schedules it" : template.isMine ? "You" : template.owner.name} readOnly />
            </div>
            <div>
              <label htmlFor="tp-duration" className={label}>
                Duration
              </label>
              <select id="tp-duration" className="zoiko-input w-full" disabled={readOnly} value={v.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))}>
                {Array.from(new Set([15, 20, 25, 30, 45, 60, 90, 120, v.durationMinutes]))
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="tp-location" className={label}>
                Location
              </label>
              <select id="tp-location" className="zoiko-input w-full" disabled={readOnly} value={v.locationType} onChange={(e) => set("locationType", e.target.value as MeetingTemplate["locationType"])}>
                <option value="VIDEO">Video call</option>
                <option value="PHONE">Phone call</option>
                <option value="IN_PERSON">In person</option>
              </select>
            </div>
            <div>
              <label htmlFor="tp-location-detail" className={label}>
                {LOCATION[v.locationType].detail} (optional)
              </label>
              <input
                id="tp-location-detail"
                className="zoiko-input w-full"
                disabled={readOnly}
                value={v.locationDetail ?? ""}
                placeholder={LOCATION[v.locationType].placeholder}
                onChange={(e) => set("locationDetail", e.target.value || null)}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tp-agenda" className={label}>
                Default agenda
              </label>
              <textarea
                id="tp-agenda"
                className="zoiko-input min-h-[96px] w-full"
                disabled={readOnly}
                value={v.agenda ?? ""}
                placeholder={"1. Welcome and goals\n2. Walkthrough\n3. Next steps"}
                onChange={(e) => set("agenda", e.target.value || null)}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tp-attendees" className={label}>
                Default invitees (optional)
              </label>
              {readOnly ? (
                <p className="text-[12.5px] text-[var(--ink2)]">{v.defaultAttendees.length ? v.defaultAttendees.join(", ") : "None"}</p>
              ) : (
                <AttendeeInput inputId="tp-attendees" value={v.defaultAttendees} onChange={(next) => set("defaultAttendees", next)} />
              )}
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[14px] font-semibold text-[var(--ink)]">Scheduling safeguards</h3>
          <div className="space-y-2">
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Calendar conflict checking</span>
                <span className="text-[11.5px] text-[var(--ink3)]">A meeting from this template cannot overlap your busy time</span>
              </span>
              <span className="flex items-center gap-1 text-[12.5px] font-semibold text-[#22B07D]">
                <Check className="h-4 w-4" aria-hidden /> Required
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className={`${card} flex items-center justify-between gap-2`}>
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--ink)]">Buffer</span>
                  <span className="text-[11.5px] text-[var(--ink3)]">Free time kept before and after</span>
                </span>
                <select aria-label="Buffer" className="zoiko-input !w-[100px]" disabled={readOnly} value={v.bufferMinutes} onChange={(e) => set("bufferMinutes", Number(e.target.value))}>
                  {[0, 5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${card} flex items-center justify-between gap-2`}>
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--ink)]">Minimum notice</span>
                  <span className="text-[11.5px] text-[var(--ink3)]">How soon it can be scheduled</span>
                </span>
                <select aria-label="Minimum notice" className="zoiko-input !w-[110px]" disabled={readOnly} value={v.minNoticeHours} onChange={(e) => set("minNoticeHours", Number(e.target.value))}>
                  {[0, 1, 2, 4, 12, 24, 48].map((h) => (
                    <option key={h} value={h}>
                      {h === 0 ? "None" : `${h} hour${h > 1 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={`${card} flex items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">External guest invitations</span>
                <span className="text-[11.5px] text-[var(--ink3)]">People outside the workspace</span>
              </span>
              <select aria-label="External guest invitations" className="zoiko-input !w-[190px]" disabled={readOnly} value={v.externalGuests} onChange={(e) => set("externalGuests", e.target.value as ExternalGuestPolicy)}>
                <option value="NOT_ALLOWED">Members only</option>
                <option value="APPROVAL">Approval if required</option>
                <option value="ALLOWED">Allowed</option>
              </select>
            </div>
            <label className={`${card} flex cursor-pointer items-center justify-between gap-2`}>
              <span>
                <span className="block text-[13px] font-semibold text-[var(--ink)]">Recording / AI recap</span>
                <span className="text-[11.5px] text-[var(--ink3)]">{v.recordingAllowed ? "Allowed for meetings from this template" : "Off by default"}</span>
              </span>
              <input type="checkbox" disabled={readOnly} checked={v.recordingAllowed} onChange={(e) => set("recordingAllowed", e.target.checked)} aria-label="Allow recording or AI recap" />
            </label>
          </div>
        </section>

        {template.canReview && template.status === "PENDING_REVIEW" && (
          <section className={card} data-testid="review-panel">
            <h3 className="text-[14px] font-semibold text-[var(--ink)]">Review</h3>
            <p className="mb-2 text-[12px] text-[var(--ink3)]">Submitted by {template.owner.name}. Approving makes it available to {template.teamCalendar?.name ?? "the team"}.</p>
            <label htmlFor="tp-note" className={label}>
              Note if you send it back (optional)
            </label>
            <input id="tp-note" className="zoiko-input w-full" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" />
            <div className="mt-2 flex gap-2">
              <button type="button" className="zoiko-btn sm pri" disabled={review.isPending || dirty} onClick={() => review.mutate({ id: template.id, approve: true })}>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Approve
              </button>
              <button type="button" className="zoiko-btn sm" disabled={review.isPending || dirty} onClick={() => review.mutate({ id: template.id, approve: false, note: note.trim() || undefined })}>
                Send back
              </button>
            </div>
            {dirty && <p className="mt-1 text-[11.5px] text-[var(--ink3)]">Save or discard your edits first.</p>}
          </section>
        )}

        {problem && <p className="text-[12px] text-[var(--crit)]">{problem}</p>}
        {error && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {error.message}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] p-4">
        <button
          type="button"
          className="zoiko-btn"
          onClick={onUse}
          disabled={template.status !== "READY" || dirty}
          title={template.status !== "READY" ? "Only ready templates can be used" : dirty ? "Save your changes first" : undefined}
        >
          <CalendarPlus className="h-4 w-4" aria-hidden /> Use template
        </button>
        {template.canEdit &&
          (confirmDelete ? (
            <span className="flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
              Delete this template?
              <button type="button" className="zoiko-btn sm text-[var(--crit)]" disabled={remove.isPending} onClick={() => remove.mutate(template.id, { onSuccess: onDeleted })}>
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
        {template.canEdit && (
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="zoiko-btn" onClick={() => setDraft({})} disabled={!dirty || update.isPending}>
              Discard
            </button>
            {template.status === "DRAFT" && (
              <button type="button" className="zoiko-btn" onClick={() => save("READY")} disabled={update.isPending || Boolean(problem)}>
                {memberEditingTeam ? "Submit for review" : "Mark ready"}
              </button>
            )}
            <button type="button" className="zoiko-btn pri" onClick={() => save()} disabled={!dirty || update.isPending || Boolean(problem)}>
              {update.isPending ? "Saving…" : memberEditingTeam && template.status === "READY" ? "Save and submit for review" : "Save template"}
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

/** What an invitation from this template looks like, on a sample date. */
function InvitationPreview({ template }: { template: MeetingTemplate }) {
  const sample = useMemo(() => {
    const d = new Date(Date.now() + Math.max(template.minNoticeHours, 24) * 3_600_000);
    while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d;
  }, [template.minNoticeHours]);
  const end = new Date(sample.getTime() + template.durationMinutes * 60_000);
  const Loc = LOCATION[template.locationType].icon;
  return (
    <aside className="hidden flex-col gap-3 2xl:flex" aria-label="Invitation preview">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--ink)]">Invitation preview</h3>
            <p className="text-[12px] text-[var(--ink3)]">What invitees receive</p>
          </div>
          <span className="flex items-center gap-1.5 text-[12px] text-[#22B07D]">
            <span className="h-2 w-2 rounded-full bg-[#22B07D]" aria-hidden /> Live
          </span>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4" data-testid="invitation-preview">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-ink)]">Invitation</p>
          <h4 className="mt-1 text-[17px] font-bold text-[var(--ink)]">{template.title}</h4>
          <ul className="mt-3 space-y-1.5 text-[12.5px] text-[var(--ink2)]">
            <li className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" aria-hidden /> {longDay.format(sample)} · {formatTime(sample)}–{formatTime(end)} ({template.durationMinutes} min)
            </li>
            <li className="flex items-start gap-2">
              <Loc className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                {LOCATION[template.locationType].label}
                {template.locationDetail && <span className="block break-all text-[var(--ink3)]">{template.locationDetail}</span>}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <User className="h-3.5 w-3.5" aria-hidden /> Organizer: {template.scope === "TEAM" ? `you, for ${template.teamCalendar?.name ?? "the team"}` : "you"}
            </li>
            {template.defaultAttendees.length > 0 && (
              <li className="flex items-start gap-2">
                <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {template.defaultAttendees.join(", ")}
              </li>
            )}
          </ul>
          {template.agenda && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <p className="text-[11.5px] font-semibold text-[var(--ink2)]">Agenda</p>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-[var(--ink)]">{template.agenda}</p>
            </div>
          )}
          <div className="mt-3 flex gap-2" aria-hidden>
            <span className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-semibold text-white">Accept</span>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11.5px] text-[var(--ink2)]">Maybe</span>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11.5px] text-[var(--ink2)]">Decline</span>
          </div>
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--ink3)]">Changes are not applied to existing events.</p>
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink)]">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Permission &amp; privacy safeguards
        </p>
        <ul className="mt-2 space-y-1.5 text-[12px] text-[var(--ink3)]">
          <li>• Conflicts with your calendar are checked before a meeting is created.</li>
          <li>• External guests: {GUESTS[template.externalGuests].toLowerCase()}.</li>
          <li>• Recording and AI recap: {template.recordingAllowed ? "allowed" : "off by default"}.</li>
          <li>• {template.scope === "TEAM" ? "Team templates are approved by a team manager before the team can use them." : "Only you can see and use this template."}</li>
        </ul>
      </div>
    </aside>
  );
}
