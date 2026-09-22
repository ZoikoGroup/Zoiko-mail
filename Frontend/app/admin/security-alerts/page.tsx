"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useReviewSecurityAlert, useSecurityAlerts } from "@/lib/admin-hooks";
import { ago } from "@/lib/admin-queries";
import type { AlertSeverity, AlertReviewAction, AlertStatus, SecurityAlertDto } from "@/lib/admin-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  FilterChips,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  type Tone,
} from "@/components/admin/ui";

const STATUS_FILTERS = ["All", "Open", "Acknowledged", "Resolved", "Dismissed"] as const;

const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  LOW: "nu",
  MEDIUM: "warn",
  HIGH: "warn",
  CRITICAL: "crit",
};

const STATUS_TONE: Record<AlertStatus, Tone> = {
  OPEN: "crit",
  ACKNOWLEDGED: "warn",
  RESOLVED: "ok",
  DISMISSED: "nu",
};

function labelFor(type: SecurityAlertDto["type"]): string {
  return type.replaceAll("_", " ").toLowerCase();
}

export default function AdminSecurityAlertsPage() {
  const { data, isLoading, error } = useSecurityAlerts();
  const review = useReviewSecurityAlert();
  const [filter, setFilter] = useState<string>(STATUS_FILTERS[0]);
  const [note, setNote] = useState<string>("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const alerts = data?.alerts ?? [];
    if (filter === "All") return alerts;
    return alerts.filter((a) => a.status === filter.toUpperCase());
  }, [data, filter]);

  const perStatus = (s: AlertStatus) => data?.counts?.[s] ?? 0;

  const submitReview = (e: FormEvent, alert: SecurityAlertDto, action: AlertReviewAction) => {
    e.preventDefault();
    review.mutate({ id: alert.id, action, note: note.trim() || undefined });
    setActiveId(null);
    setNote("");
  };

  return (
    <>
      <PageHeader
        title="Security alerts"
        subtitle="Sign-in and account events that need a decision, newest first"
      />

      <Notice tone="warn">
        <b className="text-[var(--warn)]">Nobody else can see these.</b> Only workspace owners and
        admins read this inbox. Resolving or dismissing an alert is recorded in the audit log, with
        who decided and the note left behind.
      </Notice>

      <FilterChips
        options={[...STATUS_FILTERS]}
        active={filter}
        onChange={setFilter}
      />

      <Card
        title="Alerts"
        badge={
          data ? (
            <Pill tone="nu">
              {data.openCount > 0
                ? `${data.openCount} open · ${data.alerts.length} total`
                : `${data.alerts.length} total`}
            </Pill>
          ) : undefined
        }
      >
        {error ? (
          <InlineError message={error.message} />
        ) : isLoading || !data ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <InlineEmpty
            title={filter === "All" ? "No security alerts" : `No ${filter.toLowerCase()} alerts`}
            hint="Sign-in and account-safety events will appear here as they happen."
          />
        ) : (
          visible.map((alert) => (
            <div key={alert.id}>
              <Row
                title={
                  <span className="inline-flex flex-wrap items-baseline gap-x-2">
                    {alert.title}
                    <span className="font-mono-num text-[10px] font-normal lowercase text-[var(--ink3)]">
                      {labelFor(alert.type)}
                    </span>
                  </span>
                }
                detail={
                  <>
                    {alert.message}
                    {alert.ipAddress && (
                      <span className="font-mono-num text-[var(--ink3)]">
                        {" "}
                        · from {alert.ipAddress}
                      </span>
                    )}
                    {alert.deviceLabel && (
                      <span className="text-[var(--ink3)]"> · {alert.deviceLabel}</span>
                    )}
                    {alert.resolutionNote && (
                      <span className="text-[var(--warn)]">
                        {" "}
                        · “{alert.resolutionNote}” — {alert.resolvedBy?.displayName ??
                          "the reviewer"}
                      </span>
                    )}
                  </>
                }
                right={
                  <>
                    <Pill tone={SEVERITY_TONE[alert.severity]}>{alert.severity}</Pill>
                    <Pill tone={STATUS_TONE[alert.status]}>{alert.status}</Pill>
                    <span className="font-mono-num w-[64px] text-right text-[10.5px] text-[var(--ink3)]">
                      {ago(alert.createdAt)}
                    </span>
                  </>
                }
              />
              {alert.status === "OPEN" && (
                <form
                  onSubmit={(e) => submitReview(e, alert, "RESOLVE")}
                  className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--s2)] px-4 py-2.5"
                >
                  <input
                    value={activeId === alert.id ? note : ""}
                    onChange={(e) => {
                      setActiveId(alert.id);
                      setNote(e.target.value);
                    }}
                    onFocus={() => setActiveId(alert.id)}
                    placeholder="Optional note — what did you check?"
                    className="zoiko-input min-w-[220px] flex-1"
                  />
                  <button
                    type="submit"
                    disabled={review.isPending}
                    className="zoiko-btn sm"
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: alert.id, action: "ACKNOWLEDGE", note: note.trim() || undefined })}
                    className="zoiko-btn sm ai"
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: alert.id, action: "DISMISS", note: note.trim() || undefined })}
                    className="zoiko-btn sm crit"
                  >
                    Dismiss
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </Card>

      <Card title="Status breakdown" padded={false}>
        <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
          {(["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"] as const).map((status) => (
            <div key={status} className="bg-[var(--surface)] px-4 py-3">
              <div className="font-mono-num text-[18px] font-semibold text-[var(--ink)]">
                {perStatus(status)}
              </div>
              <div className="font-mono-num text-[9.5px] font-semibold uppercase tracking-[0.13em] text-[var(--ink3)]">
                {status}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}