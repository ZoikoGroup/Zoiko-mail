"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AtSign,
  CalendarDays,
  CheckCheck,
  CheckSquare,
  Clock,
  Flag,
  Mail,
  Plus,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useMyMailbox } from "@/lib/mail-hooks";
import { useTaskSummary } from "@/lib/tasks-hooks";
import type { TaskSummary } from "@/lib/tasks-api";

/** The Tasks workspace's pages, in sidebar order. */
export type TasksPageKey = "my" | "today" | "upcoming" | "overdue" | "completed" | "from-email" | "assigned";

type CountKey = keyof TaskSummary["counts"];

interface NavItem {
  key: TasksPageKey;
  label: string;
  href: string;
  icon: LucideIcon;
  count?: CountKey;
  /** Overdue counts are a warning, not a tally. */
  alert?: boolean;
}

export const TASK_PAGES: NavItem[] = [
  { key: "my", label: "My Tasks", href: "/mail/tasks", icon: CheckSquare, count: "open" },
  { key: "today", label: "Today", href: "/mail/tasks/today", icon: Clock, count: "dueToday" },
  { key: "upcoming", label: "Upcoming", href: "/mail/tasks/upcoming", icon: CalendarDays },
  { key: "overdue", label: "Overdue", href: "/mail/tasks/overdue", icon: Flag, count: "overdue", alert: true },
  { key: "completed", label: "Completed", href: "/mail/tasks/completed", icon: CheckCheck },
];

export const MY_WORK_PAGES: NavItem[] = [
  { key: "from-email", label: "From Emails", href: "/mail/tasks/from-email", icon: Mail, count: "fromEmail" },
  { key: "assigned", label: "Assigned to Me", href: "/mail/tasks/assigned", icon: AtSign, count: "assigned" },
];

const rowClass = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
    active
      ? "bg-[var(--zm-selected)] font-semibold text-[var(--ink)] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--accent)]"
      : "text-[var(--ink2)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
  }`;

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="px-3 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">{children}</h2>;
}

function Count({ value, alert }: { value: number; alert?: boolean }) {
  if (value <= 0) return null;
  return (
    <span
      className={`ml-auto inline-flex min-w-[22px] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        alert ? "bg-[var(--crit-soft)] text-[var(--crit)]" : "bg-[var(--s3)] text-[var(--ink2)]"
      }`}
    >
      {value}
    </span>
  );
}

/** A menu entry that is in the design but arrives in a later phase. */
function SoonRow({ icon: Icon, label, hint }: { icon: LucideIcon; label: string; hint: string }) {
  return (
    <div aria-disabled="true" title={hint} className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] text-[var(--ink3)]">
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
      <span className="ml-auto rounded-full border border-[var(--border)] px-1.5 text-[9.5px] font-semibold uppercase tracking-wide">Soon</span>
    </div>
  );
}

function NavList({ items, active, summary }: { items: NavItem[]; active: TasksPageKey; summary?: TaskSummary }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const current = item.key === active;
        return (
          <li key={item.key}>
            <Link href={item.href} className={rowClass(current)} aria-current={current ? "page" : undefined}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              {item.count && summary && <Count value={summary.counts[item.count]} alert={item.alert} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function gb(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** The Tasks workspace's left column: create, the views with their counts, and mailbox storage. */
export function TasksSidebar({ active, onNewTask }: { active: TasksPageKey; onNewTask: () => void }) {
  const { data: summary } = useTaskSummary();
  const { data: mailbox, isLoading: mailboxLoading } = useMyMailbox();
  const storageUsed = mailbox?.storageUsed ?? 0;
  const storageLimit = mailbox?.storageLimit ?? 0;
  const storagePct = storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0;

  return (
    <aside aria-label="Tasks" className="flex h-full w-[240px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
      <div className="p-3 pb-1">
        <button
          type="button"
          onClick={onNewTask}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--zm-compose-from)] to-[var(--zm-compose-to)] text-[14px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(47,111,237,0.7)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Plus className="h-4 w-4" aria-hidden /> New Task
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <SectionTitle>Tasks</SectionTitle>
        <NavList items={TASK_PAGES} active={active} summary={summary} />

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        <SectionTitle>My work</SectionTitle>
        <NavList items={MY_WORK_PAGES} active={active} summary={summary} />
        <SoonRow icon={Sparkles} label="Following" hint="Following arrives in a later update" />

        <div className="mx-3 mt-3 border-t border-[var(--border)]" />
        <SectionTitle>Team workspaces</SectionTitle>
        <SoonRow icon={Users} label="Team workspaces" hint="Shared team task lists arrive in a later update" />
      </nav>

      <div className="m-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-semibold text-[var(--ink)]">Mailbox storage</span>
          <span className="font-mono-num text-[var(--ink2)]">{mailboxLoading ? "…" : `${gb(storageUsed)} / ${gb(storageLimit)} GB`}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s3,var(--border))]">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${storagePct}%` }} />
        </div>
      </div>
    </aside>
  );
}
