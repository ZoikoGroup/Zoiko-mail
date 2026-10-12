"use client";

import { Star, Paperclip, Trash2 } from "lucide-react";
import type { MailItem, MailListItem, MailListFolder } from "@/lib/mail-api";

// A fixed, readable-on-dark palette — hashed by sender so the same person
// always gets the same color across the whole inbox, without needing to
// store a color anywhere.
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Works for a list row or a detail read — both carry the sender fields. */
function senderName(item: MailListItem | MailItem): string {
  const m = item.message;
  return m.fromName || m.fromAddress || m.author?.displayName || m.author?.email || "Unknown";
}

/**
 * In Sent and Drafts, the "sender" is always the account's own name on
 * every row — showing it is redundant. What's actually useful there is
 * who the message is going TO. Falls back to the sender name if, for
 * whatever reason, a list item carries no recipients (e.g. an older API
 * response shape) so the row still shows something rather than going blank.
 */
function recipientSummary(item: MailListItem | MailItem): string {
  const recipients = (item.message as { recipients?: { type: string; email: string }[] }).recipients;
  const to = recipients?.filter((r) => r.type === "TO").map((r) => r.email) ?? [];
  if (to.length === 0) return senderName(item);
  return to.join(", ");
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
}: {
  item: MailListItem;
  /** Sent and Drafts show the recipient instead of the (always-you) sender.
   * Optional so any caller that hasn't been updated yet still compiles and
   * falls back to the old sender-name behavior. */
  folder?: MailListFolder;
  selected: boolean;
  checked: boolean;
  onToggleChecked: () => void;
  onSelect: () => void;
  showDeleteDraft?: boolean;
  onDeleteDraft?: () => void;
}) {
  const showRecipient = folder === "SENT" || folder === "DRAFTS";
  const name = showRecipient ? recipientSummary(item) : senderName(item);
  const label = showRecipient ? `To: ${name}` : name;

  return (
    <li className="flex items-start">
      <label
        className="flex shrink-0 cursor-pointer items-center self-stretch px-3 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleChecked}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
      </label>

      <button
        onClick={onSelect}
        className={`flex min-w-0 flex-1 items-start gap-3 px-2 py-3 pr-4 text-left transition hover:bg-[var(--s2)] ${
          selected ? "bg-[var(--s2)]" : ""
        }`}
      >
        <span
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ backgroundColor: hashColor(name) }}
        >
          {initials(name)}
        </span>

        <div className="min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            {!item.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />}
            <span className={`truncate text-sm ${item.isRead ? "text-[var(--ink2)]" : "font-semibold text-[var(--ink)]"}`}>
              {label}
            </span>
            {item.isStarred && <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--warn)] text-[var(--warn)]" />}
            <span className="ml-auto shrink-0 text-[11px] text-[var(--ink3)]">
              {fmt(item.message.sentAt || item.createdAt)}
            </span>
          </div>
          <span className={`block truncate text-sm ${item.isRead ? "text-[var(--ink3)]" : "text-[var(--ink)]"}`}>
            {item.message.subject || "(no subject)"}
          </span>
          <div className="flex items-center gap-1.5">
            {/* A flag, not the attachment list — the list endpoint returns
                has_attachments per API §9 and names the files only on the
                detail read. */}
            {item.message.hasAttachments && <Paperclip className="h-3 w-3 text-[var(--ink3)]" />}
            {item.labels.slice(0, 2).map((l) => (
              <span
                key={l.id}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${l.color}22`, color: l.color }}
              >
                {l.name}
              </span>
            ))}
          </div>
        </div>
      </button>

      {showDeleteDraft && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteDraft?.();
          }}
          title="Delete draft"
          className="mr-3 self-center rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--crit-soft)] hover:text-[var(--crit)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

/** Groups a day-sorted (newest-first) list into Today / Yesterday / date
 * buckets, in the order they should render. */
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