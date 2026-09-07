"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { isLoggedIn, getPlatformToken } from "@/lib/auth-storage";
import { useMe, useLogout } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { DASHBOARD_ITEM, MEMBER_NAV, sectionsFor } from "@/lib/nav";
import { resolveWorkspaceHref } from "@/lib/workspace";
import { AccessDenied } from "@/components/ui/AccessDenied";

// Roles that belong on the member dashboard. SUPPORT has its own dashboard
// at /support-workspace and should never land here.
const MEMBER_DASHBOARD_ROLES = ["OWNER", "ADMIN", "MEMBER"];

function initials(name?: string, email?: string) {
  const base = (name?.trim() || email || "?").trim();
  const parts = base.split(/\s+/);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading: meLoading } = useMe();
  const me = data as MeResponse | undefined;
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth guard for every page that uses the shell.
  useEffect(() => {
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  // Staff-token guard: a user with a platform token (staff) has no tenant
  // membership, so useMe() will never resolve on this page and the loading
  // gate below would hang forever. Send them to /support where their token
  // is actually valid. Runs on mount only; token doesn't change mid-session.
  useEffect(() => {
    if (getPlatformToken()) {
      router.replace("/support");
    }
  }, [router]);

  // Role guard: a SUPPORT member should never see this dashboard's nav or
  // pages — redirect them to the tenant-scoped support workspace. Any other
  // non-member role falls through to the AccessDenied warning below.
  useEffect(() => {
    if (me && me.membership.role === "SUPPORT") {
      router.replace(resolveWorkspaceHref(me.membership.role));
    }
  }, [me, router]);

  // Loading gate: don't render the shell until we know the user's role.
  // Without this, a SUPPORT user would briefly see the member dashboard nav
  // and header before the role guard useEffect kicks in and redirects them.
  if (meLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ground)]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }
  // if (!MEMBER_DASHBOARD_ROLES.includes(me.membership.role)) {
  //   return null;
  // }
  // A SUPPORT user is already being redirected by the effect above; the
  // in-render guard below catches any other non-member role.
  if (me.membership.role === "SUPPORT") {
    return null;
  }
  if (!MEMBER_DASHBOARD_ROLES.includes(me.membership.role)) {
    return <AccessDenied role={me.membership.role} dashboard="member" />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] md:flex">
        <SidebarContent />
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
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
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
            <span className="truncate text-sm text-[var(--ink3)]">
              {me ? me.tenant.name : "Zoiko Mail"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {me && (
              <div className="hidden items-center gap-2 sm:flex">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
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

        {/* Keyed by pathname: remounts + fades in on every route change
            while the sidebar/header stay mounted (see .page-enter CSS). */}
        <main key={pathname} className="page-enter flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const Row = ({
    href,
    label,
    icon: Icon,
    live,
    active,
  }: {
    href: string;
    label: string;
    icon: any;
    live: boolean;
    active: boolean;
  }) => {
    const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition";
    if (!live) {
      return (
        <div className={`${base} cursor-default text-[var(--ink3)]`}>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1">{label}</span>
          <span className="zoiko-pill nu">Soon</span>
        </div>
      );
    }
    return (
      <Link
        href={href}
        onClick={onNavigate}
        className={`${base} ${active
          ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-ink)]"
          : "text-[var(--ink2)] hover:bg-[var(--s2)]"
          }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{label}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* <div className="flex items-center gap-2 px-5 py-4">
        <Image src="/ZoikoMail_Logo_DarkBG_PNG.png" width={40} height={40} className="h-8 w-auto" alt="Zoiko Mail" />
      </div> */}
      <Image
        src="/ZoikoMail_Logo_DarkBG_PNG.png"
        width={300}
        height={120}
        className="h-10 w-auto m-2"
        alt="Zoiko Mail"
        priority
      />

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <Row
          href={DASHBOARD_ITEM.href}
          label={DASHBOARD_ITEM.label}
          icon={DASHBOARD_ITEM.icon}
          live
          active={pathname === DASHBOARD_ITEM.href}
        />
        {sectionsFor(MEMBER_NAV).map((section) => (
          <div key={section}>
            <div className="font-mono-num px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
              {section}
            </div>
            <div className="space-y-0.5">
              {MEMBER_NAV.filter((n) => n.section === section).map((n) => (
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