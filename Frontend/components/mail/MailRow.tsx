"use client";

import { Star, Paperclip, Trash2, Clock, AlertTriangle } from "lucide-react";
import type { MailItem, MailListItem, MailListFolder } from "@/lib/mail-api";
import { shortSendTime, zoneAbbr } from "@/components/mail/folder-views";
import { senderLabel } from "@/lib/mail-quote";

// A fixed, readable palette — hashed by sender so the same person always
// gets the same colour across the inbox, without storing a colour anywhere.
const AVATAR_COLORS = [
  "#2F6FED", "#0EA5A4", "#C2410C", "#7C3AED", "#BE185D",
  "#15803D", "#B45309", "#0369A1", "#9333EA", "#DC2626",
];

export function hashColor(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function avatarInitials(name: string): string {
  const clean = name.replace(/<.*?>/g, "").trim();
  const base = clean.includes("@") && !clean.includes(" ") ? clean.split("@")[0].replace(/[._-]+/g, " ") : clean;
  const parts = base.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

/** The same name the reading pane shows (lib/mail-quote.ts senderLabel). */
function senderName(item: MailListItem | MailItem): string {
  return senderLabel(item.message);
}

/**
 * In Sent and Drafts the sender is always oneself; who it went to is what
 * matters. Falls back to the sender if a row carries no recipients.
 */
function recipientSummary(item: MailListItem | MailItem): string {
  const recipients = (item.message as { recipients?: { type: string; email: string }[] }).recipients;
  const to = recipients?.filter((r) => r.type === "TO").map((r) => r.email) ?? [];
  if (to.length === 0) return senderName(item);
  return to.join(", ");
}

export function formatMailTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export function MailRow({
  item,
  folder,
  selected,
  checked,
  onToggleChecked,
  onSelect,
  showDeleteDraft = false,
  onDeleteDraft,
  selectable = true,
  compact = false,
  showPreview = true,
}: {
  item: MailListItem;
  /** Sent and Drafts show the recipient instead of the (always-you) sender. */
  folder?: MailListFolder;
  selected: boolean;
  checked: boolean;
  onToggleChecked: () => void;
  onSelect: () => void;
  showDeleteDraft?: boolean;
  onDeleteDraft?: () => void;
  /** Bulk selection is offered for one's own mailbox only. */
  selectable?: boolean;
  /** Settings → Mailbox Preferences: Compact density. */
  compact?: boolean;
  /** Settings → Mailbox Preferences: the excerpt under the subject. */
  showPreview?: boolean;
}) {
  const showRecipient = folder === "SENT" || folder === "DRAFTS" || folder === "SCHEDULED";
  const name = showRecipient ? recipientSummary(item) : senderName(item);
  const label = showRecipient ? `To: ${name}` : name;
  const unread = !item.isRead;
  const attachments = item.message.attachmentCount ?? (item.message.hasAttachments ? 1 : 0);
  // A queued message is about when it goes, not when it was written.
  const scheduledAt = folder === "SCHEDULED" ? item.message.scheduledAt : null;
  const time = scheduledAt ? shortSendTime(scheduledAt) : formatMailTime(item.message.sentAt || item.createdAt);
  const statusTag = scheduledAt ? (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--accent-ink)]">
      <Clock className="h-2.5 w-2.5" aria-hidden /> Scheduled · {zoneAbbr(new Date(scheduledAt))}
    </span>
  ) : folder === "SPAM" ? (
    <span className="inline-flex items-center gap-1 rounded border border-[var(--crit)]/40 bg-[var(--crit-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--crit)]">
      <AlertTriangle className="h-2.5 w-2.5" aria-hidden /> Suspected spam
    </span>
  ) : null;

  return (
    <li
      className={`relative flex items-start border-b border-[var(--border)] transition ${
        selected
          ? "bg-[var(--zm-selected,var(--accent-soft))] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--accent)]"
          : "hover:bg-[var(--s2)]"
      }`}
    >
      {/* Unread marker, then the checkbox — in the reference's order. */}
      <span className={`flex w-4 shrink-0 justify-end self-stretch ${compact ? "pt-[17px]" : "pt-[26px]"}`} aria-hidden>
        {unread && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
      </span>
      {selectable ? (
        <label
          className={`flex shrink-0 cursor-pointer items-start self-stretch px-2.5 ${compact ? "pt-[12px]" : "pt-[21px]"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="sr-only">Select message from {label}</span>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleChecked}
            className="h-4 w-4 rounded accent-[var(--accent)]"
          />
        </label>
      ) : (
        <span className="w-2" aria-hidden />
      )}

      <button
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex min-w-0 flex-1 items-start gap-3 pr-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${compact ? "py-2" : "py-4"}`}
        data-density={compact ? "compact" : "comfortable"}
      >
        <span
          className={`mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${compact ? "h-7 w-7 text-[10.5px]" : "h-9 w-9 text-[12px]"}`}
          style={{ backgroundColor: hashColor(name) }}
          aria-hidden
        >
          {avatarInitials(name)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`truncate text-[13.5px] ${unread ? "font-semibold text-[var(--ink)]" : "font-medium text-[var(--ink2)]"}`}>
              {label}
            </span>
            {item.isStarred && <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--warn)] text-[var(--warn)]" aria-label="Starred" />}
            <span className={`ml-auto shrink-0 text-[11.5px] ${unread ? "text-[var(--ink2)]" : "text-[var(--ink3)]"}`}>
              {time}
            </span>
          </span>
          <span className={`mt-0.5 block truncate text-[13px] ${unread ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>
            {item.message.subject || "(no subject)"}
          </span>
          {showPreview && item.message.snippet && (
            <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ink3)]">{item.message.snippet}</span>
          )}
          {(statusTag || attachments > 0 || item.labels.length > 0) && (
            <span className={`flex flex-wrap items-center gap-1.5 ${compact ? "mt-1" : "mt-1.5"}`}>
              {statusTag}
              {item.labels.slice(0, 3).map((l) => (
                <span
                  key={l.id}
                  className="rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                  style={{ backgroundColor: `${l.color}26`, color: l.color }}
                >
                  {l.name}
                </span>
              ))}
              {attachments > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ink3)]">
                  <Paperclip className="h-3 w-3" aria-hidden />
                  {attachments} attachment{attachments > 1 ? "s" : ""}
                </span>
              )}
            </span>
          )}
        </span>
      </button>

      {showDeleteDraft && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteDraft?.();
          }}
          title="Delete draft"
          aria-label="Delete draft"
          className="mr-3 self-center rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--crit-soft)] hover:text-[var(--crit)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

/** Groups a newest-first list into Today / Yesterday / date buckets. */
export function groupByDay<T extends { message: { sentAt: string | null }; createdAt: string }>(
  items: T[]
): { label: string; items: T[] }[] {
  const now = new Date();
  const todayKey = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = yesterday.toDateString();

  const groups: { label: string; items: T[] }[] = [];
  const indexByLabel = new Map<string, number>();

  for (const item of items) {
    const iso = item.message.sentAt || item.createdAt;
    const d = new Date(iso);
    const key = d.toDateString();
    const label =
      key === todayKey ? "Today" : key === yesterdayKey ? "Yesterday" : d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });

    let idx = indexByLabel.get(label);
    if (idx === undefined) {
      idx = groups.length;
      indexByLabel.set(label, idx);
      groups.push({ label, items: [] });
    }
    groups[idx].items.push(item);
  }

  return groups;
}
