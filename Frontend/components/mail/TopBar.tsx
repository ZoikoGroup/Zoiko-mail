"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, X, Settings, LogOut, ChevronDown } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { initials } from "@/lib/useMemberShell";

/**
 * The webmail top bar. Search is a plain text box for now — the
 * "from:/has:attachment" operator parsing promised for Screen 1 is a
 * Step 3 item (it needs to feed MailClient's existing from/hasAttachment
 * filter params, which live in the list/row rebuild, not here).
 */
export function TopBar({
  query,
  onQueryChange,
  accountEmail,
  onSignOut,
  signingOut = false,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  accountEmail?: string;
  onSignOut: () => void;
  signingOut?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
      <Image
        src="/ZoikoMail_Logo_DarkBG_PNG.png"
        width={300}
        height={120}
        className="h-7 w-auto shrink-0"
        alt="Zoiko Mail"
        priority
      />

      <div className="relative mx-auto w-full max-w-xl flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search mail — try from:hr has:attachment"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] py-2 pl-9 pr-9 text-sm outline-none focus:border-[var(--accent)]"
        />
        {query && (
          <button
            onClick={() => onQueryChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink)]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <Link
          href="/settings"
          className="rounded-md p-2 text-[var(--ink2)] hover:bg-[var(--s2)]"
          aria-label="Settings"
        >
          <Settings className="h-4.5 w-4.5" />
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-[var(--s2)]"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
              {initials(undefined, accountEmail)}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[var(--ink3)]" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--sh2)]">
              <div className="truncate border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--ink3)]">
                {accountEmail ?? "…"}
              </div>
              <Link
                href="/account"
                className="block px-3 py-2 text-sm text-[var(--ink2)] hover:bg-[var(--s2)]"
                onClick={() => setMenuOpen(false)}
              >
                Profile
              </Link>
              <Link
                href="/contacts"
                className="block px-3 py-2 text-sm text-[var(--ink2)] hover:bg-[var(--s2)]"
                onClick={() => setMenuOpen(false)}
              >
                Contacts
              </Link>
              <button
                onClick={onSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ink2)] hover:bg-[var(--s2)] disabled:opacity-60"
              >
                <LogOut className="h-3.5 w-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}