"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { isLoggedIn } from "@/lib/auth-storage";
import { useMe, useLogout } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { OwnerSidebar } from "./OwnerSidebar";
import { GlobalSearch } from "./GlobalSearch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AccessDenied } from "@/components/ui/AccessDenied";

/** Roles allowed into the owner workspace shell. */
const OWNER_SHELL_ROLES = ["OWNER", "ADMIN"];

function initials(name?: string, email?: string) {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}

export function OwnerShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading, error } = useMe();
  const me = data as MeResponse | undefined;
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
  }, [router]);

  // Redirect to login if /auth/me fails (expired/invalid token)
  useEffect(() => {
    if (!isLoading && error && isLoggedIn()) {
      router.replace("/login");
    }
  }, [isLoading, error, router]);

  // Role guard: non-owner/admin roles get a warning instead of the
  // owner workspace chrome (individual pages guard themselves too).
  if (me && !OWNER_SHELL_ROLES.includes(me.membership.role)) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--ground)] text-[var(--ink)]">
        <AccessDenied role={me.membership.role} dashboard="owner" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] md:flex">
        <OwnerSidebar role={me?.membership.role} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
            <div className="flex justify-end p-2">
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <OwnerSidebar onNavigate={() => setMobileOpen(false)} role={me?.membership.role} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-[var(--ink2)] hover:bg-[var(--s2)] md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <GlobalSearch className="hidden max-w-xs sm:block" />
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />

            {me && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
                  {initials(me.displayName, me.email)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">{me.displayName}</div>
                  <div className="truncate text-[10px] text-[var(--ink3)]">{me.membership.role}</div>
                </div>
              </div>
            )}

            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="zoiko-btn sm"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{logout.isPending ? "…" : "Log out"}</span>
            </button>
          </div>
        </header>

        {/* Keyed by pathname: fades the page in on navigation (see .page-enter CSS). */}
        <main key={pathname} className="page-enter flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
