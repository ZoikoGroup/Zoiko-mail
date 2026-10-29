"use client";

import Link from "next/link";
import { Menu, Search, Settings, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { initials } from "@/lib/useMemberShell";

/**
 * Replaces TopBar on phones (< lg): the drawer button, what is being shown,
 * the account avatar, and — in Mail — the search box as its own row.
 */
export function MobileHeader({
  title,
  onOpenDrawer,
  accountEmail,
  displayName,
  query,
  onQueryChange,
  showSearch = true,
}: {
  title: string;
  /** Omitted where there is no folder drawer (the Coming Soon sections). */
  onOpenDrawer?: () => void;
  accountEmail?: string;
  displayName?: string;
  query: string;
  onQueryChange: (value: string) => void;
  showSearch?: boolean;
}) {
  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        {onOpenDrawer && (
          <button
            onClick={onOpenDrawer}
            className="rounded-md p-1.5 text-[var(--ink2)] hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Open folders"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <h1 className="flex-1 truncate text-base font-semibold text-[var(--ink)]">{title}</h1>
        {/* The desktop top bar has these; on a phone they live here. */}
        <ThemeToggle />
        <Link
          href="/mail/settings"
          aria-label="Settings"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink2)] hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </Link>
        <Link
          href="/mail/settings/profile"
          aria-label="Profile"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
        >
          {initials(displayName, accountEmail)}
        </Link>
      </div>

      {showSearch && (
        <div className="relative border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <label htmlFor="mail-search-mobile" className="sr-only">
            Search mail
          </label>
          <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
          <input
            id="mail-search-mobile"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search mail"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] pl-8 pr-8 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
          />
          {query && (
            <button
              onClick={() => onQueryChange("")}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink)]"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
