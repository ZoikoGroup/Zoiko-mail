"use client";

/**
 * The webmail client, shell-free on purpose.
 *
 * Rendered by the member route (/mail, inside AppShell) and the admin route
 * (/admin/inbox, inside AdminShell), so an Admin reads their own mail without
 * being ejected into the member workspace and losing the admin rail.
 * One implementation, two shells — never a per-role copy.
 */

import { useEffect, useState } from "react";
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
} from "@/lib/mail-hooks";
import { ComposeModal } from "@/components/mail/ComposeModal";
import { Modal } from "@/components/ui/Modal";
import type { ComposerMode } from "@/lib/mail-hooks";
import { downloadAttachment, type MailFolder, type MailItem } from "@/lib/mail-api";
import {
  DropdownMenu, DropdownItem,
} from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Inbox, Send, FileText, Archive, Trash2, Star, Loader2, AlertCircle,
  ChevronLeft, ChevronRight, Paperclip, Download, ArrowLeft, MailOpen,
  Pencil, Reply, ReplyAll, Forward, Search, ShieldAlert, Tag, Settings2, X,
} from "lucide-react";

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

function sender(item: MailItem): string {
  const m = item.message;
  return m.fromName || m.fromAddress || m.author?.displayName || m.author?.email || "Unknown";
}

export function MailClient() {
  const [folder, setFolder] = useState<MailFolder>("INBOX");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ open: boolean; mode: ComposerMode; source: MailItem | null }>({
    open: false,
    mode: "new",
    source: null,
  });
  const openCompose = (mode: ComposerMode, source: MailItem | null) =>
    setCompose({ open: true, mode, source });

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [starredOnly, setStarredOnly] = useState(false);
  const [labelFilter, setLabelFilter] = useState<string>("");
  const { data: labels = [] } = useMailLabels();

  // Debounce search input → query param; any filter change resets paging.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setCheckedIds(new Set());
  }, [starredOnly, labelFilter]);

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
    ...(labelFilter ? { labelId: labelFilter } : {}),
  });
  const items = data?.items ?? [];
  const pagination = data?.pagination;

  const allChecked = items.length > 0 && items.every((it) => checkedIds.has(it.messageId));
  const toggleAllChecked = () =>
    setCheckedIds(allChecked ? new Set() : new Set(items.map((it) => it.messageId)));

  const switchFolder = (f: MailFolder) => {
    setFolder(f);
    setPage(1);
    setSelectedId(null);
    setSearchInput("");
    setQ("");
    setStarredOnly(false);
    setLabelFilter("");
    setCheckedIds(new Set());
  };

  return (
    <>
      <div className="flex h-full min-h-0">
        {/* Folder rail */}
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
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                    active
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

        {/* List column */}
        <section
          className={`flex min-w-0 flex-col border-r border-[var(--border)] ${
            selectedId ? "hidden md:flex md:w-80 lg:w-96" : "flex flex-1"
          }`}
        >
          {/* Mobile folder switch */}
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
                className={`shrink-0 rounded-full px-3 py-1 text-xs transition ${
                  folder === f.key
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface)] text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)]"
                }`}
              >
                {f.label}
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
                {(folder === "TRASH" || folder === "ARCHIVE") && (
                  <button onClick={() => runBulk("RESTORE")} disabled={bulk.isPending} className="zoiko-btn sm">Restore</button>
                )}
                {folder !== "TRASH" && folder !== "DRAFTS" && (
                  <button onClick={() => runBulk("TRASH")} disabled={bulk.isPending} className="zoiko-btn crit sm"><Trash2 className="h-3 w-3" /></button>
                )}
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
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

            <ul className="divide-y divide-[var(--border)]">
              {items.map((it) => (
                <li key={it.id} className="flex items-start">
                  <label
                    className="flex shrink-0 cursor-pointer items-center self-stretch px-3 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checkedIds.has(it.messageId)}
                      onChange={() => toggleChecked(it.messageId)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                    />
                  </label>
                  <button
                    onClick={() => setSelectedId(it.messageId)}
                    className={`min-w-0 flex-1 flex-col gap-1 px-2 py-3 pr-4 text-left transition hover:bg-[var(--s2)] ${
                      selectedId === it.messageId ? "bg-[var(--s2)]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {!it.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />}
                      <span className={`truncate text-sm ${it.isRead ? "text-[var(--ink2)]" : "font-semibold text-[var(--ink)]"}`}>
                        {sender(it)}
                      </span>
                      {it.isStarred && <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--warn)] text-[var(--warn)]" />}
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--ink3)]">
                        {fmt(it.message.sentAt || it.createdAt)}
                      </span>
                    </div>
                    <span className={`truncate text-sm ${it.isRead ? "text-[var(--ink3)]" : "text-[var(--ink)]"}`}>
                      {it.message.subject || "(no subject)"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {it.message.attachments.length > 0 && (
                        <Paperclip className="h-3 w-3 text-[var(--ink3)]" />
                      )}
                      {it.labels.slice(0, 2).map((l) => (
                        <span
                          key={l.id}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: `${l.color}22`, color: l.color }}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </button>
                  {folder === "DRAFTS" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraftToDelete(it.messageId);
                      }}
                      title="Delete draft"
                      className="mr-3 self-center rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--crit-soft)] hover:text-[var(--crit)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
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
        <section className={`min-w-0 flex-1 overflow-y-auto ${selectedId ? "flex" : "hidden md:flex"}`}>
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
}

function ReadingPane({
  messageId,
  folder,
  onClose,
  onCompose,
}: {
  messageId: string;
  folder: MailFolder;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] p-3">
        <button onClick={onClose} className="zoiko-btn sm md:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => update.mutate({ messageId, isStarred: !item.isStarred })}
          className="zoiko-btn sm"
          title={item.isStarred ? "Unstar" : "Star"}
        >
          <Star className={`h-4 w-4 ${item.isStarred ? "fill-[var(--warn)] text-[var(--warn)]" : ""}`} />
        </button>
        {canTriage && folder !== "ARCHIVE" && (
          <button onClick={() => { update.mutate({ messageId, folder: "ARCHIVE" }); onClose(); }} className="zoiko-btn sm">
            <Archive className="h-4 w-4" /> <span className="hidden sm:inline">Archive</span>
          </button>
        )}
        {canTriage && folder !== "TRASH" && (
          <button onClick={() => { update.mutate({ messageId, folder: "TRASH" }); onClose(); }} className="zoiko-btn crit sm">
            <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Trash</span>
          </button>
        )}
        {folder === "TRASH" && (
          <button onClick={() => { update.mutate({ messageId, folder: "INBOX" }); onClose(); }} className="zoiko-btn sm">
            Restore
          </button>
        )}
        {folder === "TRASH" && (
          <button onClick={() => setConfirmDelete(true)} disabled={permanentlyDelete.isPending} className="zoiko-btn crit sm" title="Delete forever">
            <X className="h-4 w-4" /> <span className="hidden sm:inline">Delete forever</span>
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu
            trigger={
              <span className="zoiko-btn sm">
                <Tag className="h-4 w-4" /> <span className="hidden sm:inline">Labels</span>
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
          <button onClick={() => onCompose("reply", item)} className="zoiko-btn sm" title="Reply">
            <Reply className="h-4 w-4" /> <span className="hidden sm:inline">Reply</span>
          </button>
          <button onClick={() => onCompose("replyAll", item)} className="zoiko-btn sm" title="Reply all">
            <ReplyAll className="h-4 w-4" />
          </button>
          <button onClick={() => onCompose("forward", item)} className="zoiko-btn sm" title="Forward">
            <Forward className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="border-b border-[var(--border)] p-5">
        <h1 className="font-editorial text-xl font-normal text-[var(--ink)]">
          {m.subject || "(no subject)"}
        </h1>
        <div className="mt-2 text-sm text-[var(--ink2)]">
          <span className="font-medium">{m.fromName || m.author?.displayName || m.fromAddress || m.author?.email}</span>
          {(m.fromAddress || m.author?.email) && (
            <span className="text-[var(--ink3)]"> &lt;{m.fromAddress || m.author?.email}&gt;</span>
          )}
        </div>
        <div className="mt-1 text-xs text-[var(--ink3)]">
          To: {to.join(", ") || "—"}
          {cc.length > 0 && <> · Cc: {cc.join(", ")}</>}
        </div>
        <div className="mt-1 text-xs text-[var(--ink3)]">{fmt(m.sentAt || m.createdAt)}</div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {m.htmlBody ? (
          <iframe
            title="message body"
            sandbox=""
            srcDoc={m.htmlBody}
            className="h-[60vh] w-full rounded-lg border border-[var(--border)] bg-white"
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
              {m.attachments.map((att) => (
                <button
                  key={att.id}
                  onClick={() => downloadAttachment(messageId, att)}
                  className="zoiko-card flex items-center gap-2 p-3 text-left transition hover:shadow-[var(--sh2)]"
                >
                  <Paperclip className="h-4 w-4 text-[var(--ink3)]" />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-[var(--ink)]">{att.fileName}</div>
                    <div className="text-[11px] text-[var(--ink3)]">{bytes(att.sizeBytes)}</div>
                  </div>
                  <Download className="ml-2 h-4 w-4 text-[var(--ink3)]" />
                </button>
              ))}
            </div>
          </div>
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
                className={`h-6 w-6 rounded-full transition ${
                  color === c ? "ring-2 ring-offset-2 ring-[var(--ink2)] ring-offset-[var(--surface)]" : ""
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