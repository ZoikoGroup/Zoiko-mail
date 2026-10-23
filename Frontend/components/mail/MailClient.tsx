"use client";

/**
 * The webmail client, shell-free on purpose.
 *
 * Rendered by the member route (/mail, inside WebmailShell) and the admin and
 * owner inbox routes (inside their own shells), so an Admin reads their own
 * mail without leaving the admin console. One implementation, every shell —
 * never a per-role copy.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  useSharedInboxes,
  useScheduledMessageAction,
} from "@/lib/mail-hooks";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { Modal } from "@/components/ui/Modal";
import type { ComposerMode } from "@/lib/mail-hooks";
import {
  type MailFolder,
  type MailListFolder,
  type MailItem,
  type SharedInbox,
} from "@/lib/mail-api";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Inbox, Send, FileText, Archive, Trash2, Star, Loader2, AlertCircle,
  ChevronLeft, ChevronRight, Paperclip, ArrowLeft, MailOpen,
  Pencil, Reply, ReplyAll, Forward, Search, ShieldAlert, Tag, X,
  SlidersHorizontal, MailCheck, Clock, ChevronDown, MoreHorizontal, FolderInput,
  Sparkles, ListChecks, MailX, RotateCcw, CalendarDays, ArrowDown, Undo2,
} from "lucide-react";
import { AttachmentList } from "@/components/mail/AttachmentPreview";
import { parseMailQuery } from "@/lib/mail-search";
import { MailRow, hashColor, avatarInitials, formatMailTime } from "@/components/mail/MailRow";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { folderLabel as railFolderLabel } from "@/components/mail/FolderRail";
import { ApiError } from "@/lib/api-client";
import {
  type FolderView,
  getFolderView, scheduleBucket, daysAgo,
  CountPill, FolderBanner, Popover, MenuOption, chipClass,
  StatusTag, StatusCard, RestrictedBody, BlockedAttachments, AletCard, ReschedulePicker,
} from "@/components/mail/folder-views";

/**
 * Why a folder failed, in words that point at the fix.
 *
 * A 400 on a folder this client offers means the API does not recognise it —
 * in practice an API older than the frontend, after a pull that added the
 * folder. Saying so turns a dead end into "restart the API".
 */
function folderErrorReason(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return error.message;
    // The mailbox exists but an admin has not assigned it to the workspace
    // this session opened. The server names both; switching workspace or
    // asking for it to be assigned is the fix, not retrying.
    if (error.code === "MAILBOX_NOT_IN_WORKSPACE") {
      return `${error.message} Switch to one of those workspaces, or ask an admin to add this one under Mailboxes → Workspaces.`;
    }
    if (error.status === 400) {
      return "The server did not accept this folder. It is usually running an older build than this screen — restart or rebuild the API, which also applies any new database migrations.";
    }
    return error.readableMessage || error.message;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

// The Admin and Owner inboxes' own rail (the member route uses FolderRail).
const FOLDERS: { key: MailFolder; label: string; icon: typeof Inbox }[] = [
  { key: "INBOX", label: "Inbox", icon: Inbox },
  { key: "SENT", label: "Sent", icon: Send },
  { key: "DRAFTS", label: "Drafts", icon: FileText },
  { key: "ARCHIVE", label: "Archive", icon: Archive },
  { key: "TRASH", label: "Trash", icon: Trash2 },
  { key: "QUARANTINE", label: "Quarantine", icon: ShieldAlert },
];

// The folder views' date chip.
const DATE_PRESETS: { label: string; days: number | null }[] = [
  { label: "Any date", days: null },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 12 months", days: 365 },
];

// Fixed palette for user-created labels (hex required by the backend schema).
const LABEL_COLORS = [
  "#0f766e", "#2563eb", "#7c3aed", "#be123c",
  "#b45309", "#15803d", "#dc2626", "#334155",
];

function folderTitle(folder: MailListFolder): string {
  if (folder === "QUARANTINE") return "Quarantine";
  return railFolderLabel(folder);
}

function Avatar({ name, className = "h-6 w-6 text-[10px]" }: { name?: string | null; className?: string }) {
  const label = name && name.trim() ? name.trim() : "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
      style={{ backgroundColor: hashColor(label) }}
      aria-hidden
    >
      {avatarInitials(label)}
    </span>
  );
}

/**
 * readableEmailHtml() reads the app's current CSS variables, but it only
 * runs when the component housing the iframe re-renders — toggling
 * Light/Dark doesn't itself touch this component's state, so without this
 * the colors were stale until something unrelated forced a re-render.
 * Watching <html> for the attribute the theme toggle flips and bumping a
 * counter makes the switch take effect immediately; the counter is part of
 * the iframe's `key`, which also remounts it so the new colors apply.
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
 * Message HTML is written by whoever sent it and usually assumes a plain
 * white page. Wrapping it with our own stylesheet gives it readable defaults
 * in either theme (the colours are read from the live tokens) while still
 * letting any colours the email sets come through.
 */
function readableEmailHtml(html: string, element: HTMLElement | null): string {
  let textColor = "#1f2937";
  let linkColor = "#2563eb";
  let quoteColor = "#6b7280";
  let quoteBorder = "#d1d5db";
  if (typeof window !== "undefined") {
    // Read from the element the email sits in, so the mail palette's tokens
    // (scoped to .zm-webmail) apply, not only the root ones.
    const styles = getComputedStyle(element ?? document.documentElement);
    textColor = styles.getPropertyValue("--ink").trim() || textColor;
    linkColor = styles.getPropertyValue("--accent").trim() || linkColor;
    quoteColor = styles.getPropertyValue("--ink3").trim() || quoteColor;
    quoteBorder = styles.getPropertyValue("--border").trim() || quoteBorder;
  }
  return `<!doctype html><html><head><meta charset="utf-8" /><base target="_blank" /><style>
    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      word-wrap: break-word;
    }
    a { color: ${linkColor}; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 2px solid ${quoteBorder}; margin: 0 0 0 8px; padding-left: 10px; color: ${quoteColor}; }
    table { max-width: 100%; }
  </style></head><body>${html}</body></html>`;
}

/**
 * An email's HTML, isolated and sized to its content.
 *
 * Sandboxed with no scripts, forms or top navigation; allow-same-origin only
 * so its height can be measured and the message reads as part of the page
 * rather than in a scrolling box. allow-popups lets its links open in a new
 * tab (the <base target="_blank"> above) instead of inside the frame.
 */
function EmailBody({ html, revision, fallbackHeight = 320 }: { html: string; revision: number; fallbackHeight?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(fallbackHeight);
  const [srcDoc, setSrcDoc] = useState("");
  useEffect(() => {
    setSrcDoc(readableEmailHtml(html, holder.current));
  }, [html, revision]);
  return (
    <div ref={holder}>
      <iframe
        key={revision}
        title="Message body"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        onLoad={(event) => {
          const doc = event.currentTarget.contentDocument;
          if (doc?.body) setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 80), 4000));
        }}
        style={{ height }}
        className="w-full border-0 bg-transparent"
      />
    </div>
  );
}

interface MailClientProps {
  /**
   * Controlled folder, set by a parent that renders its own rail (the member
   * route's FolderRail). The Admin and Owner inbox pages pass nothing and
   * keep the internal state and rail.
   */
  folder?: MailListFolder;
  onFolderChange?: (folder: MailListFolder) => void;
  /** Hide this component's own folder rail — the parent renders one. */
  hideRail?: boolean;
  /** Controlled search text, from a parent's search box (the TopBar). */
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  /** Hide this component's own search input — the parent renders one. */
  hideSearchBox?: boolean;
  /** Controlled label filter, from the member route's FolderRail. */
  labelId?: string;
  onLabelChange?: (labelId: string) => void;
  /** A shared or delegated inbox to read instead of one's own. */
  sharedInbox?: SharedInbox | null;
}

/**
 * Exposed via ref so a parent shell's own Compose button (the member route's
 * FolderRail) can open this component's composer.
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
    labelId: controlledLabelId,
    onLabelChange,
    sharedInbox = null,
  },
  ref
) {
  const [internalFolder, setInternalFolder] = useState<MailListFolder>("INBOX");
  const folder = controlledFolder ?? internalFolder;
  const mailboxId = sharedInbox?.id;
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
  const [internalLabelFilter, setInternalLabelFilter] = useState("");
  const labelFilter = controlledLabelId ?? internalLabelFilter;
  const setLabelFilter = (value: string) => (onLabelChange ? onLabelChange(value) : setInternalLabelFilter(value));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [dateAfter, setDateAfter] = useState("");
  const [dateBefore, setDateBefore] = useState("");
  const { data: labels = [] } = useMailLabels();
  const { data: sharedInboxes = [] } = useSharedInboxes();
  // The live copy (unread count, permissions), not the one captured on click.
  const liveShared = sharedInbox ? sharedInboxes.find((m) => m.id === sharedInbox.id) ?? sharedInbox : null;

  // Scheduled, Archive, Spam and Trash have their own layout (folder-views);
  // every other folder, and any shared inbox, keeps the plain one.
  const view = liveShared ? null : getFolderView(folder);
  const [viewTab, setViewTab] = useState("");
  const [datePreset, setDatePreset] = useState<number | null>(null);
  useEffect(() => {
    setViewTab("");
    setDatePreset(null);
  }, [folder, mailboxId]);
  const activeTab = view ? view.tabs.find((tab) => tab.key === viewTab) ?? view.tabs[0] : null;
  const tabFilter = activeTab?.filter ?? {};

  const advancedActive = fromFilter || toFilter || hasAttachment || dateAfter || dateBefore;
  const clearAdvanced = () => {
    setFromFilter("");
    setToFilter("");
    setHasAttachment(false);
    setDateAfter("");
    setDateBefore("");
    setShowAdvanced(false);
  };

  // Debounce search input → query params. Operators (from:, to:, has:,
  // is:, after:, before:) populate the same advanced-filter state the panel
  // edits by hand; whatever text is left over becomes the free-text search.
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

  // Bulk selection
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const bulk = useBulkMailAction();

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setCheckedIds(new Set());
  }, [starredOnly, unreadOnly, labelFilter, fromFilter, toFilter, hasAttachment, dateAfter, dateBefore, mailboxId, folder, viewTab, datePreset]);

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

  // A folder view's tab and date chip narrow the list on top of the filter
  // panel; for dates the latest "after" wins.
  const effectiveStarred = starredOnly || Boolean(tabFilter.starredOnly);
  const effectiveUnread = unreadOnly || Boolean(tabFilter.unreadOnly);
  const effectiveHasAttachment = hasAttachment || Boolean(tabFilter.hasAttachment);
  const effectiveDateAfter =
    [dateAfter, datePreset ? daysAgo(datePreset) : "", tabFilter.recentDays ? daysAgo(tabFilter.recentDays) : ""]
      .filter(Boolean)
      .sort()
      .pop() ?? "";
  const pageSize = view?.pageSize ?? 25;

  const { data, isLoading, error, refetch, isFetching } = useMailList({
    folder,
    page,
    limit: pageSize,
    ...(mailboxId ? { mailboxId } : {}),
    ...(q ? { q } : {}),
    ...(effectiveStarred ? { starredOnly: true } : {}),
    ...(effectiveUnread ? { unreadOnly: true } : {}),
    ...(labelFilter && !mailboxId ? { labelId: labelFilter } : {}),
    ...(fromFilter ? { from: fromFilter } : {}),
    ...(toFilter ? { to: toFilter } : {}),
    ...(effectiveHasAttachment ? { hasAttachment: true } : {}),
    ...(effectiveDateAfter ? { dateAfter: effectiveDateAfter } : {}),
    ...(dateBefore ? { dateBefore } : {}),
  });
  const listed = data?.items ?? [];
  // The send queue reads soonest first, and its tabs split it by due date.
  const queue =
    view?.folder === "SCHEDULED"
      ? [...listed].sort((a, b) => (a.message.scheduledAt ?? "").localeCompare(b.message.scheduledAt ?? ""))
      : null;
  const items = queue
    ? queue.filter((it) => !tabFilter.bucket || scheduleBucket(it.message.scheduledAt) === tabFilter.bucket)
    : listed;
  const nextSendAt = queue?.find((it) => it.message.scheduledAt)?.message.scheduledAt ?? null;
  const pagination = data?.pagination;
  // Bulk actions, labels and drafts act on one's own mailbox only.
  const ownMailbox = !mailboxId;

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
    clearAdvanced();
    setCheckedIds(new Set());
  };

  const activeLabel = labels.find((l) => l.id === labelFilter);
  const title = view
    ? view.title
    : liveShared
    ? liveShared.address
    : activeLabel
      ? activeLabel.name
      : folderTitle(folder);
  const eyebrow = liveShared
    ? liveShared.delegated
      ? "Delegated mailbox"
      : "Shared inbox"
    : activeLabel
      ? "Label"
      : "Personal mailbox";
  const unreadHere = liveShared
    ? liveShared.unread
    : activeLabel
      ? 0
      : folder === "INBOX" || folder === "SPAM"
        ? unreadCounts?.[folder] ?? 0
        : 0;
  const totalHere = folder === "DRAFTS" || folder === "SCHEDULED" || folder === "SNOOZED" ? unreadCounts?.[folder] ?? 0 : 0;

  const tabs = [
    { key: "all", label: "All", active: !unreadOnly && !starredOnly, count: 0 },
    { key: "unread", label: "Unread", active: unreadOnly, count: unreadHere },
    { key: "starred", label: "Starred", active: starredOnly, count: 0 },
  ] as const;

  const listMenu = (
    <DropdownMenu
      trigger={
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink2)] hover:bg-[var(--s2)]">
          <MoreHorizontal className="h-5 w-5" aria-hidden />
          <span className="sr-only">More list options</span>
        </span>
      }
    >
      {ownMailbox && (
        <DropdownItem onClick={() => setLabelManagerOpen(true)}>
          <Tag className="h-3.5 w-3.5" /> Manage labels
        </DropdownItem>
      )}
      <DropdownItem onClick={() => void refetch()}>
        <RotateCcw className="h-3.5 w-3.5" /> Refresh
      </DropdownItem>
      {ownMailbox && folder === "TRASH" && (
        <DropdownItem danger onClick={() => setConfirmEmpty(true)} disabled={emptyTrashMut.isPending}>
          <Trash2 className="h-3.5 w-3.5" /> Empty trash
        </DropdownItem>
      )}
    </DropdownMenu>
  );

  const filterButton = (
    <button
      onClick={() => setShowAdvanced((s) => !s)}
      aria-expanded={showAdvanced}
      aria-label="Filters"
      title="Filters"
      className={`inline-flex ${view ? "h-9 w-9" : "h-8 w-8"} shrink-0 items-center justify-center rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        advancedActive
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          : "border-[var(--border)] text-[var(--ink2)] hover:bg-[var(--s2)]"
      }`}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
    </button>
  );

  const pager = pagination ? (
    <div className="flex gap-1">
      <button
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={pagination.page <= 1}
        aria-label="Previous page"
        className="zoiko-btn sm disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setPage((p) => p + 1)}
        disabled={pagination.page >= pagination.totalPages}
        aria-label="Next page"
        className="zoiko-btn sm disabled:opacity-40"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  return (
    <>
      <div className="flex h-full min-h-0">
        {/* The Admin and Owner inboxes' own rail; the member route passes
            hideRail and renders FolderRail in its shell instead. */}
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
          aria-label={`${title} messages`}
          className={`flex min-w-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] ${selectedId ? "hidden lg:flex lg:w-[360px] xl:w-[410px]" : "flex flex-1 lg:max-w-none"
            }`}
        >
          {/* The Admin and Owner inboxes' phone strip (Compose + folders). */}
          {!hideRail && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--border)] p-2 lg:hidden">
              <button onClick={() => openCompose("new", null)} className="zoiko-btn pri sm shrink-0">
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

          {/* Header: which mailbox, which folder, how much is unread */}
          {view ? (
            <>
              <div className="flex items-start gap-3 px-5 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{view.eyebrow}</p>
                  <h2 className="mt-1 truncate text-[22px] font-semibold leading-tight text-[var(--ink)]">{view.title}</h2>
                  <p className="mt-1 text-[12.5px] text-[var(--ink3)]">{view.subtitle}</p>
                </div>
                {pagination && <div className="pt-6"><CountPill view={view} total={pagination.total} /></div>}
                <div className="pt-5">{listMenu}</div>
              </div>
              <FolderBanner view={view} nextSendAt={nextSendAt} />
            </>
          ) : (
          <div className="flex items-start gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{eyebrow}</p>
              <div className="mt-1 flex min-w-0 items-center gap-2.5">
                <h2 className="truncate text-[22px] font-semibold leading-tight text-[var(--ink)]">{title}</h2>
                {unreadHere > 0 ? (
                  <span className="shrink-0 rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--accent-ink)]">
                    {unreadHere} unread
                  </span>
                ) : totalHere > 0 ? (
                  <span className="shrink-0 rounded-md bg-[var(--s3)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--ink2)]">
                    {totalHere}
                  </span>
                ) : null}
              </div>
            </div>
            {listMenu}
          </div>
          )}

          {/* Tabs */}
          {view ? (
            <div role="tablist" aria-label="Show" className="flex items-end gap-5 overflow-x-auto border-b border-[var(--border)] px-5 pt-2">
              {view.tabs.map((tab) => {
                const active = activeTab?.key === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewTab(tab.key)}
                    className={`-mb-px shrink-0 border-b-2 pb-2.5 pt-1 text-[13px] transition focus:outline-none focus-visible:text-[var(--ink)] ${
                      active
                        ? "border-[var(--accent)] font-semibold text-[var(--ink)]"
                        : "border-transparent text-[var(--ink3)] hover:text-[var(--ink2)]"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : (
          <div role="tablist" aria-label="Show" className="flex items-end gap-5 border-b border-[var(--border)] px-5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={tab.active}
                onClick={() => {
                  setPage(1);
                  setUnreadOnly(tab.key === "unread");
                  setStarredOnly(tab.key === "starred");
                }}
                className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 pt-1 text-[13.5px] transition focus:outline-none focus-visible:text-[var(--ink)] ${
                  tab.active
                    ? "border-[var(--accent)] font-semibold text-[var(--ink)]"
                    : "border-transparent text-[var(--ink3)] hover:text-[var(--ink2)]"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="rounded-md bg-[var(--accent-soft)] px-1.5 text-[11px] font-semibold text-[var(--accent-ink)]">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          )}

          {/* Toolbar: select all, order, filters */}
          {view ? (
            <div className="space-y-2.5 border-b border-[var(--border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
                  <input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder={view.searchPlaceholder}
                    aria-label={view.searchPlaceholder}
                    className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-8 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                  {searchInput && (
                    <button
                      onClick={() => setSearchInput("")}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink2)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {filterButton}
              </div>

              {(view.showDateFilter || (ownMailbox && labels.length > 0)) && (
                <div className="flex flex-wrap items-center gap-2">
                  {view.showDateFilter && (
                    <Popover
                      label="Date range"
                      triggerClassName={`${chipClass} ${datePreset ? "border-[var(--accent)] text-[var(--accent-ink)]" : ""}`}
                      trigger={
                        <>
                          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                          {DATE_PRESETS.find((preset) => preset.days === datePreset)?.label ?? "Any date"}
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        </>
                      }
                    >
                      {(close) =>
                        DATE_PRESETS.map((preset) => (
                          <MenuOption
                            key={preset.label}
                            active={datePreset === preset.days}
                            onClick={() => { setDatePreset(preset.days); close(); }}
                          >
                            {preset.label}
                          </MenuOption>
                        ))
                      }
                    </Popover>
                  )}
                  {ownMailbox && labels.length > 0 && (
                    <Popover
                      label="Label"
                      triggerClassName={`${chipClass} ${activeLabel ? "border-[var(--accent)] text-[var(--accent-ink)]" : ""}`}
                      trigger={
                        <>
                          {activeLabel ? (
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeLabel.color }} aria-hidden />
                          ) : (
                            <Tag className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {activeLabel?.name ?? "Labels"}
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        </>
                      }
                    >
                      {(close) => (
                        <>
                          <MenuOption active={!labelFilter} onClick={() => { setLabelFilter(""); close(); }}>All labels</MenuOption>
                          {labels.map((l) => (
                            <MenuOption key={l.id} active={labelFilter === l.id} onClick={() => { setLabelFilter(l.id); close(); }}>
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                              {l.name}
                            </MenuOption>
                          ))}
                        </>
                      )}
                    </Popover>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 text-[11.5px] text-[var(--ink3)]">
                {ownMailbox && (
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAllChecked}
                    aria-label="Select all"
                    className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{view.listCaption}</span>
                <span className="inline-flex shrink-0 items-center gap-1">
                  {view.sortLabel} <ArrowDown className="h-3 w-3" aria-hidden />
                </span>
              </div>
            </div>
          ) : (
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
            {ownMailbox ? (
              <label className="flex shrink-0 cursor-pointer items-center gap-2 pl-1 text-[12.5px] text-[var(--ink2)]">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAllChecked}
                  className="h-4 w-4 rounded accent-[var(--accent)]"
                />
                Select all
              </label>
            ) : (
              <span className="pl-1 text-[12.5px] text-[var(--ink3)]">
                {liveShared?.canManage ? "You can read and organise this inbox" : "You can read this inbox"}
              </span>
            )}
            {!hideSearchBox && (
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search this folder…"
                  aria-label="Search this folder"
                  className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-7 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
                {searchInput && (
                  <button
                    onClick={() => setSearchInput("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink2)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {hideSearchBox && <div className="min-w-0 flex-1" />}
            <span className="hidden shrink-0 text-[12px] text-[var(--ink3)] sm:inline">Newest first</span>
            {filterButton}
          </div>
          )}

          {/* Filter panel */}
          {showAdvanced && (
            <div className="border-b border-[var(--border)] bg-[var(--s2)] px-4 py-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  { id: "f-from", label: "From", value: fromFilter, set: setFromFilter, placeholder: "Name or email…", type: "text" },
                  { id: "f-to", label: "To", value: toFilter, set: setToFilter, placeholder: "Recipient email…", type: "text" },
                  { id: "f-after", label: "After", value: dateAfter, set: setDateAfter, placeholder: "", type: "date" },
                  { id: "f-before", label: "Before", value: dateBefore, set: setDateBefore, placeholder: "", type: "date" },
                ] as const).map((f) => (
                  <div key={f.id}>
                    <label htmlFor={f.id} className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
                      {f.label}
                    </label>
                    <input
                      id={f.id}
                      type={f.type}
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.placeholder}
                      className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                    />
                  </div>
                ))}
                {ownMailbox && labels.length > 0 && (
                  <div className="sm:col-span-2">
                    <label htmlFor="f-label" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
                      Label
                    </label>
                    <select
                      id="f-label"
                      value={labelFilter}
                      onChange={(e) => setLabelFilter(e.target.value)}
                      className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                    >
                      <option value="">All labels</option>
                      {labels.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--ink2)]">
                  <input
                    type="checkbox"
                    checked={hasAttachment}
                    onChange={(e) => setHasAttachment(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <Paperclip className="h-3 w-3" aria-hidden /> Has attachment
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--ink2)]">
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => setUnreadOnly(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <MailCheck className="h-3 w-3" aria-hidden /> Unread only
                </label>
                {advancedActive && (
                  <button onClick={clearAdvanced} className="ml-auto text-xs text-[var(--crit)] hover:underline">
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bulk action bar */}
          {ownMailbox && checkedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] bg-[var(--accent-soft)] px-4 py-2">
              <span className="text-xs font-medium text-[var(--accent-ink)]">
                {checkedIds.size} selected
              </span>
              <div className="ml-auto flex flex-wrap gap-1">
                <button onClick={() => runBulk("MARK_READ")} disabled={bulk.isPending} className="zoiko-btn sm">Mark read</button>
                <button onClick={() => runBulk("MARK_UNREAD")} disabled={bulk.isPending} className="zoiko-btn sm">Unread</button>
                <button onClick={() => runBulk("STAR")} disabled={bulk.isPending} className="zoiko-btn sm" aria-label="Star"><Star className="h-3 w-3" /></button>
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
                  <button onClick={() => runBulk("TRASH")} disabled={bulk.isPending} className="zoiko-btn crit sm" aria-label="Move to trash"><Trash2 className="h-3 w-3" /></button>
                )}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" aria-busy={isLoading}>
            {isLoading && (
              <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink3)]" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
              </div>
            )}
            {error && (
              <div className="m-3 flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>Couldn&rsquo;t load this folder.</p>
                  {/* The server's own reason. A bare "couldn't load" sent people
                      looking in the wrong place when the cause was an API
                      older than this screen. */}
                  <p className="mt-1 text-xs text-[var(--ink2)]">{folderErrorReason(error)}</p>
                  <button
                    type="button"
                    className="zoiko-btn sm mt-2"
                    disabled={isFetching}
                    onClick={() => void refetch()}
                  >
                    {isFetching ? "Retrying…" : "Try again"}
                  </button>
                </div>
              </div>
            )}
            {!isLoading && !error && items.length === 0 && (
              <div className="flex flex-col items-center px-6 py-20 text-center text-[var(--ink3)]">
                <MailOpen className="h-10 w-10" aria-hidden />
                <p className="mt-3 text-sm font-medium text-[var(--ink2)]">Nothing here</p>
                <p className="text-xs">
                  {q || advancedActive || effectiveUnread || effectiveStarred || effectiveDateAfter || effectiveHasAttachment || tabFilter.bucket
                    ? "No messages match these filters."
                    : "This folder is empty."}
                </p>
              </div>
            )}

            <ul>
              {items.map((it) => (
                <MailRow
                  key={it.id}
                  item={it}
                  folder={folder}
                  selected={selectedId === it.messageId}
                  checked={checkedIds.has(it.messageId)}
                  onToggleChecked={() => toggleChecked(it.messageId)}
                  onSelect={() => setSelectedId(it.messageId)}
                  showDeleteDraft={ownMailbox && folder === "DRAFTS"}
                  onDeleteDraft={() => setDraftToDelete(it.messageId)}
                  selectable={ownMailbox}
                />
              ))}
            </ul>
          </div>

          {/* Pagination */}
          {view && pagination ? (
            <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2 text-[11.5px] text-[var(--ink3)]">
              <span className="min-w-0 flex-1 truncate">{view.footerNote}</span>
              <span className="shrink-0">
                {tabFilter.bucket
                  ? `${items.length} of ${pagination.total}`
                  : pagination.total === 0
                    ? "0 of 0"
                    : `${(pagination.page - 1) * pagination.limit + 1}–${(pagination.page - 1) * pagination.limit + items.length} of ${pagination.total}`}
              </span>
              {pagination.totalPages > 1 && pager}
            </div>
          ) : pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--ink3)]">
              <span>Page {pagination.page} of {pagination.totalPages}</span>
              {pager}
            </div>
          )}
        </section>

        {/* Reading pane */}
        <section
          aria-label="Message"
          className={`min-w-0 flex-1 overflow-hidden bg-[var(--surface)] ${selectedId ? "flex" : "hidden lg:flex"}`}
        >
          {selectedId ? (
            <ReadingPane
              messageId={selectedId}
              folder={folder}
              view={view}
              sharedInbox={liveShared}
              onClose={() => setSelectedId(null)}
              onCompose={openCompose}
            />
          ) : (
            <div className="m-auto flex flex-col items-center px-6 text-center text-[var(--ink3)]">
              <MailOpen className="h-12 w-12" aria-hidden />
              <p className="mt-3 text-sm">Select a message to read.</p>
            </div>
          )}
        </section>
      </div>

      <ComposeModal
        open={compose.open}
        mode={compose.mode}
        source={compose.source}
        defaultSendAsMailboxId={compose.mode !== "new" && liveShared?.canSend ? liveShared.id : null}
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

function ComingSoonButton({ icon: Icon, label, hint }: { icon: typeof Sparkles; label: string; hint: string }) {
  return (
    <button
      type="button"
      aria-disabled="true"
      title={hint}
      onClick={(e) => e.preventDefault()}
      className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-[var(--border)] px-3.5 text-[13px] font-medium text-[var(--ink3)]"
    >
      <Icon className="h-4 w-4" aria-hidden /> {label}
      <span className="rounded-full border border-[var(--border)] px-1.5 text-[9.5px] font-semibold uppercase tracking-wide">Soon</span>
    </button>
  );
}

function ReadingPane({
  messageId,
  folder,
  view,
  sharedInbox,
  onClose,
  onCompose,
}: {
  messageId: string;
  folder: MailListFolder;
  /** Scheduled, Archive, Spam or Trash layout; null for every other folder. */
  view: FolderView | null;
  sharedInbox: SharedInbox | null;
  onClose: () => void;
  onCompose: (mode: ComposerMode, source: MailItem | null) => void;
}) {
  const mailboxId = sharedInbox?.id;
  const { data: item, isLoading, error } = useMessage(messageId, mailboxId);
  const update = useUpdateMailItem();
  const permanentlyDelete = usePermanentlyDelete();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: labels = [] } = useMailLabels();
  const assignLabel = useAssignLabel();
  const removeLabel = useRemoveLabel();
  const snooze = useSnoozeMessage();
  const queued = useScheduledMessageAction();
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  const themeRev = useThemeRevision();
  // Called unconditionally, before the early returns below — item is
  // undefined on the loading render, so this passes null until it loads.
  const { data: thread } = useThread(mailboxId ? null : item?.message.threadId ?? null);

  // Mark read on open (once we have the item and it's unread).
  const isUnread = item && !item.isRead;
  useEffect(() => {
    if (isUnread) update.mutate({ messageId, isRead: true, mailboxId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, isUnread]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink3)]" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading message…
      </div>
    );
  }
  if (error || !item) {
    return (
      <div className="m-3 flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Couldn&rsquo;t load this message.
      </div>
    );
  }

  const m = item.message;
  const own = !mailboxId;
  const to = m.recipients.filter((r) => r.type === "TO").map((r) => r.email);
  const cc = m.recipients.filter((r) => r.type === "CC").map((r) => r.email);
  const isDraft = folder === "DRAFTS" || folder === "SCHEDULED";
  // Moving mail: one's own mailbox, or a shared one held with manage.
  const canMove = own || Boolean(sharedInbox?.canManage);
  const canTriage = canMove && (folder === "INBOX" || folder === "ARCHIVE" || folder === "TRASH" || folder === "SPAM" || folder === "STARRED");
  // Replying from a shared inbox goes out as it, which needs send there.
  const canReply = own || Boolean(sharedInbox?.canSend);
  const isSnoozed = folder === "SNOOZED";
  const senderLabel = m.fromName || m.author?.displayName || m.fromAddress || m.author?.email;
  const senderAddress = m.fromAddress || m.author?.email;
  const move = (target: "INBOX" | "ARCHIVE" | "TRASH" | "SPAM") => {
    update.mutate({ messageId, folder: target, mailboxId });
    onClose();
  };

  // A thread with several messages reads as a conversation: older ones
  // collapsed to a line, the latest (or the one clicked) in full.
  const threadMessages = thread && thread.messages.length > 1 ? thread.messages : null;
  // Spam is read as plain text, with attachments listed but not opened.
  const restricted = view?.folder === "SPAM";
  const recipientCount = m.recipients.length;
  const attachmentCount = m.attachments.length;

  const primaryButton =
    "inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[13px] font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:opacity-50";
  const secondaryButton =
    "inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50";
  const dangerButton =
    "inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--crit)]/50 px-4 text-[13px] font-medium text-[var(--crit)] transition hover:bg-[var(--crit-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crit)] disabled:opacity-50";

  const reschedule = (when: Date) =>
    queued.mutate({ messageId, action: "reschedule", scheduledAt: when.toISOString() });

  const viewTags = view && (
    <>
      {view.folder === "SCHEDULED" && (
        <>
          <StatusTag><Clock className="h-3 w-3" aria-hidden /> Scheduled</StatusTag>
          <StatusTag tone="muted">{recipientCount} recipient{recipientCount === 1 ? "" : "s"}</StatusTag>
        </>
      )}
      {view.folder === "ARCHIVE" && <StatusTag><Archive className="h-3 w-3" aria-hidden /> Archived</StatusTag>}
      {view.folder === "SPAM" && (
        <>
          <StatusTag tone="crit"><ShieldAlert className="h-3 w-3" aria-hidden /> Suspected spam</StatusTag>
          <StatusTag tone="muted">Restricted preview</StatusTag>
        </>
      )}
      {view.folder === "TRASH" && <StatusTag tone="crit"><Trash2 className="h-3 w-3" aria-hidden /> In Trash</StatusTag>}
      {attachmentCount > 0 && (
        <StatusTag tone="muted">{attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}</StatusTag>
      )}
    </>
  );

  const statusCard = view && (
    <StatusCard
      folder={view.folder}
      scheduledAt={m.scheduledAt}
      action={
        view.folder === "SCHEDULED" && own ? (
          <ReschedulePicker onPick={reschedule} disabled={queued.isPending} className={`${secondaryButton} h-9 bg-[var(--surface)]`}>
            Reschedule
          </ReschedulePicker>
        ) : undefined
      }
    />
  );

  const iconButton =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--ink2)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50";

  return (
    <article className="flex min-h-0 w-full flex-1 flex-col" aria-label={m.subject || "(no subject)"}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3">
        <button onClick={onClose} className={`${iconButton} lg:hidden`} aria-label="Back to list" title="Back to list">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button onClick={onClose} className={`${iconButton} hidden lg:inline-flex`} aria-label="Close message" title="Close message">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => update.mutate({ messageId, isStarred: !item.isStarred, mailboxId })}
          className={iconButton}
          title={item.isStarred ? "Unstar" : "Star"}
          aria-label={item.isStarred ? "Unstar" : "Star"}
          aria-pressed={item.isStarred}
        >
          <Star className={`h-4 w-4 ${item.isStarred ? "fill-[var(--warn)] text-[var(--warn)]" : ""}`} />
        </button>
        {canTriage && folder !== "ARCHIVE" && folder !== "TRASH" && (
          <button title="Archive" aria-label="Archive" onClick={() => move("ARCHIVE")} className={iconButton}>
            <Archive className="h-4 w-4" />
          </button>
        )}
        {canTriage && (
          <DropdownMenu
            align="left"
            trigger={
              <span className={iconButton} title="Move to">
                <FolderInput className="h-4 w-4" aria-hidden />
                <span className="sr-only">Move to</span>
              </span>
            }
          >
            {folder !== "INBOX" && <DropdownItem onClick={() => move("INBOX")}><Inbox className="h-3.5 w-3.5" /> Inbox</DropdownItem>}
            {folder !== "ARCHIVE" && folder !== "TRASH" && folder !== "SPAM" && (
              <DropdownItem onClick={() => move("ARCHIVE")}><Archive className="h-3.5 w-3.5" /> Archive</DropdownItem>
            )}
            {(folder === "INBOX" || folder === "ARCHIVE") && (
              <DropdownItem onClick={() => move("SPAM")}><ShieldAlert className="h-3.5 w-3.5" /> Spam</DropdownItem>
            )}
            {folder !== "TRASH" && <DropdownItem danger onClick={() => move("TRASH")}><Trash2 className="h-3.5 w-3.5" /> Trash</DropdownItem>}
          </DropdownMenu>
        )}
        {own && isSnoozed && (
          <button
            onClick={() => { snooze.mutate({ messageId, until: null }); onClose(); }}
            disabled={snooze.isPending}
            className={iconButton}
            title="Unsnooze — back to Inbox now"
            aria-label="Unsnooze"
          >
            <Clock className="h-4 w-4" />
          </button>
        )}
        {own && folder === "INBOX" && (
          <SnoozeMenu
            disabled={snooze.isPending}
            onSnooze={(until) => {
              snooze.mutate({ messageId, until: until.toISOString() });
              onClose();
            }}
          />
        )}
        {own && (
          <DropdownMenu
            align="left"
            trigger={
              <span className={iconButton} title="Labels">
                <Tag className="h-4 w-4" aria-hidden />
                <span className="sr-only">Labels</span>
              </span>
            }
          >
            {labels.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--ink3)]">No labels yet — create one from the list&rsquo;s ⋯ menu.</p>
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
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                  <span className="flex-1">{l.name}</span>
                  {assigned && <span className="text-[10px] font-semibold">✓</span>}
                </DropdownItem>
              );
            })}
          </DropdownMenu>
        )}
        <DropdownMenu
          align="left"
          trigger={
            <span className={iconButton} title="More">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
              <span className="sr-only">More actions</span>
            </span>
          }
        >
          <DropdownItem onClick={() => { update.mutate({ messageId, isRead: false, mailboxId }); onClose(); }}>
            <MailX className="h-3.5 w-3.5" /> Mark as unread
          </DropdownItem>
          {own && folder === "TRASH" && (
            <DropdownItem danger onClick={() => setConfirmDelete(true)} disabled={permanentlyDelete.isPending}>
              <X className="h-3.5 w-3.5" /> Delete forever
            </DropdownItem>
          )}
        </DropdownMenu>
        <div className="flex-1" />
        {!view && (
          <div className="hidden md:block">
            <ComingSoonButton icon={Sparkles} label="Summarize with Alet" hint="Alet summaries are coming soon" />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {/* Subject and where the message sits */}
        <div className="px-6 pb-2 pt-5 lg:px-8">
          {view && (
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{view.paneEyebrow}</p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold leading-snug text-[var(--ink)]">{m.subject || "(no subject)"}</h1>
            {!view && (
              <span className="rounded-md border border-[var(--border)] bg-[var(--s2)] px-2 py-0.5 text-[11px] font-medium text-[var(--ink2)]">
                {sharedInbox ? sharedInbox.address.split("@")[0] : folderTitle(folder)}
              </span>
            )}
          </div>
          <div className={`flex flex-wrap items-center gap-1.5 ${view || item.labels.length > 0 ? "mt-2" : ""}`}>
            {viewTags}
            {item.labels.map((l) => (
              <span
                key={l.id}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: `${l.color}26`, color: l.color }}
              >
                {l.name}
              </span>
            ))}
          </div>
          {threadMessages && <p className="mt-1 text-xs text-[var(--ink3)]">{threadMessages.length} messages in this conversation</p>}
          {threadMessages && statusCard && <div className="mt-4">{statusCard}</div>}
        </div>

        {threadMessages ? (
          threadMessages.map((tm, idx) => {
            const isLast = idx === threadMessages.length - 1;
            const isOpen = expandedMessageId ? expandedMessageId === tm.id : isLast;
            const tmTo = tm.recipients.filter((r) => r.type === "TO").map((r) => r.email);
            const tmCc = tm.recipients.filter((r) => r.type === "CC").map((r) => r.email);
            const tmSender = tm.fromName || tm.author?.displayName || tm.fromAddress || tm.author?.email;
            return (
              <div key={tm.id} className="mx-6 border-b border-[var(--border)] lg:mx-8">
                <button
                  onClick={() => setExpandedMessageId(isOpen ? null : tm.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  <Avatar name={tmSender} className="h-9 w-9 text-[12px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{tmSender}</span>
                    {!isOpen && <span className="block truncate text-xs text-[var(--ink3)]">{tm.textBody?.slice(0, 120) || ""}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--ink3)]">{formatMailTime(tm.sentAt || tm.createdAt)}</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--ink3)] transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {isOpen && (
                  <div className="pb-6 pl-12">
                    <div className="mb-3 text-xs text-[var(--ink3)]">
                      To: {tmTo.join(", ") || "—"}
                      {tmCc.length > 0 && <> · Cc: {tmCc.join(", ")}</>}
                    </div>
                    {restricted ? (
                      <>
                        <RestrictedBody html={tm.htmlBody} text={tm.textBody} />
                        <BlockedAttachments attachments={tm.attachments} />
                      </>
                    ) : (
                      <>
                        {tm.htmlBody ? (
                          <EmailBody html={tm.htmlBody} revision={themeRev} />
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[var(--ink)]">
                            {tm.textBody || "(no content)"}
                          </div>
                        )}
                        <AttachmentList messageId={tm.id} attachments={tm.attachments} mailboxId={mailboxId} />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="px-6 pb-8 lg:px-8">
            {/* Sender, recipients and time */}
            <div className="flex items-start gap-3.5 border-b border-[var(--border)] py-4">
              <Avatar name={senderLabel} className="h-11 w-11 text-[14px]" />
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-semibold text-[var(--ink)]">{senderLabel}</span>
                  {senderAddress && senderAddress !== senderLabel && (
                    <span className="truncate text-[var(--ink3)]">&lt;{senderAddress}&gt;</span>
                  )}
                </div>
                <div className="mt-1 truncate text-[12px] text-[var(--ink3)]">To: {to.join(", ") || "—"}</div>
                {cc.length > 0 && <div className="mt-0.5 truncate text-[12px] text-[var(--ink3)]">Cc: {cc.join(", ")}</div>}
              </div>
              <time
                className="shrink-0 text-[12px] text-[var(--ink3)]"
                dateTime={m.sentAt || m.createdAt}
                title={new Date(m.sentAt || m.createdAt).toLocaleString()}
              >
                {formatMailTime(m.sentAt || m.createdAt)}
              </time>
            </div>

            {statusCard && <div className="pt-4">{statusCard}</div>}

            {/* Body */}
            {restricted ? (
              <div className="pt-5">
                <RestrictedBody html={m.htmlBody} text={m.textBody} />
                <BlockedAttachments attachments={m.attachments} />
              </div>
            ) : (
              <>
                <div className="pt-5">
                  {m.htmlBody ? (
                    <EmailBody html={m.htmlBody} revision={themeRev} />
                  ) : (
                    <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[var(--ink)]">
                      {m.textBody || "(no content)"}
                    </div>
                  )}
                </div>

                <AttachmentList messageId={messageId} attachments={m.attachments} mailboxId={mailboxId} />
              </>
            )}
          </div>
        )}

        {view && (
          <div className="px-6 pb-8 lg:px-8">
            <AletCard hint={view.aletHint} />
          </div>
        )}
      </div>

      {/* Actions, always in reach */}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">
        {view?.folder === "SCHEDULED" && own ? (
          <>
            <button
              onClick={() =>
                queued.mutate(
                  { messageId, action: "cancel" },
                  { onSuccess: () => { onCompose("edit", item); onClose(); } }
                )
              }
              disabled={queued.isPending}
              className={primaryButton}
              title="Moves it back to Drafts while you edit. Send or schedule it again from the composer."
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit message
            </button>
            <ReschedulePicker onPick={reschedule} disabled={queued.isPending} placement="above" align="left" className={secondaryButton}>
              <Clock className="h-4 w-4" aria-hidden /> Reschedule
            </ReschedulePicker>
            <button
              onClick={() => queued.mutate({ messageId, action: "sendNow" }, { onSuccess: onClose })}
              disabled={queued.isPending}
              className={secondaryButton}
            >
              <Send className="h-4 w-4" aria-hidden /> Send now
            </button>
            <button
              onClick={() => queued.mutate({ messageId, action: "cancel" }, { onSuccess: onClose })}
              disabled={queued.isPending}
              className={dangerButton}
              title="Stop the scheduled send. The message stays in Drafts."
            >
              <X className="h-4 w-4" aria-hidden /> Cancel send
            </button>
            {queued.isPending && <Loader2 className="h-4 w-4 animate-spin text-[var(--ink3)]" aria-label="Working" />}
            {queued.error && (
              <p className="w-full text-[12px] text-[var(--crit)]" role="alert">
                {queued.error instanceof ApiError ? queued.error.message : "That didn't work. Please try again."}
              </p>
            )}
          </>
        ) : view?.folder === "ARCHIVE" || view?.folder === "TRASH" ? (
          <>
            {canMove && (
              <button onClick={() => move("INBOX")} disabled={update.isPending} className={primaryButton}>
                <Undo2 className="h-4 w-4" aria-hidden /> Restore to Inbox
              </button>
            )}
            {view.folder === "ARCHIVE" && canReply && (
              <>
                <button onClick={() => onCompose("reply", item)} className={secondaryButton}>
                  <Reply className="h-4 w-4" aria-hidden /> Reply
                </button>
                <button onClick={() => onCompose("forward", item)} className={secondaryButton}>
                  <Forward className="h-4 w-4" aria-hidden /> Forward
                </button>
              </>
            )}
            {view.folder === "TRASH" && own && (
              <button onClick={() => setConfirmDelete(true)} disabled={permanentlyDelete.isPending} className={dangerButton}>
                <X className="h-4 w-4" aria-hidden /> Delete forever
              </button>
            )}
          </>
        ) : view?.folder === "SPAM" ? (
          canMove ? (
            <>
              <button onClick={() => move("INBOX")} disabled={update.isPending} className={primaryButton} title="Move to Inbox">
                <Inbox className="h-4 w-4" aria-hidden /> Not spam
              </button>
              <button onClick={() => move("TRASH")} disabled={update.isPending} className={secondaryButton}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </button>
            </>
          ) : (
            <p className="text-[12.5px] text-[var(--ink3)]">You can review this message but not move it.</p>
          )
        ) : isDraft && own ? (
          <>
            <button
              onClick={() => onCompose("edit", item)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[13px] font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              title="Continue editing this draft"
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit draft
            </button>
            {folder === "DRAFTS" && (
              <button
                onClick={async () => {
                  const { sendDraft } = await import("@/lib/mail-api");
                  await sendDraft(messageId);
                  onClose();
                }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--s2)]"
                title="Send this draft now"
              >
                <Send className="h-4 w-4" aria-hidden /> Send now
              </button>
            )}
          </>
        ) : canReply ? (
          <>
            <button
              onClick={() => onCompose("reply", item)}
              title="Reply"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-[13px] font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              <Reply className="h-4 w-4" aria-hidden /> Reply
            </button>
            <button
              onClick={() => onCompose("replyAll", item)}
              title="Reply all"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <ReplyAll className="h-4 w-4" aria-hidden /> Reply all
            </button>
            <button
              onClick={() => onCompose("forward", item)}
              title="Forward"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--ink)] transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <Forward className="h-4 w-4" aria-hidden /> Forward
            </button>
          </>
        ) : (
          <p className="text-[12.5px] text-[var(--ink3)]">
            You can read this inbox but not send from it. Ask an admin for send access to reply.
          </p>
        )}
        {!view && (
          <>
            <div className="flex-1" />
            <ComingSoonButton icon={ListChecks} label="Create task" hint="Tasks are coming soon" />
          </>
        )}
      </div>

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
    </article>
  );
}

// ---- Label manager ---------------------------------------------------------
// Create labels (name + palette color) and delete existing ones. Assigning
// happens per-message via the Labels menu in the reading pane.

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
            aria-label="New label name"
            maxLength={50}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <div className="flex items-center gap-1.5">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Use color ${c}`}
                aria-pressed={color === c}
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
                aria-label={`Delete ${l.name}`}
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
