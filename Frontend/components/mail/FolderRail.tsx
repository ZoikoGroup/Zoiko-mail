"use client";

import {
  Pencil, Inbox, Star, Clock, Send, CalendarClock, FileText, Archive,
  Ban, ShieldAlert, Trash2,
} from "lucide-react";
import type { MailListFolder } from "@/lib/mail-api";
import { StorageMeter } from "@/components/mail/StorageMeter";

interface FolderRow {
  key: MailListFolder;
  label: string;
  icon: typeof Inbox;
  /** Which key in the unread-counts response feeds this row's badge, if
   * it has one. Most are their own folder; STARRED has no backend count
   * (starred mail spans every folder, so there's no single bucket to
   * count), so it's left undefined and shows no badge. */
  countKey?: string;
}

// Order and grouping match the approved design (Screen 1, desktop rail).
const FOLDER_ROWS: FolderRow[] = [
  { key: "INBOX", label: "Inbox", icon: Inbox, countKey: "INBOX" },
  { key: "STARRED", label: "Starred", icon: Star },
  { key: "SNOOZED", label: "Snoozed", icon: Clock, countKey: "SNOOZED" },
  { key: "SENT", label: "Sent", icon: Send },
  { key: "SCHEDULED", label: "Scheduled", icon: CalendarClock, countKey: "SCHEDULED" },
  { key: "DRAFTS", label: "Drafts", icon: FileText, countKey: "DRAFTS" },
  { key: "ARCHIVE", label: "Archive", icon: Archive },
  { key: "SPAM", label: "Spam", icon: Ban, countKey: "SPAM" },
  { key: "QUARANTINE", label: "Quarantine", icon: ShieldAlert },
  { key: "TRASH", label: "Trash", icon: Trash2 },
];

export function FolderRail({
  folder,
  onFolderChange,
  unreadCounts,
  onCompose,
  storageUsed,
  storageLimit,
  storageLoading = false,
}: {
  folder: MailListFolder;
  onFolderChange: (folder: MailListFolder) => void;
  unreadCounts: Record<string, number> | undefined;
  onCompose: () => void;
  storageUsed: number;
  storageLimit: number;
  storageLoading?: boolean;
}) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-3">
      <button onClick={onCompose} className="zoiko-btn pri mb-3 w-full">
        <Pencil className="h-4 w-4" /> Compose
      </button>

      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {FOLDER_ROWS.map((row) => {
          const Icon = row.icon;
          const active = folder === row.key;
          const count = row.countKey ? unreadCounts?.[row.countKey] ?? 0 : 0;
          return (
            <button
              key={row.key}
              onClick={() => onFolderChange(row.key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-ink)]"
                  : "text-[var(--ink2)] hover:bg-[var(--s2)]"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" /> {row.label}
              {count > 0 && (
                <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <StorageMeter usedBytes={storageUsed} limitBytes={storageLimit} loading={storageLoading} />
    </aside>
  );
}