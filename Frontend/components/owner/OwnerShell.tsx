"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useWorkspaceAccess } from "@/lib/workspace-access";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { OwnerSidebar } from "./OwnerSidebar";
import { GlobalSearch } from "./GlobalSearch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ProfileMenu } from "@/components/shell/ProfileMenu";
import { AccessDenied } from "@/components/ui/AccessDenied";

/**
 * The owner workspace admits sessions opened for the owner workspace only.
 *
 * This was ["OWNER", "ADMIN"], and that was the bypass: an Admin who signed
 * into the admin console could type /owner and this shell rendered, because
 * an Admin is on the list. A session now has to have been opened for this
 * console, which an admin sign-in never is.
 */
const OWNER_WORKSPACE = "OWNER" as const;

export function OwnerShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading, error } = useMe();
  const me = data as MeResponse | undefined;
  const [mobileOpen, setMobileOpen] = useState(false);

  // Fail closed: nothing renders until the role is known and permitted.
  // This replaces three separate checks -- an isLoggedIn effect, a /auth/me
  // error effect, and `me && !ALLOWED.includes(...)` -- the last of which
  // skipped itself while useMe() was in flight and let the console render.
  const access = useWorkspaceAccess(OWNER_WORKSPACE);
  if (access !== "allowed") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--ground)]">
        <span className="text-sm text-[var(--ink3)]">Checking access…</span>
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
          <aside className="zoi-drawer absolute left-0 top-0 flex h-full w-64 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
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

          {/* Tenant first and weighted, workspace second and quiet */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-sm font-medium text-[var(--ink2)]">
              {me?.tenant.name ?? ""}
            </span>
            <span className="font-mono-num shrink-0 text-[9px] uppercase tracking-[0.11em] text-[var(--ink3)]">
              Owner workspace
            </span>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            {/*
              Avatar, identity and sign-out in one menu, the same one the
              admin console uses: the address sits on the trigger so the
              signed-in account is visible without opening anything, and
              Profile plus Log out live inside it.
            */}
            <ProfileMenu profileHref="/owner/profile" showEmail />
          </div>
        </header>

        {/* Keyed by pathname: fades the page in on navigation (see .page-enter CSS). */}
        <main key={pathname} className="page-enter flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
