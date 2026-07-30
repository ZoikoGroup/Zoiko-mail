"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { isLoggedIn } from "@/lib/auth-storage";
import { useMe, useLogout } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { DASHBOARD_ITEM, NAV, SECTIONS } from "@/lib/nav";

function initials(name?: string, email?: string) {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data } = useMe();
  const me = data as MeResponse | undefined;
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth guard for every page that uses the shell.
  useEffect(() => {
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-slate-200 bg-white">
            <div className="flex justify-end p-2">
              <button onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <span className="truncate text-sm text-slate-500">
              {me ? me.tenant.name : "Zoiko Mail"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {me && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white">
                  {initials(me.displayName, me.email)}
                </span>
                <span className="text-sm text-slate-700">{me.displayName}</span>
              </div>
            )}
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{logout.isPending ? "…" : "Log out"}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const Row = ({ href, label, icon: Icon, live, active }: {
    href: string; label: string; icon: any; live: boolean; active: boolean;
  }) => {
    const base =
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition";
    if (!live) {
      return (
        <div className={`${base} cursor-default text-slate-400`}>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1">{label}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
            Soon
          </span>
        </div>
      );
    }
    return (
      <Link
        href={href}
        onClick={onNavigate}
        className={`${base} ${active ? "bg-teal-50 font-medium text-teal-700" : "text-slate-600 hover:bg-slate-100"}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-600 font-bold text-white">Z</div>
        <span className="font-serif text-lg font-semibold text-slate-900">Zoiko Mail</span>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <Row
          href={DASHBOARD_ITEM.href}
          label={DASHBOARD_ITEM.label}
          icon={DASHBOARD_ITEM.icon}
          live
          active={pathname === DASHBOARD_ITEM.href}
        />
        {SECTIONS.map((section) => (
          <div key={section}>
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {section}
            </div>
            <div className="space-y-0.5">
              {NAV.filter((n) => n.section === section).map((n) => (
                <Row
                  key={n.href}
                  href={n.href}
                  label={n.label}
                  icon={n.icon}
                  live={n.status === "live"}
                  active={pathname === n.href}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}