"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, X, Settings, LogOut, ChevronDown, Bell, Sparkles, UserRound } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { initials } from "@/lib/useMemberShell";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/lib/admin-hooks";

/** Closes a popover on an outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/**
 * The webmail top bar: brand, the workspace this session is in, search
 * (Ctrl/⌘+K focuses it), Alet, notifications, settings and the account menu.
 *
 * Search text is lifted to the page, which hands it to MailClient's operator
 * parser — "from:hr has:attachment" works here as it always has.
 */
export function TopBar({
  query,
  onQueryChange,
  accountEmail,
  displayName,
  workspaceName,
  onSignOut,
  signingOut = false,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  accountEmail?: string;
  displayName?: string;
  workspaceName?: string;
  onSignOut: () => void;
  signingOut?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useDismiss(menuOpen, () => setMenuOpen(false));
  const bellRef = useDismiss(bellOpen, () => setBellOpen(false));
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: notifications } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = (notifications ?? []).filter((n) => !n.readAt);

  // Ctrl+K / ⌘+K focuses search, as the hint in the box says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const iconButton =
    "relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink2)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

  return (
    <header className="flex h-[68px] items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5">
      <Link
        href="/mail"
        aria-label="Zoiko Mail — Inbox"
        className="flex h-11 shrink-0 items-center rounded-xl bg-white px-4 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Image src="/zoiko-wordmark.png" width={2111} height={274} className="h-5 w-auto" alt="Zoiko Mail" priority />
      </Link>

      {workspaceName && (
        <div
          className="hidden h-11 min-w-0 max-w-[230px] shrink-0 items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--s2)] px-3 xl:flex"
          title={`Workspace: ${workspaceName}`}
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
            {workspaceName.trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{workspaceName}</span>
            <span className="block text-[11px] text-[var(--ink3)]">Business mail</span>
          </span>
        </div>
      )}

      <div className="relative mx-auto w-full max-w-xl flex-1">
        <label htmlFor="mail-search" className="sr-only">
          Search mail
        </label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
        <input
          id="mail-search"
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search mail — try from:hr has:attachment"
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--ground)] pl-10 pr-20 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
        />
        {query ? (
          <button
            onClick={() => onQueryChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--ink3)] hover:text-[var(--ink)]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] px-1.5 py-0.5 font-sans text-[11px] text-[var(--ink3)]">
            Ctrl K
          </kbd>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href="/mail/alet"
          className="hidden h-10 items-center gap-2 rounded-xl border border-[var(--accent)]/50 bg-[var(--accent-soft)] px-3.5 text-[13px] font-semibold text-[var(--accent-ink)] transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] xl:inline-flex"
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Alet AI
        </Link>

        <ThemeToggle />

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            className={iconButton}
            aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
            aria-expanded={bellOpen}
            aria-haspopup="dialog"
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden />
            {unread.length > 0 && (
              <span
                className="absolute right-1 top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-[var(--crit)] px-1 text-[10px] font-bold leading-4 text-white"
                data-testid="notification-count"
              >
                {unread.length > 9 ? "9+" : unread.length}
              </span>
            )}
          </button>
          {bellOpen && (
            <div
              role="dialog"
              aria-label="Notifications"
              className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
                <span className="text-sm font-semibold text-[var(--ink)]">Notifications</span>
                {unread.length > 0 && (
                  <button
                    type="button"
                    onClick={() => markAll.mutate(unread.map((n) => n.id))}
                    disabled={markAll.isPending}
                    className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-60"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <ul className="max-h-80 overflow-y-auto">
                {(notifications ?? []).length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-[var(--ink3)]">You&rsquo;re all caught up.</li>
                ) : (
                  (notifications ?? []).slice(0, 20).map((n) => (
                    <li key={n.id} className="border-b border-[var(--border)] last:border-0">
                      <button
                        type="button"
                        onClick={() => !n.readAt && markRead.mutate(n.id)}
                        className="flex w-full gap-2.5 px-4 py-3 text-left transition hover:bg-[var(--s2)]"
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-[var(--accent)]"}`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[13px] ${n.readAt ? "text-[var(--ink2)]" : "font-semibold text-[var(--ink)]"}`}>
                            {n.title}
                          </span>
                          {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--ink3)]">{n.body}</span>}
                          <span className="mt-1 block text-[11px] text-[var(--ink3)]">{n.ago}</span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        <Link href="/settings" className={iconButton} aria-label="Settings" title="Settings">
          <Settings className="h-[18px] w-[18px]" aria-hidden />
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded-xl px-1 py-1 transition hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Account menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
              {initials(displayName, accountEmail)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--ink3)]" aria-hidden />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-2 w-60 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--sh3)]"
            >
              <div className="border-b border-[var(--border)] px-4 py-2.5">
                {displayName && <div className="truncate text-sm font-semibold text-[var(--ink)]">{displayName}</div>}
                <div className="truncate text-xs text-[var(--ink3)]">{accountEmail ?? "…"}</div>
              </div>
              <Link
                role="menuitem"
                href="/account"
                className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--ink2)] hover:bg-[var(--s2)]"
                onClick={() => setMenuOpen(false)}
              >
                <UserRound className="h-3.5 w-3.5" aria-hidden /> Profile
              </Link>
              <button
                role="menuitem"
                onClick={onSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[var(--ink2)] hover:bg-[var(--s2)] disabled:opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
