"use client";

import { formatStorageUsage } from "@/lib/storage-api";
import Link from "next/link";
import { useState } from "react";
// import Link from "next/link";
import {
  Pencil, Inbox, Star, Clock, Send, CalendarClock, FileText, Archive,
  Ban, Trash2, MoreHorizontal, ChevronRight, Folder, Tag, Users, UserRound,
} from "lucide-react";
import type { MailListFolder, SharedInbox } from "@/lib/mail-api";
import { useMailLabels, useSharedInboxes } from "@/lib/mail-hooks";
import { Spinner } from "@/components/ui/Spinner";
import { SETTINGS_SECTIONS, type SettingsSectionKey } from "@/components/settings/sections";

interface FolderRow {
  key: MailListFolder;
  label: string;
  icon: typeof Inbox;
  /** Which key in the unread-counts response feeds this row's badge, if any.
   * Only folders where mail arrives unread have one (Inbox, Spam): a badge means
   * "unread", so it clears once the mail is read. Drafts, Snoozed and Scheduled
   * hold totals, which never clear, so they show no number here. */
  countKey?: string;
}

// Always shown, in the reference design's order.
const PRIMARY: FolderRow[] = [
  { key: "INBOX", label: "Inbox", icon: Inbox, countKey: "INBOX" },
  { key: "STARRED", label: "Starred", icon: Star },
  { key: "DRAFTS", label: "Drafts", icon: FileText },
  { key: "SENT", label: "Sent", icon: Send },
  { key: "SNOOZED", label: "Snoozed", icon: Clock },
];

// Behind "More mail".
const MORE: FolderRow[] = [
  { key: "SCHEDULED", label: "Scheduled", icon: CalendarClock },
  { key: "ARCHIVE", label: "Archive", icon: Archive },
  { key: "SPAM", label: "Spam", icon: Ban, countKey: "SPAM" },
  { key: "TRASH", label: "Trash", icon: Trash2 },
];

const SHARED_SHOWN = 5;

export function folderLabel(folder: MailListFolder): string {
  return [...PRIMARY, ...MORE].find((row) => row.key === folder)?.label ?? "Mail";
}

function Count({ value, active }: { value: number; active: boolean }) {
  if (value <= 0) return null;
  return (
    <span
      className={`ml-auto inline-flex min-w-[22px] items-center justify-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold text-white ${
        active ? "" : "opacity-90"
      }`}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

const rowClass = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
    active
      ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]"
      : "text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
  }`;

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{children}</h2>
  );
}

export function FolderRail({
  folder,
  onFolderChange,
  unreadCounts,
  onCompose,
  storageUsed,
  storageLimit,
  storageLoading = false,
  labelId = "",
  onLabelChange,
  sharedMailboxId = null,
  onOpenShared,
  fill = false,
  settingsSection = null,
  onNavigate,
}: {
  folder: MailListFolder;
  onFolderChange: (folder: MailListFolder) => void;
  unreadCounts: Record<string, number> | undefined;
  onCompose: () => void;
  storageUsed: number;
  storageLimit: number;
  storageLoading?: boolean;
  /** The label the list is filtered to, if any. */
  labelId?: string;
  onLabelChange?: (labelId: string) => void;
  /** The shared inbox being read, or null for one's own mailbox. */
  sharedMailboxId?: string | null;
  onOpenShared?: (inbox: SharedInbox | null) => void;
  /** Fill a parent that sets the width (the resizable desktop column). */
  fill?: boolean;
  /** The Settings page being shown, if any: it is highlighted instead of a folder. */
  settingsSection?: SettingsSectionKey | null;
  /** Called when a Settings link is followed (the phone drawer closes). */
  onNavigate?: () => void;
}) {
  const inMore = MORE.some((row) => row.key === folder);
  const [moreOpen, setMoreOpen] = useState(inMore);
  const [labelsOpen, setLabelsOpen] = useState(Boolean(labelId));
  const [allShared, setAllShared] = useState(false);
  const { data: labels = [] } = useMailLabels();
  const { data: shared = [], isLoading: sharedLoading } = useSharedInboxes();
  // In Settings no folder is the current page, though the shell still holds one.
  const ownMailbox = sharedMailboxId === null && !settingsSection;

  const folderButton = (row: FolderRow) => {
    const Icon = row.icon;
    const active = ownMailbox && !labelId && folder === row.key;
    const count = row.countKey ? unreadCounts?.[row.countKey] ?? 0 : 0;
    return (
      <li key={row.key}>
        <button
          type="button"
          onClick={() => {
            onOpenShared?.(null);
            onLabelChange?.("");
            onFolderChange(row.key);
          }}
          className={rowClass(active)}
          aria-current={active ? "page" : undefined}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{row.label}</span>
          <Count value={count} active={active} />
        </button>
      </li>
    );
  };

  const visibleShared = allShared ? shared : shared.slice(0, SHARED_SHOWN);
  const storagePct = storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;

  return (
    <aside
      aria-label="Mail folders"
      className={`flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] ${fill ? "w-full" : "w-[240px]"}`}
    >
      <div className="p-3 pb-1">
        <button
          type="button"
          onClick={onCompose}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(47,111,237,0.7)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
        >
          <Pencil className="h-4 w-4" aria-hidden /> Compose
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <SectionTitle>Mail</SectionTitle>
        <ul className="space-y-0.5">
          {PRIMARY.map(folderButton)}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className={rowClass(false)}
            >
              <MoreHorizontal className="h-4 w-4 shrink-0" aria-hidden />
              <span>{moreOpen ? "Less" : "More mail"}</span>
              <ChevronRight
                className={`ml-auto h-4 w-4 text-[var(--ink3)] transition-transform ${moreOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
            </button>
          </li>
          {moreOpen && MORE.map(folderButton)}
        </ul>

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        <SectionTitle>Shared inboxes</SectionTitle>
        {sharedLoading ? (
          <Spinner size="sm" label="Loading shared inboxes" className="px-3 py-1 text-xs" />
        ) : shared.length === 0 ? (
          <p className="px-3 py-1 text-xs text-[var(--ink3)]">None shared with you yet.</p>
        ) : (
          <ul className="space-y-0.5" data-testid="shared-inboxes">
            {visibleShared.map((inbox) => {
              const active = sharedMailboxId === inbox.id;
              const Icon = inbox.delegated ? UserRound : Users;
              return (
                <li key={inbox.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onLabelChange?.("");
                      onFolderChange("INBOX");
                      onOpenShared?.(inbox);
                    }}
                    className={rowClass(active)}
                    aria-current={active ? "page" : undefined}
                    title={inbox.delegated ? `${inbox.address} (delegated to you)` : inbox.address}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{inbox.address.split("@")[0]}</span>
                    <Count value={inbox.unread} active={active} />
                  </button>
                </li>
              );
            })}
            {shared.length > SHARED_SHOWN && (
              <li>
                <button
                  type="button"
                  onClick={() => setAllShared((v) => !v)}
                  className="px-3 py-1.5 text-[12.5px] font-medium text-[var(--accent)] hover:underline"
                >
                  {allShared ? "Show fewer" : `View all shared inboxes (${shared.length}) →`}
                </button>
              </li>
            )}
          </ul>
        )}

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        <SectionTitle>Organize</SectionTitle>
        <ul className="space-y-0.5">
          <li>
            <span
              className="flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-[var(--ink3)]"
              title="Custom folders are coming soon"
            >
              <Folder className="h-4 w-4 shrink-0" aria-hidden /> Folders
              <span className="ml-auto rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                Soon
              </span>
            </span>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setLabelsOpen((v) => !v)}
              aria-expanded={labelsOpen}
              className={rowClass(false)}
            >
              <Tag className="h-4 w-4 shrink-0" aria-hidden /> Labels
              <ChevronRight
                className={`ml-auto h-4 w-4 text-[var(--ink3)] transition-transform ${labelsOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
            </button>
          </li>
          {labelsOpen &&
            (labels.length === 0 ? (
              <li className="px-3 py-1 pl-10 text-xs text-[var(--ink3)]">No labels yet.</li>
            ) : (
              labels.map((label) => {
                const active = labelId === label.id;
                return (
                  <li key={label.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onOpenShared?.(null);
                        onLabelChange?.(active ? "" : label.id);
                      }}
                      className={`${rowClass(active)} pl-10`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} aria-hidden />
                      <span className="truncate">{label.name}</span>
                    </button>
                  </li>
                );
              })
            ))}
        </ul>

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        <SectionTitle>Settings</SectionTitle>
        <ul className="space-y-0.5" data-testid="settings-nav">
          {SETTINGS_SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = settingsSection === s.key;
            return (
              <li key={s.key}>
                <Link href={s.href} onClick={onNavigate} className={rowClass(active)} aria-current={active ? "page" : undefined}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Link
        href="/mail/storage"
        aria-label="Mailbox storage details"
        className="block border-t border-[var(--border)] px-4 py-3.5 transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
        data-testid="storage-meter"
      >
        <div className="flex items-center justify-between text-[11.5px] text-[var(--ink3)]">
          <span>Mailbox storage</span>
          <span>{storageLoading ? "…" : `${formatStorageUsage(storageUsed, storageLimit)}`}</span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s3)]"
          role="progressbar"
          aria-label="Mailbox storage used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(storagePct)}
        >
          <div
            className={`h-full rounded-full ${storagePct > 90 ? "bg-[var(--crit)]" : storagePct > 75 ? "bg-[var(--warn)]" : "bg-[var(--accent)]"}`}
            style={{ width: `${Math.max(storagePct, storageUsed > 0 ? 2 : 0)}%` }}
          />
        </div>
      </Link>
    </aside>
  );
}
