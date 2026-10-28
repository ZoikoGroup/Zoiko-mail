"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CalendarDays,
  Users,
  Layers,
  Inbox,
  DoorOpen,
  Link2,
  LayoutTemplate,
  Plus,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useMyMailbox } from "@/lib/mail-hooks";
import { useCalendars, useDeleteCalendar, useInvitationCounts, useUpdateCalendar } from "@/lib/calendar-hooks";
import type { Calendar } from "@/lib/calendar-api";
import { swatchStyle } from "./palette";
import { CalendarDialog } from "./CalendarDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { Spinner } from "@/components/ui/Spinner";

/** The Calendar workspace's pages, in sidebar order. */
export type CalendarPage = "my" | "team" | "shared" | "invitations" | "rooms" | "scheduling" | "templates" | "settings";

export const CALENDAR_PAGES: { key: CalendarPage; label: string; href: string; icon: LucideIcon }[] = [
  { key: "my", label: "My Calendar", href: "/mail/calendar", icon: CalendarDays },
  { key: "team", label: "Team Calendar", href: "/mail/calendar/team", icon: Users },
  { key: "shared", label: "Shared Calendars", href: "/mail/calendar/shared", icon: Layers },
  { key: "invitations", label: "Invitations & RSVP", href: "/mail/calendar/invitations", icon: Inbox },
  { key: "rooms", label: "Rooms & Resources", href: "/mail/calendar/rooms", icon: DoorOpen },
  { key: "scheduling", label: "Scheduling Links", href: "/mail/calendar/scheduling", icon: Link2 },
  { key: "templates", label: "Meeting Templates", href: "/mail/calendar/templates", icon: LayoutTemplate },
];

export const SETTINGS_PAGE = { key: "settings" as const, label: "Calendar Settings", href: "/mail/calendar/settings", icon: Settings };

const rowClass = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
    active
      ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]"
      : "text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
  }`;

function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1.5 pt-4">
      <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{children}</h2>
      {action}
    </div>
  );
}

function gb(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/**
 * The Calendar workspace's left column: create, the pages, the member's own
 * calendars (with their show/hide checkboxes), and mailbox storage — the
 * same rail anatomy as Mail's folder column.
 */
export function CalendarSidebar({
  active,
  onCreateEvent,
  section,
}: {
  active: CalendarPage;
  onCreateEvent?: () => void;
  /** A page's own list (team or shared calendars), shown in place of My calendars. */
  section?: React.ReactNode;
}) {
  const { data: calendars = [], isLoading } = useCalendars();
  const { data: mailbox, isLoading: mailboxLoading } = useMyMailbox();
  const update = useUpdateCalendar();
  const remove = useDeleteCalendar();
  const { data: counts } = useInvitationCounts();
  const [editing, setEditing] = useState<Calendar | "new" | null>(null);
  const [deleting, setDeleting] = useState<Calendar | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const storageUsed = mailbox?.storageUsed ?? 0;
  const storageLimit = mailbox?.storageLimit ?? 0;
  const storagePct = storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;

  return (
    <aside
      aria-label="Calendar"
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="relative p-3 pb-1">
        <div className="flex h-11 w-full overflow-hidden rounded-xl bg-gradient-to-r from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(47,111,237,0.7)]">
          <button
            type="button"
            onClick={() => onCreateEvent?.()}
            disabled={!onCreateEvent}
            className="flex flex-1 items-center justify-center gap-2 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white disabled:opacity-70"
          >
            <Plus className="h-4 w-4" aria-hidden /> Create event
          </button>
          <button
            type="button"
            aria-label="More to create"
            aria-expanded={createOpen}
            onClick={() => setCreateOpen((v) => !v)}
            className="flex w-10 items-center justify-center border-l border-white/25 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {createOpen && (
          <div
            role="menu"
            className="absolute left-3 right-3 top-[60px] z-30 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--sh3)]"
          >
            <button
              type="button"
              role="menuitem"
              disabled={!onCreateEvent}
              onClick={() => {
                setCreateOpen(false);
                onCreateEvent?.();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--s2)] disabled:opacity-50"
            >
              <CalendarDays className="h-4 w-4" aria-hidden /> Event
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setCreateOpen(false);
                setEditing("new");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--s2)]"
            >
              <Layers className="h-4 w-4" aria-hidden /> Calendar
            </button>
          </div>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <SectionTitle>Calendar</SectionTitle>
        <ul className="space-y-0.5">
          {CALENDAR_PAGES.map((page) => {
            const Icon = page.icon;
            const current = page.key === active;
            return (
              <li key={page.key}>
                <Link href={page.href} className={rowClass(current)} aria-current={current ? "page" : undefined}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{page.label}</span>
                  {page.key === "invitations" && (counts?.awaiting ?? 0) > 0 && (
                    <span
                      className="ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold text-white"
                      aria-label={`${counts!.awaiting} awaiting your response`}
                    >
                      {counts!.awaiting}
                    </span>
                  )}
                  {page.key === "my" && current && (
                    <span className="ml-auto rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--accent-ink)]">
                      Today
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        <SectionTitle>Preferences</SectionTitle>
        <ul className="space-y-0.5">
          <li>
            <Link href={SETTINGS_PAGE.href} className={rowClass(active === "settings")} aria-current={active === "settings" ? "page" : undefined}>
              <Settings className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{SETTINGS_PAGE.label}</span>
            </Link>
          </li>
        </ul>

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        {section ?? (
        <>
        <SectionTitle
          action={
            <button
              type="button"
              onClick={() => setEditing("new")}
              aria-label="Add a calendar"
              title="Add a calendar"
              className="rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          }
        >
          My calendars
        </SectionTitle>
        {isLoading ? (
          <Spinner size="sm" label="Loading calendars" className="px-3 py-1 text-xs" />
        ) : (
          <ul className="space-y-0.5" data-testid="my-calendars">
            {calendars.map((calendar) => (
              <li key={calendar.id} className="group flex items-center rounded-lg pr-1 hover:bg-[var(--s2)]">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-1.5 text-[13px] text-[var(--ink2)]">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={calendar.isVisible}
                    onChange={(e) => update.mutate({ id: calendar.id, input: { isVisible: e.target.checked } })}
                    aria-label={`Show ${calendar.name}`}
                  />
                  <span
                    aria-hidden
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]"
                    style={calendar.isVisible ? swatchStyle(calendar.color) : { borderColor: "var(--bstrong, var(--border))" }}
                  >
                    {calendar.isVisible && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{calendar.name}</span>
                </label>
                <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <DropdownMenu
                    trigger={<MoreHorizontal className="h-4 w-4" aria-label={`Options for ${calendar.name}`} />}
                  >
                    <DropdownItem onClick={() => setEditing(calendar)}>
                      <span className="flex items-center gap-2">
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Rename or recolour
                      </span>
                    </DropdownItem>
                    {!calendar.isDefault && (
                      <DropdownItem danger onClick={() => setDeleting(calendar)}>
                        <span className="flex items-center gap-2">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
                        </span>
                      </DropdownItem>
                    )}
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
        </>
        )}
      </nav>

      <Link href="/mail/storage" aria-label="Mailbox storage details" className="m-3 block rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3 transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-[var(--ink)]">Mailbox storage</span>
          <span className="font-mono-num text-[var(--ink2)]">
            {mailboxLoading ? "…" : `${gb(storageUsed)} / ${gb(storageLimit)} GB`}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s3,var(--border))]">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${storagePct}%` }} />
        </div>
      </Link>

      {editing && (
        <CalendarDialog calendar={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSettled: () => setDeleting(null) });
        }}
        title={`Delete ${deleting?.name ?? "calendar"}?`}
        message="The calendar and every event in it are deleted. This cannot be undone."
        confirmLabel="Delete calendar"
        loading={remove.isPending}
      />
    </aside>
  );
}
