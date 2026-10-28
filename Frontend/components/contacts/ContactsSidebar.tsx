"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  Users,
  Star,
  Building2,
  Tags,
  UserRound,
  UsersRound,
  AtSign,
  ArrowDownUp,
  CopyCheck,
  Plus,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useMyMailbox } from "@/lib/mail-hooks";
import type { ContactSummary } from "@/lib/contacts-api";

/** The Contacts workspace's lists and tools. `mine` is a tab, not a sidebar row. */
export type ContactsView =
  | "all"
  | "mine"
  | "favorites"
  | "directory"
  | "groups"
  | "personal"
  | "shared"
  | "other"
  | "import"
  | "duplicates";

export const CONTACTS_VIEWS: ContactsView[] = [
  "all", "mine", "favorites", "directory", "groups", "personal", "shared", "other", "import", "duplicates",
];

interface Row {
  view: ContactsView;
  label: string;
  icon: LucideIcon;
  count?: (s: ContactSummary) => number;
}

const MAIN: Row[] = [
  { view: "all", label: "All Contacts", icon: Users, count: (s) => s.all },
  { view: "favorites", label: "Favourites", icon: Star, count: (s) => s.favorites },
  { view: "directory", label: "Organization Directory", icon: Building2, count: (s) => s.directory },
  { view: "groups", label: "Contact Groups", icon: Tags, count: (s) => s.groups.length },
];
const ORGANISE: Row[] = [
  { view: "personal", label: "Personal Contacts", icon: UserRound, count: (s) => s.personal },
  { view: "shared", label: "Shared Contacts", icon: UsersRound, count: (s) => s.shared },
  { view: "other", label: "Other Contacts", icon: AtSign },
];
const TOOLS: Row[] = [
  { view: "import", label: "Import & Export", icon: ArrowDownUp },
  { view: "duplicates", label: "Review Duplicates", icon: CopyCheck },
];

export const VIEW_LABEL: Record<ContactsView, string> = {
  all: "All Contacts",
  mine: "My Contacts",
  favorites: "Favourites",
  directory: "Organization Directory",
  groups: "Contact Groups",
  personal: "Personal Contacts",
  shared: "Shared Contacts",
  other: "Other Contacts",
  import: "Import & Export",
  duplicates: "Review Duplicates",
};

export const viewHref = (view: ContactsView) => (view === "all" ? "/mail/contacts" : `/mail/contacts?view=${view}`);

const rowClass = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
    active
      ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]"
      : "text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
  }`;

function Section({ title, children, collapsible }: { title: string; children: ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div className="mx-3 mt-3 border-t border-[var(--border)]" />
      <div className="flex items-center justify-between px-3 pb-1.5 pt-4">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{title}</h2>
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
            className="rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "" : "-rotate-90"}`} aria-hidden />
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
}

function gb(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** The Contacts workspace's left column: create, the lists, the tools and mailbox storage. */
export function ContactsSidebar({
  active,
  summary,
  onNewContact,
}: {
  active: ContactsView;
  summary: ContactSummary | undefined;
  onNewContact: () => void;
}) {
  const { data: mailbox, isLoading: mailboxLoading } = useMyMailbox();
  const storageUsed = mailbox?.storageUsed ?? 0;
  const storageLimit = mailbox?.storageLimit ?? 0;
  const storagePct = storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;
  // "All Contacts" stays lit on its My Contacts tab.
  const lit = active === "mine" ? "all" : active;

  const list = (rows: Row[]) => (
    <ul className="space-y-0.5">
      {rows.map((row) => {
        const Icon = row.icon;
        const current = row.view === lit;
        const count = summary && row.count ? row.count(summary) : undefined;
        return (
          <li key={row.view}>
            <Link href={viewHref(row.view)} className={rowClass(current)} aria-current={current ? "page" : undefined}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{row.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={`ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                    current ? "bg-[var(--accent)] text-white" : "bg-[var(--s2)] text-[var(--ink3)]"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside
      aria-label="Contacts"
      className="flex h-full w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="p-3 pb-1">
        <button
          type="button"
          onClick={onNewContact}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(47,111,237,0.7)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden /> New Contact
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-3 pb-1.5 pt-4">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Contacts</h2>
        </div>
        {list(MAIN)}
        <Section title="Organise" collapsible>
          {list(ORGANISE)}
        </Section>
        <Section title="Tools" collapsible>
          {list(TOOLS)}
        </Section>
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
    </aside>
  );
}
