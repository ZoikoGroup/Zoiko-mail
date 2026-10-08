"use client";

/**
 * The webmail client, shell-free on purpose.
 *
 * Rendered by the member route (/mail, inside AppShell) and the admin route
 * (/admin/inbox, inside AdminShell), so an Admin reads their own mail without
 * being ejected into the member workspace and losing the admin rail.
 * One implementation, two shells — never a per-role copy.
 */

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  useMailList,
  useMessage,
  useUpdateMailItem,
  useBulkMailAction,
  useUnreadCounts,
  useMailLabels,
  useCreateLabel,
  useDeleteLabel,
  useAssignLabel,
  useRemoveLabel,
  usePermanentlyDelete,
  useEmptyTrash,
  useDeleteDraft,
  useThread,
  useSnoozeMessage,
} from "@/lib/mail-hooks";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { Modal } from "@/components/ui/Modal";
import type { ComposerMode } from "@/lib/mail-hooks";
import {
  downloadAttachment,
  type MailFolder,
  type MailListFolder,
  type MailItem,
  type MailListItem,
} from "@/lib/mail-api";
import {
  DropdownMenu, DropdownItem,
} from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Inbox, Send, FileText, Archive, Trash2, Star, Loader2, AlertCircle,
  ChevronLeft, ChevronRight, Paperclip, ArrowLeft, MailOpen,
  Pencil, Reply, ReplyAll, Forward, Search, ShieldAlert, Tag, Settings2, X,
  SlidersHorizontal, MailCheck, Clock, ChevronDown,
} from "lucide-react";
import { AttachmentList } from "@/components/mail/AttachmentPreview";
import { Sparkles, BrainCircuit } from "lucide-react";
import { useCreateAiAction } from "@/lib/ai-hooks";
import { parseMailQuery } from "@/lib/mail-search";
import { MailRow, groupByDay } from "@/components/mail/MailRow";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { QuickReply } from "@/components/mail/QuickReply";

const FOLDERS: { key: MailFolder; label: string; icon: any }[] = [
  { key: "INBOX", label: "Inbox", icon: Inbox },
  { key: "SENT", label: "Sent", icon: Send },
  { key: "DRAFTS", label: "Drafts", icon: FileText },
  { key: "ARCHIVE", label: "Archive", icon: Archive },
  { key: "TRASH", label: "Trash", icon: Trash2 },
  { key: "QUARANTINE", label: "Quarantine", icon: ShieldAlert },
];

// Fixed palette for user-created labels (hex required by the backend schema).
const LABEL_COLORS = [
  "#0f766e", "#2563eb", "#7c3aed", "#be123c",
  "#b45309", "#15803d", "#dc2626", "#334155",
];

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Same palette + hash as MailRow's sender avatars, duplicated here (not
// exported from MailRow.tsx) so a recipient's avatar in Sent gets the same
// color every time it's shown, instead of a one-off generic color.
const AVATAR_COLORS = [
  "#0f766e", "#2563eb", "#7c3aed", "#be123c",
  "#b45309", "#15803d", "#dc2626", "#334155", "#0369a1", "#a21caf",
];

function hashColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

function Avatar({ name, className = "h-6 w-6 text-[10px]" }: { name?: string | null; className?: string }) {
  const label = name && name.trim() ? name.trim() : "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ backgroundColor: hashColor(label) }}
    >
      {avatarInitials(label)}
    </span>
  );
}

/**
 * readableEmailHtml() reads the app's current CSS variables, but it only
 * runs when the component housing the iframe re-renders — toggling
 * Light/Dark doesn't itself touch this component's state, so without this
 * the colors were stale until something unrelated (switching messages,
 * a reload) forced a re-render. Watching <html> for the attribute the
 * theme toggle flips and bumping a counter on change makes the switch
 * take effect immediately; the counter is used as part of the iframe's
 * `key`, which also remounts it so the new colors apply cleanly.
 */
function useThemeRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const target = document.documentElement;
    const observer = new MutationObserver(() => setRev((r) => r + 1));
    observer.observe(target, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => observer.disconnect();
  }, []);
  return rev;
}

/**
 * Message HTML is written by whoever sent it and usually assumes it will
 * sit on a plain white page: it rarely sets its own text color, it just
 * relies on the browser default (black). Dropping that straight into an
 * iframe with a transparent/dark background makes the (invisible) black
 * text disappear into the dark theme. Wrapping it with our own stylesheet
 * gives it a readable default — a dark card with light text — without
 * requiring a white background, while still letting any colors the email
 * itself sets come through.
 */
function readableEmailHtml(html: string): string {
  // Pull the live theme colors from the app shell rather than hard-coding
  // one mode: the iframe's own document has no idea whether the app is
  // currently in light or dark mode, so without this an email with no
  // color of its own renders in whichever mode we guessed — invisible in
  // the other one. Reading the CSS variables already in use on <html>
  // keeps it correct in both, and it re-reads on every render, so it
  // follows the Light/Dark toggle too.
  let textColor = "#1f2937";
  let linkColor = "#2563eb";
  let quoteColor = "#6b7280";
  let quoteBorder = "#d1d5db";
  if (typeof window !== "undefined") {
    const styles = getComputedStyle(document.documentElement);
    textColor = styles.getPropertyValue("--ink").trim() || textColor;
    linkColor = styles.getPropertyValue("--accent").trim() || linkColor;
    quoteColor = styles.getPropertyValue("--ink3").trim() || quoteColor;
    quoteBorder = styles.getPropertyValue("--border").trim() || quoteBorder;
  }
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    html, body {
      margin: 0;
      padding: 12px;
      background: transparent;
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.55;
      word-wrap: break-word;
    }
    a { color: ${linkColor}; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 2px solid ${quoteBorder}; margin: 0 0 0 8px; padding-left: 10px; color: ${quoteColor}; }
    table { max-width: 100%; }
  </style></head><body>${html}</body></html>`;
}

interface MailClientProps {
  /**
   * Controlled folder, set by a parent that renders its own rail — the new
   * WebmailShell's FolderRail does, since the design puts the rail in the
   * shell, not inside this component. Admin/Owner's inbox pages pass
   * nothing and keep today's self-contained behaviour (internal state,
   * internal rail) unchanged.
   */
  folder?: MailListFolder;
  onFolderChange?: (folder: MailListFolder) => void;
  /** Hide this component's own folder rail + mobile folder pills — the
   * parent is rendering them instead (WebmailShell's FolderRail). */
  hideRail?: boolean;
  /**
   * Controlled search text, set by a parent that renders its own search box
   * — WebmailShell's TopBar does. Admin/Owner's inbox pages pass nothing
   * and keep this component's own internal search input (hideSearchBox
   * stays false for them too, see below).
   */
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  /** Hide this component's own search input — the parent is rendering one
   * instead (WebmailShell's TopBar). Operator parsing still runs on
   * whatever searchQuery the parent feeds in. */
  hideSearchBox?: boolean;
}

/**
 * Exposed via ref so a parent shell's own Compose button (WebmailShell's
 * FolderRail has one, since the rail is now owned by the shell, not by
 * this component) can open this component's compose modal without MailClient
 * needing to also lift its entire compose-modal state up to the parent.
 */
export interface MailClientHandle {
  openCompose: (mode: ComposerMode, source: MailItem | null) => void;
}

export const MailClient = forwardRef<MailClientHandle, MailClientProps>(function MailClient(
  {
    folder: controlledFolder,
    onFolderChange,
    hideRail = false,
    searchQuery: controlledSearchQuery,
    onSearchQueryChange,
    hideSearchBox = false,
  },
  ref
) {
  const [internalFolder, setInternalFolder] = useState<MailListFolder>("INBOX");
  const folder = controlledFolder ?? internalFolder;
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ open: boolean; mode: ComposerMode; source: MailItem | null }>({
    open: false,
    mode: "new",
    source: null,
  });
  const openCompose = (mode: ComposerMode, source: MailItem | null) =>
    setCompose({ open: true, mode, source });
  useImperativeHandle(ref, () => ({ openCompose }));

  // Filters
  const [internalSearchInput, setInternalSearchInput] = useState("");
  const searchInput = controlledSearchQuery ?? internalSearchInput;
  const setSearchInput = onSearchQueryChange ?? setInternalSearchInput;
  const [q, setQ] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [dateAfter, setDateAfter] = useState("");
  const [dateBefore, setDateBefore] = useState("");
  const { data: labels = [] } = useMailLabels();

  const advancedActive = fromFilter || toFilter || hasAttachment || dateAfter || dateBefore || unreadOnly;
  const clearAdvanced = () => {
    setFromFilter("");
    setToFilter("");
    setHasAttachment(false);
    setDateAfter("");
    setDateBefore("");
    setUnreadOnly(false);
    setShowAdvanced(false);
  };

  // Debounce search input → query params. Operators (from:, to:, has:,
  // is:, after:, before:) populate the same advanced-filter state the
  // panel below edits by hand — typing "from:hr has:attachment" here does
  // exactly what filling in those two fields manually would do. Whatever
  // text is left over becomes the free-text `q` search.
  useEffect(() => {
    const t = setTimeout(() => {
      const parsed = parseMailQuery(searchInput);
      setQ(parsed.q);
      if (parsed.from) setFromFilter(parsed.from);
      if (parsed.to) setToFilter(parsed.to);
      if (parsed.hasAttachment) setHasAttachment(true);
      if (parsed.dateAfter) setDateAfter(parsed.dateAfter);
      if (parsed.dateBefore) setDateBefore(parsed.dateBefore);
      if (parsed.unreadOnly) setUnreadOnly(true);
      if (parsed.starredOnly) setStarredOnly(true);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setCheckedIds(new Set());
  }, [starredOnly, unreadOnly, labelFilter, fromFilter, toFilter, hasAttachment, dateAfter, dateBefore]);

  // Bulk selection
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const bulk = useBulkMailAction();

  const toggleChecked = (messageId: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

  const runBulk = (action: Parameters<typeof bulk.mutate>[0]["action"]) => {
    if (checkedIds.size === 0) return;
    bulk.mutate(
      { messageIds: Array.from(checkedIds), action },
      { onSuccess: () => setCheckedIds(new Set()) }
    );
  };

  const { data: unreadCounts } = useUnreadCounts();
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const deleteDraft = useDeleteDraft();
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const emptyTrashMut = useEmptyTrash();

  const { data, isLoading, error } = useMailList({
    folder,
    page,
    limit: 25,
    ...(q ? { q } : {}),
    ...(starredOnly ? { starredOnly: true } : {}),
    ...(unreadOnly ? { unreadOnly: true } : {}),
    ...(labelFilter ? { labelId: labelFilter } : {}),
    ...(fromFilter ? { from: fromFilter } : {}),
    ...(toFilter ? { to: toFilter } : {}),
    ...(hasAttachment ? { hasAttachment: true } : {}),
    ...(dateAfter ? { dateAfter } : {}),
    ...(dateBefore ? { dateBefore } : {}),
  });
  const items = data?.items ?? [];
  const pagination = data?.pagination;

  const allChecked = items.length > 0 && items.every((it) => checkedIds.has(it.messageId));
  const toggleAllChecked = () =>
    setCheckedIds(allChecked ? new Set() : new Set(items.map((it) => it.messageId)));

  const switchFolder = (f: MailListFolder) => {
    if (onFolderChange) onFolderChange(f);
    else setInternalFolder(f);
    setPage(1);
    setSelectedId(null);
    setSearchInput("");
    setQ("");
    setStarredOnly(false);
    setUnreadOnly(false);
    setLabelFilter("");
    setFromFilter("");
    setToFilter("");
    setHasAttachment(false);
    setDateAfter("");
    setDateBefore("");
    setShowAdvanced(false);
    setCheckedIds(new Set());
  };

  return (
    <>
      <div className="flex h-full min-h-0">
        {/* Folder rail — WebmailShell's FolderRail replaces this on /mail
            (hideRail=true there); Admin/Owner's inbox pages pass nothing
            and get this self-contained rail exactly as before. */}
        {!hideRail && (
          <aside className="hidden w-48 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-3 lg:block">
            <button onClick={() => openCompose("new", null)} className="zoiko-btn pri mb-3 w-full">
              <Pencil className="h-4 w-4" /> Compose
            </button>
            <nav className="space-y-0.5">
              {FOLDERS.map((f) => {
                const Icon = f.icon;
                const active = folder === f.key;
                const unread = unreadCounts?.[f.key] ?? 0;
                return (
                  <button
                    key={f.key}
                    onClick={() => switchFolder(f.key)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${active
                      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-ink)]"
                      : "text-[var(--ink2)] hover:bg-[var(--s2)]"
                      }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" /> {f.label}
                    {unread > 0 && (
                      <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>
        )}

        {/* List column */}
        <section
          className={`flex min-w-0 flex-col border-r border-[var(--border)] ${selectedId ? "hidden lg:flex lg:w-80 xl:w-96" : "flex flex-1"
            }`}
        >
          {/* Mobile folder switch */}
          {/* Admin/Owner's self-contained mobile strip (Compose + folder
              pills). On /mail, hideRail is set and WebmailShell renders its
              own FilterChips + ComposeFab instead — this whole block would
              otherwise duplicate both. */}
          {!hideRail && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border)] p-2 lg:hidden">
              <button
                onClick={() => openCompose("new", null)}
                className="zoiko-btn pri sm shrink-0"
              >
                <Pencil className="h-3.5 w-3.5" /> Compose
              </button>
              {FOLDERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => switchFolder(f.key)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs transition ${folder === f.key
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface)] text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)]"
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* List tabs */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-2 pt-2">
            {([
              { key: "all", label: "All", active: !unreadOnly && !starredOnly },
              { key: "unread", label: unreadCounts?.INBOX ? `Unread · ${unreadCounts.INBOX}` : "Unread", active: unreadOnly },
              { key: "starred", label: "Starred", active: starredOnly },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setPage(1);
                  if (tab.key === "all") {
                    setUnreadOnly(false);
                    setStarredOnly(false);
                  } else if (tab.key === "unread") {
                    setUnreadOnly(true);
                    setStarredOnly(false);
                  } else {
                    setStarredOnly(true);
                    setUnreadOnly(false);
                  }
                }}
                className={`shrink-0 rounded-t-md px-3 py-1.5 text-sm transition ${
                  tab.active
                    ? "border-b-2 border-[var(--accent)] font-medium text-[var(--ink)]"
                    : "text-[var(--ink3)] hover:text-[var(--ink2)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
            {/* Label quick-filters — mobile only (Screen 1's design shows
                these alongside All/Unread on mobile; desktop already has
                the separate label dropdown in the toolbar below). */}
            {labels.length > 0 && <div className="mx-1 h-4 w-px shrink-0 self-center bg-[var(--border)] lg:hidden" />}
            {labels.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setPage(1);
                  setLabelFilter((current) => (current === l.id ? "" : l.id));
                }}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition lg:hidden ${
                  labelFilter === l.id ? "text-white" : "text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)]"
                }`}
                style={labelFilter === l.id ? { backgroundColor: l.color } : undefined}
              >
                {l.name}
              </button>
            ))}
          </div>

          {/* Filter toolbar */}
          <div className="flex items-center gap-2 border-b border-[var(--border)] p-2">
            <label className="flex shrink-0 cursor-pointer items-center px-1" title="Select all on this page">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAllChecked}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
            </label>
            {!hideSearchBox && (
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search this folder…"
                  className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-7 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                {searchInput && (
                  <button
                    onClick={() => setSearchInput("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink2)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {hideSearchBox && <div className="min-w-0 flex-1" />}
            <button
              onClick={() => setStarredOnly((s) => !s)}
              className={`zoiko-btn sm shrink-0 ${starredOnly ? "pri" : ""}`}
              title={starredOnly ? "Show all messages" : "Starred only"}
            >
              <Star className={`h-3.5 w-3.5 ${starredOnly ? "fill-white" : ""}`} />
            </button>
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="h-8 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink2)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">All labels</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <button
              onClick={() => setLabelManagerOpen(true)}
              className="zoiko-btn sm shrink-0"
              title="Manage labels"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setShowAdvanced((s) => !s)}
              className={`zoiko-btn sm shrink-0 ${advancedActive ? "pri" : ""}`}
              title="Advanced filters"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {advancedActive && <span className="hidden sm:inline">Filtered</span>}
            </button>
            {folder === "TRASH" && (
              <button
                onClick={() => setConfirmEmpty(true)}
                disabled={emptyTrashMut.isPending}
                className="zoiko-btn crit sm shrink-0"
                title="Permanently delete everything in Trash"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Empty trash</span>
              </button>
            )}
          </div>

          {/* Advanced filter panel */}
          {showAdvanced && (
            <div className="border-b border-[var(--border)] bg-[var(--s2)] px-3 py-2.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">From</label>
                  <input
                    value={fromFilter}
                    onChange={(e) => setFromFilter(e.target.value)}
                    placeholder="Name or email…"
                    className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">To</label>
                  <input
                    value={toFilter}
                    onChange={(e) => setToFilter(e.target.value)}
                    placeholder="Recipient email…"
                    className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">After</label>
                  <input
                    type="date"
                    value={dateAfter}
                    onChange={(e) => setDateAfter(e.target.value)}
                    className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">Before</label>
                  <input
                    type="date"
                    value={dateBefore}
                    onChange={(e) => setDateBefore(e.target.value)}
                    className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--ink2)]">
                  <input
                    type="checkbox"
                    checked={hasAttachment}
                    onChange={(e) => setHasAttachment(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <Paperclip className="h-3 w-3" /> Has attachment
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--ink2)]">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => setUnreadOnly(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <MailCheck className="h-3 w-3" /> Unread only
                </label>
                {advancedActive && (
                  <button
                    onClick={clearAdvanced}
                    className="ml-auto text-xs text-[var(--crit)] hover:underline"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk action bar */}
          {checkedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[var(--accent-soft)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--accent-ink)]">
                {checkedIds.size} selected
              </span>
              <div className="ml-auto flex flex-wrap gap-1">
                <button onClick={() => runBulk("MARK_READ")} disabled={bulk.isPending} className="zoiko-btn sm">Mark read</button>
                <button onClick={() => runBulk("MARK_UNREAD")} disabled={bulk.isPending} className="zoiko-btn sm">Unread</button>
                <button onClick={() => runBulk("STAR")} disabled={bulk.isPending} className="zoiko-btn sm"><Star className="h-3 w-3" /></button>
                <button onClick={() => runBulk("UNSTAR")} disabled={bulk.isPending} className="zoiko-btn sm">Unstar</button>
                {folder === "INBOX" && (
                  <button onClick={() => runBulk("ARCHIVE")} disabled={bulk.isPending} className="zoiko-btn sm"><Archive className="h-3 w-3" /> Archive</button>
                )}
                {(folder === "INBOX" || folder === "ARCHIVE") && (
                  <button onClick={() => runBulk("SPAM")} disabled={bulk.isPending} className="zoiko-btn sm" title="Report spam">
                    <ShieldAlert className="h-3 w-3" /> Spam
                  </button>
                )}
                {folder === "SPAM" && (
                  <button onClick={() => runBulk("NOT_SPAM")} disabled={bulk.isPending} className="zoiko-btn sm">Not spam</button>
                )}
                {(folder === "TRASH" || folder === "ARCHIVE") && (
                  <button onClick={() => runBulk("RESTORE")} disabled={bulk.isPending} className="zoiko-btn sm">Restore</button>
                )}
                {folder !== "TRASH" && folder !== "DRAFTS" && (
                  <button onClick={() => runBulk("TRASH")} disabled={bulk.isPending} className="zoiko-btn crit sm"><Trash2 className="h-3 w-3" /></button>
                )}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {isLoading && (
              <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink3)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {error && (
              <div className="m-3 flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load this folder.
              </div>
            )}
            {!isLoading && !error && items.length === 0 && (
              <div className="flex flex-col items-center py-20 text-center text-[var(--ink3)]">
                <MailOpen className="h-10 w-10" />
                <p className="mt-3 text-sm font-medium text-[var(--ink2)]">Nothing here</p>
                <p className="text-xs">This folder is empty.</p>
              </div>
            )}

            {groupByDay(items).map((group) => (
              <div key={group.label}>
                <div className="font-mono-num sticky top-0 bg-[var(--ground)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                  {group.label}
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {group.items.map((it) => (
                    <MailRow
                      key={it.id}
                      item={it}
                      folder={folder}
                      selected={selectedId === it.messageId}
                      checked={checkedIds.has(it.messageId)}
                      onToggleChecked={() => toggleChecked(it.messageId)}
                      onSelect={() => setSelectedId(it.messageId)}
                      showDeleteDraft={folder === "DRAFTS"}
                      onDeleteDraft={() => setDraftToDelete(it.messageId)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--ink3)]">
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  className="zoiko-btn sm disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="zoiko-btn sm disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Reading pane */}
        <section className={`min-w-0 flex-1 overflow-y-auto overflow-x-hidden ${selectedId ? "flex" : "hidden lg:flex"}`}>
          {selectedId ? (
            <ReadingPane
              messageId={selectedId}
              folder={folder}
              onClose={() => setSelectedId(null)}
              onCompose={openCompose}
            />
          ) : (
            <div className="m-auto flex flex-col items-center text-[var(--ink3)]">
              <MailOpen className="h-12 w-12" />
              <p className="mt-3 text-sm">Select a message to read.</p>
            </div>
          )}
        </section>
      </div>

      <ComposeModal
        open={compose.open}
        mode={compose.mode}
        source={compose.source}
        onClose={() => setCompose((c) => ({ ...c, open: false }))}
      />

      <LabelManagerModal open={labelManagerOpen} onClose={() => setLabelManagerOpen(false)} />

      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={() =>
          emptyTrashMut.mutate(undefined, { onSuccess: () => setConfirmEmpty(false) })
        }
        title="Empty Trash"
        message="Permanently delete every message in Trash? This cannot be undone."
        confirmLabel="Empty trash"
        variant="danger"
        loading={emptyTrashMut.isPending}
      />

      <ConfirmDialog
        open={!!draftToDelete}
        onClose={() => setDraftToDelete(null)}
        onConfirm={() => {
          if (draftToDelete) deleteDraft.mutate(draftToDelete);
          setDraftToDelete(null);
        }}
        title="Delete Draft"
        message="Permanently delete this draft? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteDraft.isPending}
      />
    </>
  );
});

function ReadingPane({
  messageId,
  folder,
  onClose,
  onCompose,
}: {
  messageId: string;
  folder: MailListFolder;
  onClose: () => void;
  onCompose: (mode: ComposerMode, source: MailItem | null) => void;
}) {
  const { data: item, isLoading, error } = useMessage(messageId);
  const update = useUpdateMailItem();
  const permanentlyDelete = usePermanentlyDelete();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: labels = [] } = useMailLabels();
  const assignLabel = useAssignLabel();
  const removeLabel = useRemoveLabel();
  const createAiAction = useCreateAiAction();
  const [aiTriggered, setAiTriggered] = useState<string | null>(null);
  const snooze = useSnoozeMessage();
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  const themeRev = useThemeRevision();
  // Called unconditionally, before the early returns below — item is
  // undefined on the loading render, so this passes null until it loads
  // (useThread already gates its query on `enabled: Boolean(threadId)`).
  // Calling it after an early return was a rules-of-hooks violation: the
  // hook simply wouldn't run on the loading render, then would on the next
  // one, changing the hook count between renders.
  const { data: thread } = useThread(item?.message.threadId ?? null);

  // Mark read on open (once we have the item and it's unread).
  const isUnread = item && !item.isRead;
  useEffect(() => {
    if (isUnread) update.mutate({ messageId, isRead: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, isUnread]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink3)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading message…
      </div>
    );
  }
  if (error || !item) {
    return (
      <div className="m-3 flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load this message.
      </div>
    );
  }

  const m = item.message;
  const to = m.recipients.filter((r) => r.type === "TO").map((r) => r.email);
  const cc = m.recipients.filter((r) => r.type === "CC").map((r) => r.email);
  const canTriage = folder === "INBOX" || folder === "ARCHIVE" || folder === "TRASH";
  const isSnoozed = folder === "SNOOZED";

  // Screen 2 (full conversation view) was explicitly deferred — this is the
  // one piece of it that still ships now: the reading pane shows the whole
  // thread rather than just the clicked message, so a reply chain doesn't
  // look broken. Older messages render collapsed to one line; the latest
  // (or whichever one is clicked) renders in full, matching the body
  // already built below for the single-message case.
  const threadMessages = thread && thread.messages.length > 1 ? thread.messages : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] p-2 overflow-x-auto min-w-0">
        <button onClick={onClose} className="zoiko-btn sm lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => update.mutate({ messageId, isStarred: !item.isStarred })}
          className="zoiko-btn sm m-1"
          title={item.isStarred ? "Unstar" : "Star"}
        >
          <Star className={`h-4 w-4 ${item.isStarred ? "fill-[var(--warn)] text-[var(--warn)]" : ""}`} />
        </button>
        {isSnoozed ? (
          <button
            onClick={() => { snooze.mutate({ messageId, until: null }); onClose(); }}
            disabled={snooze.isPending}
            className="zoiko-btn sm"
            title="Remove from Snoozed — back to Inbox now"
          >
            <Clock className="h-4 w-4" /> <span className="hidden lg:inline">Unsnooze</span>
          </button>
        ) : (
          folder === "INBOX" && (
            <SnoozeMenu
              disabled={snooze.isPending}
              onSnooze={(until) => {
                snooze.mutate({ messageId, until: until.toISOString() });
                onClose();
              }}
            />
          )
        )}
        {canTriage && folder !== "ARCHIVE" && (
          <button title="Archive" onClick={() => { update.mutate({ messageId, folder: "ARCHIVE" }); onClose(); }} className="zoiko-btn sm m-1">
            <Archive className="h-4 w-4" /> <span className="hidden lg:inline"></span>
          </button>
        )}
        {canTriage && folder !== "TRASH" && (
          <button  title="Trash" onClick={() => { update.mutate({ messageId, folder: "TRASH" }); onClose(); }} className="zoiko-btn crit sm">
            <Trash2 className="h-4 w-4" /> <span className="hidden lg:inline"></span>
          </button>
        )}
        {folder === "TRASH" && (
          <button onClick={() => { update.mutate({ messageId, folder: "INBOX" }); onClose(); }} className="zoiko-btn sm">
            Restore
          </button>
        )}
        {folder === "TRASH" && (
          <button onClick={() => setConfirmDelete(true)} disabled={permanentlyDelete.isPending} className="zoiko-btn crit sm" title="Delete forever">
            <X className="h-4 w-4" /> <span className="hidden lg:inline">Delete forever</span>
          </button>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <DropdownMenu
            trigger={
              <span className="zoiko-btn sm">
                <Tag className="h-3 w-3" /> 
                {/* <span className="hidden lg:inline">Labels</span> */}
              </span>
            }
          >
            {labels.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--ink3)]">No labels yet — create one via the gear icon.</p>
            )}
            {labels.map((l) => {
              const assigned = item.labels.some((has) => has.id === l.id);
              return (
                <DropdownItem
                  key={l.id}
                  onClick={() =>
                    assigned
                      ? removeLabel.mutate({ messageId, labelId: l.id })
                      : assignLabel.mutate({ messageId, labelId: l.id })
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="flex-1">{l.name}</span>
                  {assigned && <span className="text-[10px] font-semibold">✓</span>}
                </DropdownItem>
              );
            })}
          </DropdownMenu>
          {folder === "DRAFTS" && (
            <>
              <button
                onClick={() => onCompose("edit", item)}
                className="zoiko-btn sm"
                title="Continue editing this draft"
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden lg:inline">Edit</span>
              </button>
              <button
                onClick={async () => {
                  const { sendDraft } = await import("@/lib/mail-api");
                  await sendDraft(messageId);
                  onClose();
                }}
                className="zoiko-btn sm pri"
                title="Send this draft now"
              >
                <Send className="h-4 w-4" />
                <span className="hidden lg:inline">Send</span>
              </button>
              <div className="mx-1 h-5 w-px bg-[var(--border)]" />
            </>
          )}

          <button onClick={() => onCompose("reply", item)} className="zoiko-btn sm" title="Reply">
            <Reply className="h-4 w-4" />
          </button>
          <button onClick={() => onCompose("replyAll", item)} className="zoiko-btn sm" title="Reply all">
            <ReplyAll className="h-4 w-4" />
          </button>
          <button onClick={() => onCompose("forward", item)} className="zoiko-btn sm" title="Forward">
            <Forward className="h-4 w-4" />
          </button>

          {/* AI Actions */}
          <div className="mx-1 h-5 w-px bg-[var(--border)]" /> {/* separator */}
          {/* <button
            onClick={() => {
              setAiTriggered("extract");
              createAiAction.mutate(
                { actionType: "COMMITMENT_EXTRACTION", messageId, threadId: m.threadId ?? undefined },
                { onSettled: () => setTimeout(() => setAiTriggered(null), 3000) }
              );
            }}
            disabled={createAiAction.isPending}
            className="zoiko-btn sm"
            title="Extract actions (commitments, deadlines, approvals)"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden lg:inline">
              {aiTriggered === "extract" ? "Sent to AI ✓" : "Extract"}
            </span>
          </button>
          <button
            onClick={() => {
              setAiTriggered("draft");
              createAiAction.mutate(
                // { actionType: "DRAFT", messageId, threadId: m.threadId ?? undefined },
                { actionType: "REPLY_OWED", messageId, threadId: m.threadId ?? undefined },
                { onSettled: () => setTimeout(() => setAiTriggered(null), 3000) }
              );
            }}
            disabled={createAiAction.isPending}
            className="zoiko-btn sm"
            title="AI draft reply"
          >
            <BrainCircuit className="h-4 w-4" />
            <span className="hidden lg:inline">
              {aiTriggered === "draft" ? "Drafting ✓" : "AI Draft"}
            </span>
          </button> */}

        </div>
      </div>

      {threadMessages ? (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="border-b border-[var(--border)] p-5 pb-3">
            <h1 className="font-editorial text-xl font-normal text-[var(--ink)]">
              {m.subject || "(no subject)"}
            </h1>
            <span className="text-xs text-[var(--ink3)]">{threadMessages.length} messages</span>
          </div>
          {threadMessages.map((tm, idx) => {
            const isLast = idx === threadMessages.length - 1;
            const isOpen = expandedMessageId ? expandedMessageId === tm.id : isLast;
            const tmTo = tm.recipients.filter((r) => r.type === "TO").map((r) => r.email);
            return (
              <div key={tm.id} className="border-b border-[var(--border)]">
                <button
                  onClick={() => setExpandedMessageId(isOpen ? null : tm.id)}
                  className="flex w-full items-center gap-2 px-5 py-3 text-left hover:bg-[var(--s2)]"
                >
                  {folder === "SENT" ? (
                    <>
                      <Avatar name={tmTo[0]} />
                      <span className="shrink-0 truncate text-sm font-medium text-[var(--ink)]">
                        To: {tmTo.join(", ") || "—"}
                      </span>
                    </>
                  ) : (
                    <span className="shrink-0 truncate text-sm font-medium text-[var(--ink)]">
                      {tm.fromName || tm.author?.displayName || tm.fromAddress || tm.author?.email}
                    </span>
                  )}
                  {!isOpen && (
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink3)]">
                      {tm.textBody?.slice(0, 100) || ""}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-[var(--ink3)]">
                    {fmt(tm.sentAt || tm.createdAt)}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-[var(--ink3)] transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5">
                    {folder !== "SENT" && (
                      <div className="mb-3 text-xs text-[var(--ink3)]">
                        To: {tmTo.join(", ") || "—"}
                      </div>
                    )}
                    {tm.htmlBody ? (
                      <iframe
                        key={`${tm.id}-${themeRev}`}
                        title="message body"
                        sandbox=""
                        srcDoc={readableEmailHtml(tm.htmlBody)}
                        className="h-[40vh] w-full rounded-lg border border-[var(--border)] bg-[var(--s2)]"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-[var(--ui)] text-sm text-[var(--ink)]">
                        {tm.textBody || "(no content)"}
                      </pre>
                    )}
                    {tm.attachments.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <AttachmentList messageId={tm.id} attachments={tm.attachments} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="border-b border-[var(--border)] p-5">
            <h1 className="font-editorial text-xl font-normal text-[var(--ink)]">
              {m.subject || "(no subject)"}
            </h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-[var(--ink2)]">
              {folder === "SENT" ? (
                <>
                  <Avatar name={to[0]} className="h-7 w-7 text-[11px]" />
                  <span className="font-medium">To: {to.join(", ") || "—"}</span>
                </>
              ) : (
                <>
                  <Avatar
                    name={m.fromName || m.author?.displayName || m.fromAddress || m.author?.email}
                    className="h-7 w-7 text-[11px]"
                  />
                  <span className="font-medium">{m.fromName || m.author?.displayName || m.fromAddress || m.author?.email}</span>
                  {(m.fromAddress || m.author?.email) && (
                    <span className="text-[var(--ink3)]"> &lt;{m.fromAddress || m.author?.email}&gt;</span>
                  )}
                </>
              )}
            </div>
            {folder === "SENT" ? (
              cc.length > 0 && (
                <div className="mt-1 text-xs text-[var(--ink3)]">Cc: {cc.join(", ")}</div>
              )
            ) : (
              <div className="mt-1 text-xs text-[var(--ink3)]">
                To: {to.join(", ") || "—"}
                {cc.length > 0 && <> · Cc: {cc.join(", ")}</>}
              </div>
            )}
            <div className="mt-1 text-xs text-[var(--ink3)]">{fmt(m.sentAt || m.createdAt)}</div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
            {m.htmlBody ? (
              <iframe
                key={`${messageId}-${themeRev}`}
                title="message body"
                sandbox=""
                srcDoc={readableEmailHtml(m.htmlBody)}
                className="h-[60vh] w-full rounded-lg border border-[var(--border)] bg-[var(--s2)]"
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words font-[var(--ui)] text-sm text-[var(--ink)]">
                {m.textBody || "(no content)"}
              </pre>
            )}

            {/* Attachments */}
            {m.attachments.length > 0 && (
              <div className="mt-6">
                <div className="font-mono-num mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                  {m.attachments.length} attachment{m.attachments.length > 1 ? "s" : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  <AttachmentList messageId={messageId} attachments={m.attachments} />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Quick reply — sends via the same reply orchestration ComposeModal
          uses (useComposerSubmit), so a gated send still saves as a draft
          rather than failing silently. */}
      {/* <QuickReply
        messageId={messageId}
        senderName={m.fromName || m.author?.displayName || m.fromAddress || m.author?.email || "sender"}
      /> */}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          permanentlyDelete.mutate(messageId, { onSuccess: onClose });
          setConfirmDelete(false);
        }}
        title="Delete Forever"
        message="Permanently delete this message? It will be removed from your mailbox and cannot be undone."
        confirmLabel="Delete forever"
        variant="danger"
        loading={permanentlyDelete.isPending}
      />
    </div>
  );
}

// ---- Label manager ---------------------------------------------------------
// Create labels (name + palette color) and delete existing ones. Assigning
// happens per-message via the Labels dropdown in the reading pane.

function LabelManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: labels = [] } = useMailLabels();
  const createLabel = useCreateLabel();
  const deleteLabel = useDeleteLabel();

  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFormError(null);
    createLabel.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          setName("");
          setColor(LABEL_COLORS[0]);
        },
        onError: (err) =>
          setFormError(err instanceof Error ? err.message : "Couldn't create that label."),
      }
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage labels" size="sm">
      <div className="space-y-5">
        {/* Create */}
        <section className="space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="New label name"
            maxLength={50}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <div className="flex items-center gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Use color ${c}`}
                className={`h-6 w-6 rounded-full transition ${color === c ? "ring-2 ring-offset-2 ring-[var(--ink2)] ring-offset-[var(--surface)]" : ""
                  }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              onClick={submit}
              disabled={!name.trim() || createLabel.isPending}
              className="zoiko-btn pri sm ml-auto"
            >
              {createLabel.isPending ? "Creating…" : "Create"}
            </button>
          </div>
          {formError && (
            <p className="text-xs text-[var(--crit)]">{formError}</p>
          )}
        </section>

        {/* Existing labels */}
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">
            Existing labels
          </h3>
          {labels.length === 0 && (
            <p className="text-xs text-[var(--ink3)]">No labels yet.</p>
          )}
          {labels.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{l.name}</span>
              <button
                onClick={() => deleteLabel.mutate(l.id)}
                disabled={deleteLabel.isPending}
                title={`Delete ${l.name}`}
                className="rounded-md p-1 text-[var(--ink3)] hover:bg-[var(--crit-soft)] hover:text-[var(--crit)] disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  );
}