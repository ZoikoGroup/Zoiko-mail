"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { useMe } from "@/lib/auth-hooks";
import { useActions } from "@/lib/actions-hooks";
import { isLoggedIn } from "@/lib/auth-storage";
import type { MeResponse } from "@/lib/auth-api";
import { NAV, SECTIONS } from "@/lib/nav";

export default function DashboardPage() {
  const router = useRouter();
  const { data } = useMe();
  const me = data as MeResponse | undefined;
  const { data: actions = [], isLoading } = useActions();

  useEffect(() => {
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  const active = actions.filter((a) => a.status === "OPEN" || a.status === "IN_PROGRESS").length;

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Greeting */}
        <h1 className="font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
          {me ? `Welcome back, ${me.displayName.split(" ")[0]}` : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          {me ? (
            <>
              Signed in to{" "}
              <span className="font-medium text-[var(--ink2)]">{me.tenant.name}</span> as{" "}
              {me.membership.role}.
            </>
          ) : (
            "Loading your workspace…"
          )}
        </p>

        {/* Live stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Active commitments" value={isLoading ? "—" : String(active)} href="/inbox" />
          <Stat label="Your role" value={me?.membership.role ?? "—"} />
          <Stat label="Workspace" value={me?.tenant.name ?? "—"} />
          <Stat label="Plan" value={me?.tenant.planCode ?? "—"} />
        </div>

        {/* Feature sections */}
        {SECTIONS.map((section) => (
          <section key={section} className="mt-10">
            <h2 className="font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
              {section}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {NAV.filter((n) => n.section === section).map((n) => {
                const Icon = n.icon;
                const live = n.status === "live";
                const card = (
                  <div
                    className={`flex h-full flex-col rounded-xl border bg-[var(--surface)] p-5 shadow-[var(--sh1)] transition ${
                      live
                        ? "border-[var(--border)] hover:border-[var(--accent)] hover:shadow-[var(--sh2)]"
                        : "border-dashed border-[var(--border)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${
                          live
                            ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                            : "bg-[var(--s3)] text-[var(--ink3)]"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      {live ? (
                        <span className="zoiko-pill accent">Live</span>
                      ) : (
                        <span className="zoiko-pill nu">Coming soon</span>
                      )}
                    </div>
                    <h3
                      className={`mt-3 font-medium ${
                        live ? "text-[var(--ink)]" : "text-[var(--ink3)]"
                      }`}
                    >
                      {n.label}
                    </h3>
                    <p className="mt-1 flex-1 text-sm text-[var(--ink3)]">{n.desc}</p>
                    {live && (
                      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-ink)]">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                );
                return live ? (
                  <Link key={n.href} href={n.href} className="block">
                    {card}
                  </Link>
                ) : (
                  <div key={n.href} className="cursor-default">
                    {card}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className="zoiko-stat">
      <div className="font-mono-num text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
        {label}
      </div>
      <div className="mt-1 truncate text-xl font-semibold text-[var(--ink)]">{value}</div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-80">
      {inner}
    </Link>
  ) : (
    inner
  );
}
