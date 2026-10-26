"use client";

import Link from "next/link";
import {
  Mail, CalendarDays, CheckSquare, UserRound, Network, Sparkles, HelpCircle, type LucideIcon,
} from "lucide-react";

/** The Member workspace's sections. Every section in the rail is built; only the Help centre shows Coming Soon. */
export type WorkspaceSection = "mail" | "calendar" | "tasks" | "contacts" | "work-graph" | "alet" | "help";

export interface SectionInfo {
  key: WorkspaceSection;
  label: string;
  href: string;
  icon: LucideIcon;
  /** What it will do, for its Coming Soon page. */
  description: string;
}

export const SECTIONS: SectionInfo[] = [
  { key: "mail", label: "Mail", href: "/mail", icon: Mail, description: "" },
  {
    key: "calendar",
    label: "Calendar",
    href: "/mail/calendar",
    icon: CalendarDays,
    description: "Your meetings and schedule beside your mail, with invitations you can answer in one place.",
  },
  {
    key: "tasks",
    label: "Tasks",
    href: "/mail/tasks",
    icon: CheckSquare,
    description: "Turn emails into tasks, track what you owe and what others owe you, and never lose a follow-up.",
  },
  {
    key: "contacts",
    label: "Contacts",
    href: "/mail/contacts",
    icon: UserRound,
    description: "Everyone you work with, their details and your shared conversations, in one directory.",
  },
  {
    key: "work-graph",
    label: "Work Graph",
    href: "/mail/work-graph",
    icon: Network,
    description: "See how commitments, decisions and the mail and meetings behind them connect across your workspace.",
  },
  {
    key: "alet",
    label: "Alet",
    href: "/mail/alet",
    icon: Sparkles,
    description: "Alet, your AI assistant: summaries, suggested replies and the actions hidden in your inbox.",
  },
];

/** Reached from the help button at the foot of the rail, not listed in it. */
export const HELP_SECTION: SectionInfo = {
  key: "help",
  label: "Help centre",
  href: "/mail/help",
  icon: HelpCircle,
  description: "Guides and answers for Zoiko Mail. Until it opens, your workspace administrator can help.",
};

export function sectionInfo(key: WorkspaceSection): SectionInfo {
  if (key === "help") return HELP_SECTION;
  return SECTIONS.find((section) => section.key === key) ?? SECTIONS[0];
}

/** The narrow column of workspace sections on the far left (desktop). */
export function AppRail({ active }: { active: WorkspaceSection }) {
  return (
    <nav
      aria-label="Workspace sections"
      className="flex h-full w-[76px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--zm-rail)] py-3"
    >
      {SECTIONS.map((section) => {
        const Icon = section.icon;
        const current = section.key === active;
        return (
          <Link
            key={section.key}
            href={section.href}
            aria-current={current ? "page" : undefined}
            className={`flex w-[64px] flex-col items-center gap-1 whitespace-nowrap rounded-xl px-0 py-2.5 text-center text-[11px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              current
                ? "bg-[var(--accent-soft)] font-medium text-[var(--ink)] ring-1 ring-inset ring-[var(--accent)]/40"
                : "text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
            }`}
          >
            <span
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
                current ? "bg-[var(--accent)] text-white" : ""
              }`}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            {section.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <Link
        href={HELP_SECTION.href}
        aria-current={active === "help" ? "page" : undefined}
        className="rounded-full p-2 text-[var(--ink3)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label="Help and support"
        title="Help and support"
      >
        <HelpCircle className="h-5 w-5" aria-hidden />
      </Link>
    </nav>
  );
}
