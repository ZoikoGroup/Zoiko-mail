"use client";

import Link from "next/link";
import { SECTIONS, type WorkspaceSection } from "@/components/mail/AppRail";

/**
 * The phone's version of the desktop section rail (AppRail): the workspace's
 * sections along the bottom. Folders live in the header's drawer instead.
 * Work Graph is left to the desktop rail; five tabs is what fits a phone.
 */
export function BottomNav({ active }: { active: WorkspaceSection }) {
  const items = SECTIONS.filter((section) => section.key !== "work-graph");
  return (
    <nav
      aria-label="Workspace sections"
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-[var(--border)] bg-[var(--surface)] lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const current = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] focus:outline-none focus-visible:bg-[var(--s2)] ${
              current ? "font-medium text-[var(--accent)]" : "text-[var(--ink3)]"
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
