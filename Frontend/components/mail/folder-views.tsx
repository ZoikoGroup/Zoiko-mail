"use client";

/**
 * Per-folder presentation for Scheduled, Archive, Spam and Trash.
 *
 * These four folders read differently from Inbox: each has its own header,
 * notice, tabs and reading-pane status. MailClient asks getFolderView() for
 * the folder it is showing and falls back to the plain Inbox layout when there
 * is none (Inbox, Starred, Drafts, Sent, Snoozed, shared inboxes).
 *
 * Only what the API can back is shown. The designs also call for a previous
 * folder ("From Inbox"), archive and trash dates, spam verdicts and a block
 * list; those need backend fields that do not exist yet.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive, CalendarClock, Clock, FileWarning, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, Trash2,
  type LucideIcon,
} from "lucide-react";
import type { MailAttachment, MailListFolder } from "@/lib/mail-api";

export type ViewFolder = "SCHEDULED" | "ARCHIVE" | "SPAM" | "TRASH";

/** What a tab narrows the list to. Server-side filters, except `bucket`. */
export interface TabFilter {
  starredOnly?: boolean;
  unreadOnly?: boolean;
  hasAttachment?: boolean;
  /** Only mail from the last N days. */
  recentDays?: number;
  /** Scheduled only: when it is due to go, worked out on the client. */
  bucket?: ScheduleBucket;
}

export interface FolderTab {
  key: string;
  label: string;
  filter?: TabFilter;
}

export interface FolderView {
  folder: ViewFolder;
  eyebrow: string;
  title: string;
  subtitle: string;
  countLabel: (n: number) => string;
  countTone: "accent" | "crit";
  tabs: FolderTab[];
  searchPlaceholder: string;
  listCaption: string;
  sortLabel: string;
  footerNote: string;
  paneEyebrow: string;
  /** Scheduled is due-date ordered and small; it loads in one page. */
  pageSize: number;
  showDateFilter: boolean;
  aletHint: string;
}

const VIEWS: Record<ViewFolder, FolderView> = {
  SCHEDULED: {
    folder: "SCHEDULED",
    eyebrow: "My mailbox / Send-later queue",
    title: "Scheduled",
    subtitle: "Review messages waiting for their scheduled send time.",
    countLabel: (n) => `${n} upcoming`,
    countTone: "accent",
    tabs: [
      { key: "upcoming", label: "Upcoming" },
      { key: "today", label: "Today", filter: { bucket: "today" } },
      { key: "week", label: "This week", filter: { bucket: "week" } },
      { key: "later", label: "Later", filter: { bucket: "later" } },
    ],
    searchPlaceholder: "Find scheduled messages",
    listCaption: "Sorted by next send time",
    sortLabel: "Earliest first",
    footerNote: "Pending messages are not yet sent",
    paneEyebrow: "Scheduled message / Awaiting send",
    pageSize: 100,
    showDateFilter: false,
    aletHint: "Review draft, recipients and tone before sending.",
  },
  ARCHIVE: {
    folder: "ARCHIVE",
    eyebrow: "My mailbox / Organized history",
    title: "Archive",
    subtitle: "Find conversations you have set aside for future reference.",
    countLabel: (n) => `${n} conversation${n === 1 ? "" : "s"}`,
    countTone: "accent",
    tabs: [
      { key: "all", label: "All archived" },
      { key: "recent", label: "Recent", filter: { recentDays: 30 } },
      { key: "files", label: "With files", filter: { hasAttachment: true } },
      { key: "starred", label: "Starred", filter: { starredOnly: true } },
    ],
    searchPlaceholder: "Search archived mail",
    listCaption: "Archived conversations",
    sortLabel: "Newest first",
    footerNote: "Only mail you can access is shown",
    paneEyebrow: "Archive / Conversation view",
    pageSize: 25,
    showDateFilter: true,
    aletHint: "Summarize this thread, find decisions, or draft a follow-up.",
  },
  SPAM: {
    folder: "SPAM",
    eyebrow: "Mail safety / Restricted review",
    title: "Spam & Threat Review",
    subtitle: "Review suspicious mail without exposing unsafe content.",
    countLabel: (n) => `${n} flagged`,
    countTone: "crit",
    tabs: [
      { key: "all", label: "All" },
      { key: "unread", label: "Unread", filter: { unreadOnly: true } },
      { key: "files", label: "With attachments", filter: { hasAttachment: true } },
    ],
    searchPlaceholder: "Search suspicious messages",
    listCaption: "Flagged conversations",
    sortLabel: "Newest first",
    footerNote: "Links and images are blocked in previews",
    paneEyebrow: "Spam / Message inspection",
    pageSize: 25,
    showDateFilter: true,
    aletHint: "Summarize sender anomalies and recommend safe next steps.",
  },
  TRASH: {
    folder: "TRASH",
    eyebrow: "My mailbox / Message recovery",
    title: "Trash & Recovery",
    subtitle: "Review removed messages and restore anything you still need.",
    countLabel: (n) => `${n} item${n === 1 ? "" : "s"}`,
    countTone: "accent",
    tabs: [
      { key: "all", label: "All deleted" },
      { key: "recent", label: "Last 7 days", filter: { recentDays: 7 } },
      { key: "files", label: "With files", filter: { hasAttachment: true } },
    ],
    searchPlaceholder: "Search deleted conversations",
    listCaption: "Deleted messages",
    sortLabel: "Newest first",
    footerNote: "Only items you're permitted to access are shown",
    paneEyebrow: "Trash / Conversation recovery",
    pageSize: 25,
    showDateFilter: true,
    aletHint: "Find what you deleted and why it might still matter.",
  },
};

export function getFolderView(folder: MailListFolder): FolderView | null {
  return folder in VIEWS ? VIEWS[folder as ViewFolder] : null;
}

// ---- Dates -----------------------------------------------------------------

export type ScheduleBucket = "today" | "week" | "later";

/** Today, the rest of this week (to Sunday), or after that. */
export function scheduleBucket(iso: string | null): ScheduleBucket {
  if (!iso) return "later";
  const due = new Date(iso);
  const now = new Date();
  if (due.toDateString() === now.toDateString()) return "today";
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  endOfWeek.setHours(23, 59, 59, 999);
  return due <= endOfWeek ? "week" : "later";
}

/** "BST", "GMT+5:30" — the viewer's zone at that moment. */
export function zoneAbbr(date: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
}

export function zoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "23 Oct · 09:00" for list rows. */
export function shortSendTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}

/** "Friday, 23 October 2026 · 9:00 AM BST" for the status card. */
export function longSendTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ${zoneAbbr(d)}`;
}

/** "Fri, 23 Oct · 9:00 AM BST" for the next-send banner. */
function bannerSendTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time} ${zoneAbbr(d)}`;
}

/** YYYY-MM-DD for N days ago, the format the dateAfter filter takes. */
export function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ---- List chrome -------------------------------------------------------------

export function CountPill({ view, total }: { view: FolderView; total: number }) {
  const tone =
    view.countTone === "crit"
      ? "border-[var(--crit)]/40 bg-[var(--crit-soft)] text-[var(--crit)]"
      : "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-ink)]";
  return (
    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11.5px] font-medium ${tone}`}>
      {view.countLabel(total)}
    </span>
  );
}

const BANNERS: Record<Exclude<ViewFolder, "SCHEDULED">, { icon: LucideIcon; title: string; body: string }> = {
  ARCHIVE: {
    icon: Archive,
    title: "Organized. Not deleted.",
    body: "Archive removes conversations from Inbox while keeping them searchable.",
  },
  SPAM: {
    icon: ShieldCheck,
    title: "Protection-first preview",
    body: "External images, links and attachments stay blocked while you review.",
  },
  TRASH: {
    icon: RotateCcw,
    title: "Restore before disposal.",
    body: "Messages stay here until you restore them, delete them forever or empty Trash.",
  },
};

function IconTile({ icon: Icon, tone = "accent" }: { icon: LucideIcon; tone?: "accent" | "crit" }) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
        tone === "crit"
          ? "border-[var(--crit)]/40 bg-[var(--crit-soft)] text-[var(--crit)]"
          : "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-ink)]"
      }`}
      aria-hidden
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** The strip between the header and the tabs. */
export function FolderBanner({ view, nextSendAt }: { view: FolderView; nextSendAt: string | null }) {
  if (view.folder === "SCHEDULED") {
    return (
      <div className="flex items-center gap-2.5 border-y border-[var(--border)] bg-[var(--s2)] px-5 py-2.5 text-[12.5px]">
        <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
          {nextSendAt ? <>Next send: {bannerSendTime(nextSendAt)}</> : "Nothing waiting to send"}
        </span>
        <span className="shrink-0 text-[11.5px] text-[var(--ink3)]">{zoneName()}</span>
      </div>
    );
  }
  const banner = BANNERS[view.folder];
  return (
    <div className="flex items-center gap-3 border-y border-[var(--border)] bg-[var(--s2)] px-5 py-3">
      <IconTile icon={banner.icon} />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--ink)]">{banner.title}</p>
        <p className="text-[12px] leading-snug text-[var(--ink3)]">{banner.body}</p>
      </div>
    </div>
  );
}

/**
 * A small anchored menu for chip-sized triggers.
 *
 * The shared DropdownMenu fixes its trigger at 28px square, which suits icon
 * buttons but not a labelled filter chip.
 */
export function Popover({
  trigger,
  children,
  align = "left",
  placement = "below",
  triggerClassName = "",
  label,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  placement?: "below" | "above";
  triggerClassName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--sh2)] ${
            align === "right" ? "right-0" : "left-0"
          } ${placement === "above" ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const chipClass =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[12px] text-[var(--ink2)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export function MenuOption({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition hover:bg-[var(--s2)] ${
        active ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"
      }`}
    >
      {children}
    </button>
  );
}

// ---- Reading pane --------------------------------------------------------------

export function StatusTag({ tone = "accent", children }: { tone?: "accent" | "crit" | "muted"; children: ReactNode }) {
  const toneClass =
    tone === "crit"
      ? "border-[var(--crit)]/40 bg-[var(--crit-soft)] text-[var(--crit)]"
      : tone === "muted"
        ? "border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]"
        : "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-ink)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

/** The card under the sender that says where the message stands. */
export function StatusCard({
  folder,
  scheduledAt,
  action,
}: {
  folder: ViewFolder;
  scheduledAt: string | null;
  /** Scheduled: the Reschedule control. */
  action?: ReactNode;
}) {
  if (folder === "SPAM") {
    return (
      <div className="flex items-start gap-3.5 rounded-xl border border-[var(--crit)]/40 bg-[var(--crit-soft)] px-4 py-3.5" role="note">
        <IconTile icon={ShieldAlert} tone="crit" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--ink)]">This message may be unsafe</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--ink2)]">
            Links, remote images and attachment previews are disabled. Check the sender before taking action.
          </p>
        </div>
        <span className="shrink-0 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--crit)]">Caution</span>
      </div>
    );
  }

  const content =
    folder === "SCHEDULED"
      ? {
          icon: CalendarClock,
          kicker: "Scheduled to send",
          title: scheduledAt ? longSendTime(scheduledAt) : "No send time set",
          body: `${zoneName()} · Not sent yet`,
        }
      : folder === "ARCHIVE"
        ? { icon: Archive, kicker: null, title: "In Archive", body: "Removed from Inbox · Still searchable and available to restore" }
        : { icon: Trash2, kicker: null, title: "In Trash", body: "Restore it to Inbox, or delete it forever" };

  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3.5">
      <IconTile icon={content.icon} />
      <div className="min-w-0 flex-1">
        {content.kicker && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink2)]">{content.kicker}</p>
        )}
        <p className="text-[14px] font-semibold text-[var(--ink)]">{content.title}</p>
        <p className="text-[12px] text-[var(--ink3)]">{content.body}</p>
      </div>
      {action}
    </div>
  );
}

/** HTML mail flattened to text: no links to follow, no images to load. */
export function htmlToText(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script, head").forEach((node) => node.remove());
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6").forEach((node) => node.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Spam is read as plain text so nothing in it can be clicked or fetched. */
export function RestrictedBody({ html, text }: { html: string | null; text: string | null }) {
  const body = text?.trim() || (html ? htmlToText(html) : "");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11.5px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ink)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden /> Restricted message preview
        </span>
        <span className="text-[var(--ink3)]">Plain text · no active links</span>
      </div>
      <div className="whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[var(--s2)] px-4 py-3.5 text-[13.5px] leading-relaxed text-[var(--ink)]">
        {body || "(no content)"}
      </div>
    </div>
  );
}

/** Spam attachments are listed, never previewed or downloaded from here. */
export function BlockedAttachments({ attachments }: { attachments: MailAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2">
      {attachments.map((file) => (
        <li key={file.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] px-4 py-3">
          <IconTile icon={FileWarning} tone="crit" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[var(--ink)]">{file.fileName}</p>
            <p className="text-[11.5px] text-[var(--ink3)]">Attachment preview restricted · Move to Inbox to open it</p>
          </div>
          <StatusTag tone="crit">Blocked</StatusTag>
        </li>
      ))}
    </ul>
  );
}

/** Placeholder for the Alet assistant until it lands. */
export function AletCard({ hint }: { hint: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] px-4 py-3" title="Alet is coming soon">
      <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
      <p className="min-w-0 flex-1 text-[12.5px] text-[var(--ink2)]">
        <span className="mr-2 font-semibold text-[var(--ink)]">Alet assistance</span>
        {hint}
      </p>
      <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
        Soon
      </span>
    </div>
  );
}

// ---- Reschedule ----------------------------------------------------------------

function at(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** A send-time picker: presets plus a custom date and time. */
export function ReschedulePicker({
  onPick,
  disabled,
  placement = "below",
  align = "right",
  className,
  children,
}: {
  onPick: (at: Date) => void;
  disabled?: boolean;
  placement?: "below" | "above";
  align?: "left" | "right";
  className: string;
  children: ReactNode;
}) {
  const [custom, setCustom] = useState("");
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now);
  monday.setDate(now.getDate() + (((1 - now.getDay() + 7) % 7) || 7));
  const presets = [
    { label: "Tomorrow morning", date: at(tomorrow, 9) },
    { label: "Tomorrow afternoon", date: at(tomorrow, 14) },
    { label: "Monday morning", date: at(monday, 9) },
  ];
  // The earliest a custom time may be: a minute from now, as datetime-local.
  const min = new Date(now.getTime() + 60_000 - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

  if (disabled) {
    return (
      <button type="button" disabled className={`${className} opacity-50`}>
        {children}
      </button>
    );
  }
  return (
    <Popover trigger={children} triggerClassName={className} placement={placement} align={align}>
      {(close) => (
        <div className="w-64">
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Reschedule send</p>
          {presets.map((preset) => (
            <MenuOption key={preset.label} onClick={() => { onPick(preset.date); close(); }}>
              <span className="flex-1">{preset.label}</span>
              <span className="text-[11.5px] text-[var(--ink3)]">{shortSendTime(preset.date.toISOString())}</span>
            </MenuOption>
          ))}
          <div className="mt-1 flex items-center gap-1.5 border-t border-[var(--border)] px-1 pb-1 pt-2">
            <input
              type="datetime-local"
              value={custom}
              min={min}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Custom send time"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)]"
            />
            <button
              type="button"
              disabled={!custom || new Date(custom) <= new Date()}
              onClick={() => { onPick(new Date(custom)); close(); }}
              className="zoiko-btn sm pri disabled:opacity-50"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
