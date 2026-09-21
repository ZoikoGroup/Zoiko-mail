"use client";

import { useMemo, useState } from "react";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Info,
  KeyRound,
  Smartphone,
  RotateCcw,
} from "lucide-react";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCan } from "@/lib/admin-capabilities";
import { useReviewSecurityAlert, useSecurityAlerts } from "@/lib/owner-hooks";
import type {
  AlertReviewAction,
  AlertSeverity,
  AlertStatus,
  SecurityAlert,
  SecurityAlertType,
} from "@/lib/owner-api";

/**
 * What the workspace should look at today.
 *
 * The audit log is everything that happened; this is the subset somebody
 * needs to make a decision about — a sign-in from a device the account has
 * not used, a run of failed passwords from one address, a refresh token
 * replayed after it was revoked.
 *
 * The screen and the module behind it were both lost in the PR #35 merge.
 * What replaced it derived a plausible-looking list from audit events and
 * connector status while the real `security_alerts` table sat beside it,
 * populated by nothing and read by nobody. This reads the table.
 *
 * Deciding is the point, not looking: an alert nobody ever closes stops
 * being a signal within a week. So every row carries the three decisions,
 * and each one is recorded against the person who made it.
 */

const SEVERITY: Record<
  AlertSeverity,
  { icon: typeof ShieldAlert; tone: string; badge: "crit" | "warn" | "accent" | "ok" }
> = {
  CRITICAL: { icon: ShieldAlert, tone: "text-[var(--crit)]", badge: "crit" },
  HIGH: { icon: AlertTriangle, tone: "text-[var(--crit)]", badge: "crit" },
  MEDIUM: { icon: AlertTriangle, tone: "text-[var(--warn)]", badge: "warn" },
  LOW: { icon: Info, tone: "text-[var(--accent-ink)]", badge: "accent" },
};

const TYPE_ICON: Record<SecurityAlertType, typeof ShieldAlert> = {
  NEW_DEVICE_LOGIN: Smartphone,
  FAILED_LOGIN_BURST: ShieldAlert,
  REFRESH_TOKEN_REUSE: RotateCcw,
  PASSWORD_CHANGED: KeyRound,
  PASSWORD_RESET: KeyRound,
};

const FILTERS: Array<{ label: string; status: AlertStatus | "ALL" }> = [
  { label: "Open", status: "OPEN" },
  { label: "Acknowledged", status: "ACKNOWLEDGED" },
  { label: "Resolved", status: "RESOLVED" },
  { label: "Dismissed", status: "DISMISSED" },
  { label: "Everything", status: "ALL" },
];

const ACTIONS: Array<{ action: AlertReviewAction; label: string; hint: string }> = [
  { action: "ACKNOWLEDGE", label: "Acknowledge", hint: "Seen — still looking into it" },
  { action: "RESOLVE", label: "Resolve", hint: "Dealt with" },
  { action: "DISMISS", label: "Dismiss", hint: "Expected — no action needed" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SecurityAlertsPage() {
  const { data, isLoading, error } = useSecurityAlerts();
  const review = useReviewSecurityAlert();
  const can = useCan();

  // The matrix holds read and review separately, so an account that may look
  // but not decide sees the list without buttons it cannot use.
  const canReview = can("security-alert.review");

  const [filter, setFilter] = useState<AlertStatus | "ALL">("OPEN");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  const alerts = useMemo(() => {
    const all = data?.alerts ?? [];
    return filter === "ALL" ? all : all.filter((a) => a.status === filter);
  }, [data, filter]);

  const decide = (alert: SecurityAlert, action: AlertReviewAction) => {
    setFailed(null);
    review.mutate(
      { id: alert.id, action, note: noteFor === alert.id && note.trim() ? note.trim() : undefined },
      {
        onSuccess: () => {
          setNoteFor(null);
          setNote("");
        },
        onError: (e) =>
          setFailed(e instanceof Error ? e.message : "Could not record that decision."),
      }
    );
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Security alerts"
          description="Sign-ins, credential attempts and session activity worth a second look. Every decision here is recorded against the person who made it."
        />

        {failed && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {failed}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count =
              f.status === "ALL" ? data?.alerts.length ?? 0 : data?.counts[f.status] ?? 0;
            return (
              <button
                key={f.status}
                type="button"
                onClick={() => setFilter(f.status)}
                className={
                  filter === f.status
                    ? "rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-slate-900"
                    : "rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
                }
              >
                {f.label}
                {count > 0 && <span className="ml-1.5 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load security alerts. {(error as Error).message}
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-7 w-7" />}
            title={filter === "OPEN" ? "Nothing open" : "Nothing here"}
            description={
              filter === "OPEN"
                ? "No security alerts are waiting on a decision."
                : "No alerts match that filter."
            }
          />
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const sev = SEVERITY[alert.severity];
              const TypeIcon = TYPE_ICON[alert.type] ?? sev.icon;
              const open = alert.status === "OPEN" || alert.status === "ACKNOWLEDGED";

              return (
                <div
                  key={alert.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="flex items-start gap-3">
                    <TypeIcon className={`mt-0.5 h-5 w-5 shrink-0 ${sev.tone}`} aria-hidden />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          {alert.title}
                        </p>
                        <StatusBadge variant={sev.badge}>{alert.severity.toLowerCase()}</StatusBadge>
                        {alert.status !== "OPEN" && (
                          <StatusBadge variant="ok">{alert.status.toLowerCase()}</StatusBadge>
                        )}
                      </div>

                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {alert.message}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>{when(alert.createdAt)}</span>
                        {alert.actor?.email && <span>{alert.actor.email}</span>}
                        {!alert.actor?.email && alert.actorEmail && <span>{alert.actorEmail}</span>}
                        {alert.deviceLabel && <span>{alert.deviceLabel}</span>}
                        {alert.ipAddress && <span className="font-mono">{alert.ipAddress}</span>}
                      </div>

                      {alert.resolutionNote && (
                        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                          {alert.resolutionNote}
                          {alert.resolvedBy && (
                            <span className="ml-1 opacity-70">
                              — {alert.resolvedBy.displayName ?? alert.resolvedBy.email}
                              {alert.resolvedAt ? `, ${when(alert.resolvedAt)}` : ""}
                            </span>
                          )}
                        </p>
                      )}

                      {canReview && open && (
                        <div className="mt-3">
                          {noteFor === alert.id && (
                            <input
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              placeholder="What did you find? (optional, kept with the decision)"
                              className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                            />
                          )}
                          <div className="flex flex-wrap gap-2">
                            {ACTIONS.filter(
                              (a) =>
                                // Already acknowledged — offering it again is
                                // a button that does nothing visible.
                                !(a.action === "ACKNOWLEDGE" && alert.status === "ACKNOWLEDGED")
                            ).map((a) => (
                              <button
                                key={a.action}
                                type="button"
                                title={a.hint}
                                disabled={review.isPending}
                                onClick={() => decide(alert, a.action)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                              >
                                {a.label}
                              </button>
                            ))}
                            {noteFor !== alert.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  setNoteFor(alert.id);
                                  setNote("");
                                }}
                                className="rounded-lg px-3 py-1.5 text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
                              >
                                Add a note
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
