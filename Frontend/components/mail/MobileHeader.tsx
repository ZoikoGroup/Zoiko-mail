"use client";

import { Menu, Search, X } from "lucide-react";
import { initials } from "@/lib/useMemberShell";

/**
 * Replaces TopBar on mobile (< lg). TopBar's logo + settings + account menu
 * don't fit a phone header; this is the hamburger-title-avatar pattern from
 * the design instead, with the search box as its own row underneath.
 * MailClient's own "List tabs" row (All/Unread/Starred + label chips on
 * mobile) renders directly below this — that part needed no new component,
 * see MailClient's own comment on why.
 */
export function MobileHeader({
  folderLabel,
  onOpenDrawer,
  accountEmail,
  query,
  onQueryChange,
}: {
  folderLabel: string;
  onOpenDrawer: () => void;
  accountEmail?: string;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <button
          onClick={onOpenDrawer}
          className="rounded-md p-1.5 text-[var(--ink2)] hover:bg-[var(--s2)]"
          aria-label="Open folders"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="flex-1 truncate text-base font-medium text-[var(--ink)]">{folderLabel}</h1>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-white">
          {initials(undefined, accountEmail)}
        </span>
      </div>

      <div className="relative border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search mail"
          className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] pl-8 pr-8 text-sm outline-none focus:border-[var(--accent)]"
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
    </div>
  );
}