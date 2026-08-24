"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import DigestSection from "@/components/digest/DigestSection";
import { useActions } from "@/lib/actions-hooks";
import { useMailList } from "@/lib/mail-hooks";
import { useThreads } from "@/lib/mail-hooks";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Clock, Mail, MessagesSquare, RefreshCw,
} from "lucide-react";

function formatDueDate(iso: string | null): string {
  if (!iso) return "no due date";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function DigestPage() {
  const qc = useQueryClient();

  // Compute the time boundaries once per render. Using browser local time
  // is fine for "today" purposes — a user's day boundaries are their own.
  const { startOfToday, endOfToday, weekAgo } = useMemo(() => {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const week = new Date(now); week.setDate(week.getDate() - 7);
    week.setHours(0, 0, 0, 0);
    return { startOfToday: start, endOfToday: end, weekAgo: week };
  }, []);

  // ---- Parallel queries ----------------------------------------------------
  // Each section fetches independently so slow queries don't block fast ones.

  // Active OPEN/IN_PROGRESS items due on-or-before end of today.
  // We fetch OPEN and IN_PROGRESS in one call using no status filter,
  // then split client-side into overdue vs due-today.
  const activeItems = useActions({
    dueBefore: endOfToday.toISOString(),
  });

  // Everything completed in the last 7 days (for the week strip).
  const weekCompleted = useActions({
    status: "COMPLETED",
    since: weekAgo.toISOString(),
  });

  // Unread inbox mail (limit 5 for the section preview).
  const unreadMail = useMailList({
    folder: "INBOX",
    unreadOnly: true,
    limit: 5,
  });

  // Recent threads (limit 5 for the section preview).
  const recentThreads = useThreads({ page: 1, limit: 5 });

  // ---- Client-side derivations --------------------------------------------

  // Filter down activeItems to non-completed, non-dismissed with a due date.
  const activeWithDue = (activeItems.data ?? []).filter(
    (a) =>
      a.dueAt &&
      a.status !== "COMPLETED" &&
      a.status !== "DISMISSED" &&
      a.status !== "SNOOZED"
  );
  const overdue = activeWithDue.filter(
    (a) => a.dueAt && new Date(a.dueAt) < startOfToday
  );
  const dueToday = activeWithDue.filter(
    (a) => a.dueAt && new Date(a.dueAt) >= startOfToday
  );

  const weekStats = {
    completed: weekCompleted.data?.length ?? 0,
    overdue: overdue.length,
    unreadMail: unreadMail.data?.pagination.total ?? 0,
    threads: recentThreads.data?.pagination.total ?? 0,
  };

  const handleRefresh = () => {
    // Refetch every top-level query used on this page.
    qc.invalidateQueries({ queryKey: ["actions"] });
    qc.invalidateQueries({ queryKey: ["mail", "list"] });
    qc.invalidateQueries({ queryKey: ["mail", "threads", "list"] });
  };

  const isAnyFetching =
    activeItems.isFetching ||
    weekCompleted.isFetching ||
    unreadMail.isFetching ||
    recentThreads.isFetching;

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-editorial text-2xl font-normal tracking-tight text-[var(--ink)] sm:text-3xl">
              Daily digest
            </h1>
            <p className="mt-1 text-sm text-[var(--ink3)]">{dateLabel}</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isAnyFetching}
            className="zoiko-btn sm disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isAnyFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {/* Week strip */}
        <div className="zoiko-card mt-6 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
            Last 7 days
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--ink2)]">
            <span>
              <strong className="text-[var(--ok)]">{weekStats.completed}</strong>{" "}
              completed
            </span>
            <span className="text-[var(--ink3)]">·</span>
            <span>
              <strong className="text-[var(--crit)]">{weekStats.overdue}</strong>{" "}
              overdue
            </span>
            <span className="text-[var(--ink3)]">·</span>
            <span>
              <strong className="text-[var(--ink)]">{weekStats.unreadMail}</strong>{" "}
              unread mail
            </span>
            <span className="text-[var(--ink3)]">·</span>
            <span>
              <strong className="text-[var(--ink)]">{weekStats.threads}</strong>{" "}
              threads
            </span>
          </div>
        </div>

        {/* Sections */}
        <div className="mt-6 space-y-4">
          {/* Overdue */}
          <DigestSection
            icon={AlertCircle}
            title="Overdue"
            count={overdue.length}
            isLoading={activeItems.isLoading}
            isError={!!activeItems.error}
            emptyMessage="Nothing overdue. Nice work."
            viewAllHref={overdue.length > 3 ? "/inbox" : undefined}
            viewAllLabel={overdue.length > 3 ? "View all" : undefined}
          >
            <ul className="divide-y divide-[var(--border)]">
              {overdue.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--ink)]">{a.text}</p>
                    <p className="mt-0.5 text-xs text-[var(--crit)]">
                      Due {formatDueDate(a.dueAt)}
                    </p>
                  </div>
                  <Link
                    href={a.threadId ? `/threads/${a.threadId}` : "/inbox"}
                    className="shrink-0 text-xs font-medium text-[var(--accent-ink)] hover:underline"
                  >
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          </DigestSection>

          {/* Due today */}
          <DigestSection
            icon={Clock}
            title="Due today"
            count={dueToday.length}
            isLoading={activeItems.isLoading}
            isError={!!activeItems.error}
            emptyMessage="Nothing due today."
            viewAllHref={dueToday.length > 3 ? "/inbox" : undefined}
            viewAllLabel={dueToday.length > 3 ? "View all" : undefined}
          >
            <ul className="divide-y divide-[var(--border)]">
              {dueToday.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--ink)]">{a.text}</p>
                    <p className="mt-0.5 text-xs text-[var(--ink3)]">
                      Due today
                    </p>
                  </div>
                  <Link
                    href={a.threadId ? `/threads/${a.threadId}` : "/inbox"}
                    className="shrink-0 text-xs font-medium text-[var(--accent-ink)] hover:underline"
                  >
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          </DigestSection>

          {/* Unread mail */}
          <DigestSection
            icon={Mail}
            title="Unread mail"
            count={unreadMail.data?.pagination.total ?? 0}
            isLoading={unreadMail.isLoading}
            isError={!!unreadMail.error}
            emptyMessage="Inbox is clear."
            viewAllHref="/mail"
            viewAllLabel="Open inbox"
          >
            <ul className="divide-y divide-[var(--border)]">
              {(unreadMail.data?.items ?? []).slice(0, 3).map((m) => (
                <li key={m.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {m.message?.subject ?? "(no subject)"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[var(--ink3)]">
                      {m.message?.fromName ?? m.message?.fromAddress ?? "Unknown sender"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </DigestSection>

          {/* Recent threads */}
          <DigestSection
            icon={MessagesSquare}
            title="Recent threads"
            count={recentThreads.data?.pagination.total ?? 0}
            isLoading={recentThreads.isLoading}
            isError={!!recentThreads.error}
            emptyMessage="No threads yet."
            viewAllHref="/threads"
            viewAllLabel="View all"
          >
            <ul className="divide-y divide-[var(--border)]">
              {(recentThreads.data?.threads ?? []).slice(0, 3).map((t) => (
                <li key={t.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">
                      {t.subjectNormalized || "(no subject)"}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink3)]">
                      {t.messageCount}{" "}
                      {t.messageCount === 1 ? "message" : "messages"}
                    </p>
                  </div>
                  <Link
                    href={`/threads/${t.id}`}
                    className="shrink-0 text-xs font-medium text-[var(--accent-ink)] hover:underline"
                  >
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          </DigestSection>
        </div>
      </div>
    </AppShell>
  );
}