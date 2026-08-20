"use client";

import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import {
  useNotifications,
  useMarkNotificationRead,
} from "@/lib/notifications-hooks";
import { Bell, Loader2, MailCheck, AlertCircle } from "lucide-react";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NotificationsPage() {
  const { data: notifications = [], isLoading, error, refetch, isFetching } =
    useNotifications(false);
  const markRead = useMarkNotificationRead();

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-editorial flex items-center gap-3 text-2xl font-normal tracking-tight text-[var(--ink)] sm:text-3xl">
              <Bell className="h-6 w-6 text-[var(--accent)]" />
              Notifications
              {unread > 0 && (
                <span className="zoiko-pill accent">{unread} unread</span>
              )}
            </h1>
            <p className="mt-1 text-sm text-[var(--ink3)]">
              Alerts, digests, and other activity from your workspace.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="zoiko-btn sm disabled:opacity-50"
            title="Refresh"
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Refresh"
            )}
          </button>
        </div>

        <div className="zoiko-card mt-6">
          {isLoading && (
            <div className="flex items-center gap-2 p-6 text-sm text-[var(--ink3)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-6 text-sm text-[var(--crit)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Couldn&rsquo;t load notifications.
            </div>
          )}

          {!isLoading && !error && notifications.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-[var(--ink3)]">
              <MailCheck className="h-10 w-10 text-[var(--ok)]" />
              <p className="text-sm">You&rsquo;re all caught up.</p>
              <p className="text-xs">
                New activity in your workspace will show up here.
              </p>
            </div>
          )}

          {!isLoading && !error && notifications.length > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 p-4 ${
                    n.readAt ? "" : "bg-[var(--s2)]"
                  }`}
                >
                  {!n.readAt && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-sm ${
                        n.readAt
                          ? "text-[var(--ink2)]"
                          : "font-semibold text-[var(--ink)]"
                      }`}
                    >
                      {n.title}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--ink3)]">
                      {n.body}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-[var(--ink3)]">
                      <span>{timeAgo(n.createdAt)}</span>
                      {n.linkPath && (
                        <>
                          <span>·</span>
                          <Link
                            href={n.linkPath}
                            className="text-[var(--accent-ink)] hover:underline"
                            onClick={() => {
                              if (!n.readAt) markRead.mutate(n.id);
                            }}
                          >
                            Open
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                  {!n.readAt && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      className="shrink-0 text-xs font-medium text-[var(--accent-ink)] hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}