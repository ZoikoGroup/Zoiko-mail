"use client";

import { Menu, Search, X } from "lucide-react";
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
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-white">
          {initials(displayName, accountEmail)}
        </span>
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
