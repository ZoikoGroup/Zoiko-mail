"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { TasksSidebar, type TasksPageKey } from "./TasksSidebar";

/**
 * Every Tasks page: the Member shell (top bar, section rail) with the Tasks
 * sidebar beside the page — the same frame the Calendar pages use.
 */
export function TasksWorkspace({
  active,
  activeTeamId,
  onNewTask,
  children,
}: {
  active: TasksPageKey;
  activeTeamId?: string;
  onNewTask: () => void;
  children: ReactNode;
}) {
  return (
    <WebmailShell section="tasks">
      <div className="flex h-full min-h-0">
        <div className="hidden lg:block">
          <TasksSidebar active={active} activeTeamId={activeTeamId} onNewTask={onNewTask} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-5 lg:px-6">{children}</div>
      </div>
    </WebmailShell>
  );
}

/** Icon tile, title, subtitle and the page's actions. */
export function TasksPageHeader({
  icon: Icon,
  title,
  subtitle,
  tone = "accent",
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tone?: "accent" | "crit" | "ok";
  actions?: ReactNode;
}) {
  const toneClass = tone === "crit" ? "bg-[var(--crit-soft)] text-[var(--crit)]" : tone === "ok" ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "bg-[var(--accent-soft)] text-[var(--accent-ink)]";
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] ${toneClass}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)]">{title}</h1>
          <p className="mt-1 text-[13px] text-[var(--ink2)]">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type CardTone = "accent" | "warn" | "crit" | "ok" | "ai";

const CARD_TONE: Record<CardTone, string> = {
  accent: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
  crit: "bg-[var(--crit-soft)] text-[var(--crit)]",
  ok: "bg-[var(--ok-soft)] text-[var(--ok)]",
  ai: "bg-[var(--ai-soft)] text-[var(--ai)]",
};

export interface SummaryCard {
  icon: LucideIcon;
  tone: CardTone;
  value: number | null;
  label: string;
  hint: string;
  /** Shown in place of a number for a card whose data arrives later. */
  soon?: boolean;
}

/** The three figures across the top of each page. */
export function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="task-summary-card">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${CARD_TONE[card.tone]}`}>
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              {card.soon ? (
                <span className="inline-block rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">Soon</span>
              ) : (
                <div className="font-mono-num text-[24px] font-bold leading-none text-[var(--ink)]">{card.value ?? "–"}</div>
              )}
              <div className="mt-1.5 text-[13px] font-semibold text-[var(--ink)]">{card.label}</div>
              <div className="truncate text-[12px] text-[var(--ink3)]">{card.hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
