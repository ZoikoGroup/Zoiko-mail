"use client";

import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe,
  Mail,
  MessagesSquare,
  PartyPopper,
  Plug,
} from "lucide-react";
import { useOnboardingStatus } from "@/lib/owner-hooks";

interface ChecklistRow {
  label: string;
  done: boolean;
  href: string;
  icon: typeof Globe;
}

export function SetupChecklist() {
  const { data, isLoading, isError } = useOnboardingStatus();

  if (isLoading) {
    return (
      <div className="zoiko-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">Workspace setup</h2>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-5 w-5 animate-pulse rounded-full bg-[var(--s3)]" />
              <div className="h-3.5 flex-1 animate-pulse rounded bg-[var(--s3)]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="zoiko-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-[var(--ink)]">Workspace setup</h2>
        <div className="flex h-40 items-center justify-center text-sm text-[var(--crit)]">
          Couldn&rsquo;t load setup status.
        </div>
      </div>
    );
  }

  const s = data.steps;
  const rows: ChecklistRow[] = [
    {
      label: "Create your workspace",
      done: s.workspaceCreated,
      href: "/owner",
      icon: Building2,
    },
    {
      label: s.domainVerified ? "Domain verified" : "Add & verify a domain",
      done: s.domainVerified && s.domainAdded,
      href: "/owner/domains",
      icon: Globe,
    },
    {
      label: "Create a mailbox",
      done: s.mailboxCreated,
      href: "/owner/mailboxes",
      icon: Mail,
    },
    {
      label: "Connect a provider account",
      done: s.providerConnected,
      href: "/owner/connected-accounts",
      icon: Plug,
    },
    {
      label: "Invite your team",
      done: s.teamInvited,
      href: "/owner/users",
      icon: MessagesSquare,
    },
  ];

  const pct = data.totalSteps === 0 ? 100 : Math.round((data.completedCount / data.totalSteps) * 100);

  return (
    <div className="zoiko-card p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Workspace setup</h2>
        {!data.isComplete && (
          <span className="zoiko-pill accent">{data.completedCount}/{data.totalSteps} done</span>
        )}
      </div>

      {data.isComplete ? (
        <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 py-6 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
            <PartyPopper className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-[var(--ink)]">All set — workspace ready</p>
          <p className="max-w-xs text-xs text-[var(--ink3)]">
            Every setup step is complete. You can revisit any section from the sidebar at any time.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-1 flex justify-between text-[11px] text-[var(--ink3)]">
            <span>Progress</span>
            <span className="font-mono-num">{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--s3)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          <ul className="mt-4 space-y-1">
            {rows.map((row) => {
              const Icon = row.done ? CheckCircle2 : row.icon;
              const Inner = (
                <div
                  className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${
                    row.done
                      ? "text-[var(--ink3)]"
                      : "bg-[var(--s2)] hover:bg-[var(--s3)]"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      row.done ? "text-[var(--ok)]" : "text-[var(--accent-ink)]"
                    }`}
                  />
                  <span
                    className={`flex-1 text-sm ${
                      row.done ? "line-through decoration-[var(--border)]" : "font-medium text-[var(--ink)]"
                    }`}
                  >
                    {row.label}
                  </span>
                  {!row.done && (
                    <>
                      <span className="hidden text-[11px] font-medium text-[var(--accent-ink)] group-hover:inline">
                        Set up
                      </span>
                      <ArrowRight className="hidden h-3.5 w-3.5 text-[var(--accent-ink)] group-hover:block" />
                    </>
                  )}
                </div>
              );
              return row.done ? (
                <li key={row.label}>{Inner}</li>
              ) : (
                <li key={row.label}>
                  <Link href={row.href} className="block">
                    {Inner}
                  </Link>
                </li>
              );
            })}
          </ul>

          {rows.some((r) => !r.done) && (
            <Link
              href="/owner/onboarding"
              className="zoiko-btn pri mt-4 inline-flex w-full justify-center"
            >
              Continue setup
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

export default SetupChecklist;
