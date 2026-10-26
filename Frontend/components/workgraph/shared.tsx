"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, FileText, Lock, Mail, StickyNote, Users, X, type LucideIcon } from "lucide-react";
import type { CommitmentDisplay, DecisionStatus, DependencyState, EvidenceView, OwnerView } from "@/lib/workgraph-api";
import { usePeople } from "@/lib/workgraph-hooks";
import { formatDue, instantToInputs, preferredZone, zoneChoices, zonedToInstant } from "@/lib/workgraph-dates";

export function pill(hex: string) {
  return { color: hex, borderColor: `color-mix(in srgb, ${hex} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${hex} 14%, transparent)` };
}

export function Pill({ hex, children, title }: { hex: string; children: ReactNode; title?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold" style={pill(hex)} title={title}>
      {children}
    </span>
  );
}

export const COLORS = { blue: "#3B7BF6", green: "#22B07D", amber: "#E0A33A", red: "#E5484D", purple: "#8B6CF6", slate: "#7C8DA6" } as const;

export const COMMITMENT_PILL: Record<CommitmentDisplay, { text: string; hex: string }> = {
  AWAITING: { text: "Awaiting", hex: COLORS.purple },
  PAST_DUE: { text: "Past due", hex: COLORS.amber },
  IN_PROGRESS: { text: "In progress", hex: COLORS.green },
  RECORDED: { text: "Recorded", hex: COLORS.green },
  CANCELLED: { text: "Cancelled", hex: COLORS.slate },
};
export const DECISION_PILL: Record<DecisionStatus, { text: string; hex: string }> = {
  PENDING: { text: "Pending", hex: COLORS.amber },
  APPROVED: { text: "Approved", hex: COLORS.green },
  DEFERRED: { text: "Deferred", hex: COLORS.red },
  SUPERSEDED: { text: "Superseded", hex: COLORS.slate },
};
export const DEPENDENCY_PILL: Record<DependencyState, { hex: string }> = {
  WAITING: { hex: COLORS.amber },
  BLOCKED: { hex: COLORS.red },
  UNBLOCKED: { hex: COLORS.green },
};

export function Stat({ icon: Icon, hex, value, label, hint }: { icon: LucideIcon; hex: string; value: number; label: string; hint: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border" style={pill(hex)} aria-hidden>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[24px] font-bold leading-none text-[var(--ink)]">{value}</span>
        <span className="mt-1 block text-[13px] font-semibold text-[var(--ink)]">{label}</span>
        <span className="block truncate text-[11.5px] text-[var(--ink3)]">{hint}</span>
      </span>
    </div>
  );
}

/** A due date the way the register shows it: "26 Oct · 10:00" over its zone. */
export function DueCell({ iso, zone, late }: { iso: string | null; zone: string; late?: boolean }) {
  const due = formatDue(iso, zone);
  if (!due) return <span className="text-[12.5px] text-[var(--ink3)]">No date</span>;
  return (
    <span className="block leading-tight">
      <span className={`block text-[12.5px] tabular-nums ${late ? "text-[#E0A33A]" : "text-[var(--ink)]"}`}>
        {due.date} · {due.time}
      </span>
      <span className="block text-[11px] text-[var(--ink3)]">{due.zone}</span>
    </span>
  );
}

export function OwnerLine({ owner, sub }: { owner: OwnerView; sub?: string }) {
  return (
    <span className="block min-w-0 leading-tight">
      <span className="block truncate text-[12.5px] text-[var(--ink)]">{owner.isMe ? "Me" : owner.name}</span>
      <span className="block truncate text-[11px] text-[var(--ink3)]">{sub ?? (owner.isMe ? "My responsibility" : owner.kind === "TEAM" ? "Named owner" : "Colleague")}</span>
    </span>
  );
}

const EVIDENCE_ICON: Record<EvidenceView["kind"], LucideIcon> = { EMAIL: Mail, MEETING: CalendarDays, DOCUMENT: FileText, NOTE: StickyNote };
const EVIDENCE_WORD: Record<EvidenceView["kind"], string> = { EMAIL: "Email", MEETING: "Meeting", DOCUMENT: "Document", NOTE: "Note" };

export function evidenceSummary(items: EvidenceView[]): string {
  if (items.length === 0) return "No source";
  const kinds = Array.from(new Set(items.map((i) => i.kind)));
  return `${kinds.length === 1 ? EVIDENCE_WORD[kinds[0]!] : "Sources"} linked`;
}

/** The sources behind something. A source the viewer cannot open is named only as restricted. */
export function EvidenceList({ items, onRemove, empty = "No source linked yet." }: { items: EvidenceView[]; onRemove?: (item: EvidenceView) => void; empty?: string }) {
  if (items.length === 0) return <p className="text-[12px] text-[var(--ink3)]">{empty}</p>;
  return (
    <ul className="space-y-2" data-testid="evidence-list">
      {items.map((item) => {
        const Icon = item.canOpen ? EVIDENCE_ICON[item.kind] : Lock;
        const when = item.occurredAt ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(item.occurredAt)) : null;
        return (
          <li key={item.id} className="flex items-start gap-2 text-[12.5px]">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[var(--ink)]">
                {item.canOpen || item.addedByMe ? `${EVIDENCE_WORD[item.kind]}: ` : ""}
                {item.openPath ? (
                  <Link href={item.openPath} className="hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
              </span>
              <span className="block text-[11px] text-[var(--ink3)]">
                {when ?? "No date"}
                {!item.canOpen ? " · you cannot open this source" : ""}
              </span>
            </span>
            {onRemove && (
              <button type="button" aria-label={`Remove ${item.label}`} onClick={() => onRemove(item)} className="rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--crit)]">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";
export const problemText = "mt-1 text-[11.5px] text-[var(--crit)]";

export interface OwnerValue {
  /** What is in the box. */
  text: string;
  /** Set when a colleague was chosen. */
  email?: string;
}

export const ownerFromView = (owner: OwnerView | null): OwnerValue => (owner && owner.kind !== "NONE" ? { text: owner.name, email: owner.email ?? undefined } : { text: "" });

/** What to send for an owner box: a colleague by address, or a named team. Empty means "me". */
export function ownerPayload(value: OwnerValue): { ownerEmail?: string; ownerLabel?: string } {
  if (value.email) return { ownerEmail: value.email };
  const text = value.text.trim();
  if (!text) return {};
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { ownerEmail: text.toLowerCase() };
  return { ownerLabel: text };
}

/**
 * Who is accountable: pick a colleague as you type, or type a team name that
 * is not one (a team is a name, not an account). Empty means you.
 */
export function OwnerField({ id, value, onChange, placeholder = "Me (default) — or a colleague, or a team" }: { id: string; value: OwnerValue; onChange: (next: OwnerValue) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value.email ? "" : value.text.trim()), 150);
    return () => window.clearTimeout(t);
  }, [value.text, value.email]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const people = usePeople(debounced);
  const matches = debounced ? (people.data ?? []).slice(0, 6) : [];

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          autoComplete="off"
          className="zoiko-input w-full"
          placeholder={placeholder}
          value={value.text}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange({ text: e.target.value });
            setOpen(true);
          }}
        />
        {value.email && (
          <button type="button" aria-label="Clear owner" onClick={() => onChange({ text: "" })} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--ink3)] hover:text-[var(--ink)]">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
      {open && matches.length > 0 && !value.email && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--sh3)]">
          {matches.map((p) => (
            <li key={p.email} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--s2)]"
                onClick={() => {
                  onChange({ text: p.name, email: p.email });
                  setOpen(false);
                }}
              >
                <Users className="h-3.5 w-3.5 text-[var(--ink3)]" aria-hidden />
                <span className="flex-1 truncate text-[var(--ink)]">{p.name}</span>
                <span className="truncate text-[11.5px] text-[var(--ink3)]">{p.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.text.trim() && !value.email && <p className="mt-1 text-[11px] text-[var(--ink3)]">Not a colleague, so this is saved as a team name.</p>}
    </div>
  );
}

export interface DueValue {
  date: string;
  time: string;
  zone: string;
}

export const dueFromIso = (iso: string | null | undefined, zone: string): DueValue => ({ ...instantToInputs(iso, zone), zone });
export const emptyDue = (): DueValue => ({ date: "", time: "10:00", zone: preferredZone() });

/** The instant a due value names, or null when no date was chosen. */
export function dueToIso(value: DueValue): string | null {
  if (!value.date) return null;
  return zonedToInstant(value.date, value.time || "00:00", value.zone).toISOString();
}

export function DueFields({ idPrefix, value, onChange, dateLabel = "Due date" }: { idPrefix: string; value: DueValue; onChange: (next: DueValue) => void; dateLabel?: string }) {
  const zones = zoneChoices();
  const zoneList = zones.includes(value.zone) ? zones : [value.zone, ...zones];
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr]">
      <div>
        <label htmlFor={`${idPrefix}-date`} className={label}>
          {dateLabel}
        </label>
        <input id={`${idPrefix}-date`} type="date" className="zoiko-input w-full" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-time`} className={label}>
          Time
        </label>
        <input id={`${idPrefix}-time`} type="time" className="zoiko-input w-full" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} disabled={!value.date} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-zone`} className={label}>
          Time zone
        </label>
        <select id={`${idPrefix}-zone`} className="zoiko-input w-full" value={value.zone} onChange={(e) => onChange({ ...value, zone: e.target.value })} disabled={!value.date}>
          {zoneList.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function VisibilityField({ id, value, onChange, disabled }: { id: string; value: "PRIVATE" | "WORKSPACE"; onChange: (next: "PRIVATE" | "WORKSPACE") => void; disabled?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className={label}>
        Who can see it
      </label>
      <select id={id} className="zoiko-input w-full" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as "PRIVATE" | "WORKSPACE")}>
        <option value="PRIVATE">Only me, and whoever owns or approves it</option>
        <option value="WORKSPACE">Everyone in the workspace</option>
      </select>
    </div>
  );
}

export function SavedTick({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-[#22B07D]" role="status">
      <Check className="h-3.5 w-3.5" aria-hidden /> {children}
    </span>
  );
}
