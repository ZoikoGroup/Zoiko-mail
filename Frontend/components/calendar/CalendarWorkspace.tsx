"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { CalendarSidebar, type CalendarPage } from "./CalendarSidebar";

/**
 * Every Calendar page: the Member shell (top bar, section rail) with the
 * Calendar sidebar beside the page. Pages supply their header and body.
 */
export function CalendarWorkspace({
  active,
  onCreateEvent,
  sidebarSection,
  children,
}: {
  active: CalendarPage;
  onCreateEvent?: () => void;
  /** Replaces the sidebar's "My calendars" list on pages with their own. */
  sidebarSection?: ReactNode;
  children: ReactNode;
}) {
  return (
    <WebmailShell section="calendar">
      <div className="flex h-full min-h-0">
        <div className="hidden lg:block">
          <CalendarSidebar active={active} onCreateEvent={onCreateEvent} section={sidebarSection} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-5 lg:px-6">{children}</div>
      </div>
    </WebmailShell>
  );
}

/** "CALENDAR / MEMBER WORKSPACE", the icon tile, title, subtitle and the page's actions. */
export function CalendarPageHeader({
  icon: Icon,
  title,
  subtitle,
  eyebrow = "Calendar / Member workspace",
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-ink)]">{eyebrow}</p>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--s2)] text-[var(--accent-ink)]">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-[28px]">{title}</h1>
        </div>
        <p className="mt-2 text-[13.5px] text-[var(--ink2)]">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
