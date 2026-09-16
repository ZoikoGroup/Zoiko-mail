"use client";

import { useSessions, useRevokeSession, useLogoutAll } from "@/lib/auth-hooks";
import type { SessionInfo } from "@/lib/auth-api";
import { Smartphone, Monitor, Globe, LogOut, Trash2 } from "lucide-react";

/**
 * "Where am I signed in" for the account page. Lists every live refresh
 * session for the current workspace, lets the user retire one specific device
 * (or all of them), and marks the session on screen so it is obvious which row
 * is this browser tab.
 */
export default function ActiveSessions() {
  const { data, isLoading } = useSessions();
  const revokeMutation = useRevokeSession();
  const logoutAllMutation = useLogoutAll();

  const sessions = (data as { sessions?: SessionInfo[] } | undefined)?.sessions ?? [];

  const revoke = (session: SessionInfo) => {
    if (window.confirm(`Sign out this ${session.deviceLabel} session?`)) {
      revokeMutation.mutate(session.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-14 rounded-lg bg-[var(--s3)]" />
            <div className="h-14 rounded-lg bg-[var(--s3)]" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-[var(--ink3)]">No active sessions.</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center gap-4 rounded-lg border border-[var(--border)] p-4"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--s3)] text-[var(--ink2)]">
                {sessionIcon(session.deviceLabel)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--ink)]">
                    {session.deviceLabel}
                  </span>
                  {session.isCurrent && (
                    <span className="zoiko-pill sm bg-teal-600/10 !text-teal-700 dark:!text-teal-300">
                      This device
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--ink3)]">
                  {[session.ipAddress, formatSignedIn(session)].filter(Boolean).join(" · ")}
                </p>
              </div>
              {!session.isCurrent && (
                <button
                  type="button"
                  onClick={() => revoke(session)}
                  disabled={revokeMutation.isPending}
                  title={`Sign out ${session.deviceLabel}`}
                  className="zoiko-btn sm shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Sign out
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          if (window.confirm("Sign out of every device, including this one?")) {
            logoutAllMutation.mutate();
          }
        }}
        disabled={logoutAllMutation.isPending || sessions.length < 2}
        className="inline-flex items-center gap-2 text-xs font-medium text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-40"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out of all other devices
      </button>
    </div>
  );
}

function sessionIcon(deviceLabel: string): React.ReactNode {
  const label = deviceLabel.toLowerCase();
  if (label.includes("ios") || label.includes("android")) {
    return <Smartphone className="h-5 w-5" />;
  }
  if (label.includes("windows") || label.includes("mac") || label.includes("linux")) {
    return <Monitor className="h-5 w-5" />;
  }
  return <Globe className="h-5 w-5" />;
}

function formatSignedIn(session: SessionInfo): string {
  const date = session.lastUsedAt ?? session.createdAt;
  if (!date) return "";
  const when = new Date(date);
  if (Number.isNaN(when.getTime())) return "";
  return `Last active ${when.toLocaleDateString()} ${when.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}