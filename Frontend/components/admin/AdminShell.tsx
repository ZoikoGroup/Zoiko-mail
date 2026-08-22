"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { isLoggedIn } from "@/lib/auth-storage";
import { useMe, useLogout } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useCan, useCapabilities } from "@/lib/admin-capabilities";
import { visibleNav, type AdminNavItem } from "@/lib/admin-nav";
import { useActiveSupportGrant } from "@/lib/admin-hooks";
import { Pill } from "@/components/admin/ui";

function initials(name?: string, email?: string) {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data } = useMe();
  const me = data as MeResponse | undefined;
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Same auth guard the member shell uses.
  useEffect(() => {
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--s2)] md:flex">
        <Rail />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-[232px] flex-col border-r border-[var(--border)] bg-[var(--s2)]">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s3)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Rail onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-[var(--ink2)] hover:bg-[var(--s2)] md:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <span className="truncate text-sm text-[var(--ink3)]">
              {me ? me.tenant.name : "Zoiko Mail"}
            </span>
            <span className="font-mono-num ml-2 text-[9px] uppercase tracking-[0.11em] text-[var(--ink3)]">
              Admin workspace
            </span>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            {me && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ai)] text-xs font-semibold text-white">
                  {initials(me.displayName, me.email)}
                </span>
                <span className="text-sm text-[var(--ink2)]">{me.displayName}</span>
              </div>
            )}
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--s2)] disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{logout.isPending ? "…" : "Log out"}</span>
            </button>
          </div>
        </header>

        <SupportGrantBanner />

        <main className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * Shown whenever Zoiko staff hold access. The matrix grants
 * `support.grant.end` to Admin, so ending the session is an Admin action.
 */
function SupportGrantBanner() {
  const can = useCan();
  const { data: grant } = useActiveSupportGrant();
  const [dismissed, setDismissed] = useState(false);

  if (!grant || dismissed) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--warn-soft)] px-4 py-2 text-[12px] font-semibold text-[var(--warn)] sm:px-6">
      <Pill tone="warn">● Support grant · {grant.ticket}</Pill>
      <span className="font-normal">
        {grant.holderName} · {grant.scopeLabel} · approved by {grant.approvedByName}
      </span>
      <span className="font-mono-num ml-auto">{grant.expiresInLabel}</span>
      {can("support.grant.end") && (
        <button type="button" onClick={() => setDismissed(true)} className="zoiko-btn crit sm">
          End session
        </button>
      )}
    </div>
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();
  const { isLoading, error } = useCapabilities();
  const groups = visibleNav(can);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] font-bold text-white">
          Z
        </div>
        <span className="font-editorial text-lg font-semibold text-[var(--ink)]">Zoiko Mail</span>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-4" aria-label="Admin sections">
        {/* Capabilities decide what belongs here, and `can` denies while the
            query is in flight — deliberately, so nothing the server would
            refuse ever renders. Without a placeholder that correctness shows
            up as an empty rail on every load, so show its shape instead. */}
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="mx-3 my-2 h-4 animate-pulse rounded bg-[var(--s3)]" />
          ))}

        {/* Failing closed is right, but it must never look like the workspace
            lost its features. If permissions cannot be loaded, say so — an
            unexplained empty rail reads as data loss, not as a failed fetch. */}
        {!isLoading && error && (
          <div className="mx-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-3">
            <div className="text-[12px] font-semibold text-[var(--crit)]">
              Permissions unavailable
            </div>
            <p className="mt-1 text-[11px] text-[var(--ink3)]">
              Navigation is hidden until your permissions load. This is a
              connection problem, not a change to your access.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="zoiko-btn sm mt-2"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && groups.map((group) => (
          <div key={group.group}>
            <div className="font-mono-num px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--ink3)]">
              {group.group}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <RailRow
                  key={`${group.group}-${item.label}`}
                  item={item}
                  active={pathname === item.href}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}

function RailRow({
  item,
  active,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const base = "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] transition";

  const badge = item.count !== undefined && (
    <span
      className={`font-mono-num ml-auto rounded-full px-1.5 py-px text-[9.5px] ${
        item.attention
          ? "bg-[var(--warn-soft)] text-[var(--warn)]"
          : active
            ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
            : "bg-[var(--s3)] text-[var(--ink3)]"
      }`}
    >
      {item.count}
    </span>
  );

  if (item.soon) {
    return (
      <div className={`${base} cursor-default text-[var(--ink3)]`}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">{item.label}</span>
        <span className="zoiko-pill nu">Soon</span>
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`${base} ${
        active
          ? "bg-[var(--surface)] font-semibold text-[var(--ink)] shadow-[inset_2px_0_0_0_var(--accent)]"
          : "text-[var(--ink2)] hover:bg-[var(--s3)] hover:text-[var(--ink)]"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {badge}
    </Link>
  );
}
