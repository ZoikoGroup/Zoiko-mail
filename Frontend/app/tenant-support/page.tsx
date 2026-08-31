"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { useMe, useLogout } from "@/lib/auth-hooks";
import { fetchSupportOverview } from "@/lib/support-api";
import { isLoggedIn } from "@/lib/auth-storage";
import { resolveWorkspaceHref } from "@/lib/workspace";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { LogOut } from "lucide-react";

/**
 * Tenant-scoped support workspace.
 *
 * A SUPPORT membership is granted by an Owner for READ-ONLY diagnostics
 * inside ONE workspace. It is deliberately NOT the global platform console
 * at /support (staff-only). This page is the landing point for SUPPORT
 * members and shows only the tenant-scoped overview they are entitled to.
 */
export default function TenantSupportPage() {
  const router = useRouter();
  const { data, isPending, isError } = useMe();
  const logout = useLogout();
  const me = data as
    | { displayName?: string; email?: string; tenant?: { name?: string }; membership?: { role?: string } }
    | undefined;

  useEffect(() => {
    document.title = "Tenant Support | Zoiko Mail";
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  // Only SUPPORT members belong here. Any other role is routed to its own
  // workspace so nobody gets a false glimpse of the diagnostics surface.
  useEffect(() => {
    if (me && me.membership?.role && me.membership.role !== "SUPPORT") {
      router.replace(resolveWorkspaceHref(me.membership.role));
    }
  }, [me, router]);

  const overview = useQuery({
    queryKey: ["tenant-support-overview"],
    queryFn: fetchSupportOverview,
    enabled: Boolean(me && me.membership?.role === "SUPPORT"),
    retry: false,
  });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ground)]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (!me) return null;

  if (me.membership?.role !== "SUPPORT") {
    return <AccessDenied role={me.membership?.role} dashboard="tenant support" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      <header className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-[var(--ink2)]">
            {me.tenant?.name ?? "Workspace"}
          </span>
          <span className="font-mono-num ml-2 shrink-0 text-[9px] uppercase tracking-[0.11em] text-[var(--ink3)]">
            Support workspace
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {!isError && me.displayName && (
            <span className="hidden text-sm text-[var(--ink2)] sm:inline">
              {me.displayName}
            </span>
          )}
          <Link
            href="/inbox"
            className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm font-medium text-[var(--ink2)] ring-1 ring-inset ring-[var(--border)] hover:bg-[var(--s2)]"
          >
            Member area
          </Link>
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

      <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-[1100px] space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-[var(--ink)]">Support workspace</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink3)]">
              Read-only diagnostics for this workspace. You cannot manage users,
              domains, billing, or settings from here, and you cannot reach the
              global support console.
            </p>
          </div>

          {overview.isError && (
            <div className="rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
              {overview.error instanceof Error
                ? overview.error.message
                : "Could not load workspace diagnostics."}
            </div>
          )}

          {overview.isLoading && !overview.data && (
            <div className="flex h-40 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            </div>
          )}

          {overview.data && <StatsGrid stats={overview.data.stats} />}
          {overview.data?.domains && overview.data.domains.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--ink2)]">Domains</h2>
              <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[var(--s2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Domain</th>
                      <th className="px-3 py-2 font-semibold">Verification</th>
                      <th className="px-3 py-2 font-semibold">MX</th>
                      <th className="px-3 py-2 font-semibold">SPF</th>
                      <th className="px-3 py-2 font-semibold">DKIM</th>
                      <th className="px-3 py-2 font-semibold">DMARC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {overview.data.domains.map((d) => (
                      <tr key={d.id}>
                        <td className="px-3 py-2 font-medium text-[var(--ink)]">{d.domainName}</td>
                        <td className="px-3 py-2"><Tone value={d.verificationStatus} /></td>
                        <td className="px-3 py-2"><Tone value={d.mxStatus} /></td>
                        <td className="px-3 py-2"><Tone value={d.spfStatus} /></td>
                        <td className="px-3 py-2"><Tone value={d.dkimStatus} /></td>
                        <td className="px-3 py-2"><Tone value={d.dmarcStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function StatsGrid({ stats }: { stats: Record<string, number | string> }) {
  const items = [
    { label: "Members", value: stats.members },
    { label: "Mailboxes", value: stats.mailboxes },
    { label: "Domains", value: stats.domains },
    { label: "Active grants", value: stats.activeGrants },
    { label: "Failed msgs (24h)", value: stats.failedMessages24h },
    { label: "Failed deliveries (24h)", value: stats.failedDeliveries24h },
    { label: "Retry jobs", value: stats.retryJobs },
    { label: "Failed jobs", value: stats.failedJobs },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div className="font-mono-num text-2xl font-semibold text-[var(--ink)]">
            {it.value ?? 0}
          </div>
          <div className="mt-1 text-[11px] text-[var(--ink3)]">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function Tone({ value }: { value?: string }) {
  if (!value) return <span className="text-[var(--ink3)]">—</span>;
  const ok = value === "VALID" || value === "VERIFIED" || value === "ACTIVE";
  const bad = value === "INVALID" || value === "FAILED" || value === "BLOCKED";
  const color = ok
    ? "text-[var(--ok)]"
    : bad
      ? "text-[var(--crit)]"
      : "text-[var(--warn)]";
  return <span className={`font-mono-num ${color}`}>{value}</span>;
}
