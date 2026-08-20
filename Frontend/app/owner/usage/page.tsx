"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useUsage } from "@/lib/owner-hooks";
import {
  HardDrive,
  Mail,
  Users,
  Globe,
  Send,
  Inbox,
  AlertTriangle,
  FileText,
  Activity,
  Link2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

const TIME_RANGES = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const { data: usage, isLoading, error, refetch } = useUsage(days);

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Usage Dashboard"
          description="Monitor your workspace resource usage and activity."
        />

        {/* Time Range Selector */}
        <div className="flex items-center gap-2">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setDays(tr.value)}
              className={`zoiko-btn text-xs ${
                days === tr.value ? "pri" : ""
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorState
            message="Failed to load usage data."
            onRetry={() => refetch()}
          />
        ) : !isLoading && !usage ? (
          <EmptyState
            icon={<Activity className="h-7 w-7" />}
            title="No usage data"
            description="Usage data will appear here once your workspace starts activity."
          />
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {isLoading ? (
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="zoiko-card p-4">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="mt-2 h-8 w-16" />
                    </div>
                  ))}
                </>
              ) : usage ? (
                <>
                  <SummaryCard
                    icon={HardDrive}
                    label="Storage Used"
                    value={formatBytes(usage.storage.used)}
                    sub={`${formatBytes(usage.storage.limit)} limit`}
                    progress={
                      usage.storage.limit > 0
                        ? (usage.storage.used / usage.storage.limit) * 100
                        : 0
                    }
                  />
                  <SummaryCard
                    icon={Mail}
                    label="Emails Sent"
                    value={formatNumber(usage.emails.sent)}
                    sub={`${usage.emails.failed} failed`}
                  />
                  <SummaryCard
                    icon={Users}
                    label="Active Members"
                    value={usage.activeMembers.toString()}
                    sub={`${usage.totalDomains} domains`}
                  />
                  <SummaryCard
                    icon={Link2}
                    label="Connected Accounts"
                    value={usage.connectedAccounts.active.toString()}
                    sub={`${usage.mailboxes.count} mailboxes`}
                  />
                </>
              ) : null}
            </div>

            {/* Email & API Volume Charts */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {isLoading ? (
                <>
                  <div className="zoiko-card p-6">
                    <Skeleton className="mb-4 h-5 w-40" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                  <div className="zoiko-card p-6">
                    <Skeleton className="mb-4 h-5 w-40" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                </>
              ) : usage ? (
                <>
                  <VolumeChart
                    title="Email Volume"
                    data={usage.emailVolume}
                    color="var(--accent)"
                  />
                  <VolumeChart
                    title="API Activity"
                    data={usage.apiUsage}
                    color="var(--ok)"
                  />
                </>
              ) : null}
            </div>

            {/* Email Breakdown & Storage Breakdown */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {isLoading ? (
                <>
                  <div className="zoiko-card p-6">
                    <Skeleton className="mb-4 h-5 w-40" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                  <div className="zoiko-card p-6">
                    <Skeleton className="mb-4 h-5 w-40" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                </>
              ) : usage ? (
                <>
                  <div className="zoiko-card p-6">
                    <h3 className="mb-4 text-sm font-semibold text-[var(--ink)]">
                      Email Breakdown ({days}d)
                    </h3>
                    <div className="space-y-3">
                      <BreakdownRow
                        icon={Send}
                        label="Sent"
                        count={usage.emails.sent}
                        total={Object.values(usage.emails).reduce((a, b) => a + b, 0)}
                        color="var(--accent)"
                      />
                      <BreakdownRow
                        icon={Inbox}
                        label="Received"
                        count={usage.emails.received}
                        total={Object.values(usage.emails).reduce((a, b) => a + b, 0)}
                        color="var(--ok)"
                      />
                      <BreakdownRow
                        icon={AlertTriangle}
                        label="Failed"
                        count={usage.emails.failed}
                        total={Object.values(usage.emails).reduce((a, b) => a + b, 0)}
                        color="var(--err)"
                      />
                      <BreakdownRow
                        icon={FileText}
                        label="Drafts"
                        count={usage.emails.draft}
                        total={Object.values(usage.emails).reduce((a, b) => a + b, 0)}
                        color="var(--ink3)"
                      />
                    </div>
                  </div>

                  <div className="zoiko-card p-6">
                    <h3 className="mb-4 text-sm font-semibold text-[var(--ink)]">
                      Storage by Mailbox
                    </h3>
                    <div className="space-y-3">
                      {usage.storage.mailboxes.length === 0 ? (
                        <p className="text-sm text-[var(--ink3)]">No mailboxes yet.</p>
                      ) : (
                        usage.storage.mailboxes.map((m) => (
                          <div key={m.address} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="truncate text-[var(--ink2)]">
                                {m.address}
                              </span>
                              <span className="text-[var(--ink3)]">
                                {formatBytes(m.used)} / {formatBytes(m.limit)}
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--s3)]">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${
                                    m.limit > 0
                                      ? Math.min((m.used / m.limit) * 100, 100)
                                      : 0
                                  }%`,
                                  backgroundColor:
                                    m.limit > 0 && m.used / m.limit > 0.8
                                      ? "var(--err)"
                                      : "var(--accent)",
                                }}
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </ProtectedRoute>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  progress,
}: {
  icon: typeof HardDrive;
  label: string;
  value: string;
  sub: string;
  progress?: number;
}) {
  return (
    <div className="zoiko-card p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--ink3)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-[var(--ink)]">{value}</div>
      <div className="text-xs text-[var(--ink3)]">{sub}</div>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s3)]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(progress, 100)}%`,
              backgroundColor:
                progress > 80 ? "var(--err)" : "var(--accent)",
            }}
          />
        </div>
      )}
    </div>
  );
}

function VolumeChart({
  title,
  data,
  color,
}: {
  title: string;
  data: Array<{ date: string; count: number }>;
  color: string;
}) {
  return (
    <div className="zoiko-card p-6">
      <h3 className="mb-4 text-sm font-semibold text-[var(--ink)]">{title}</h3>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-[var(--ink3)]">
          No data in this period.
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "var(--ink3)" }}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
              />
              <YAxis tick={{ fontSize: 10, fill: "var(--ink3)" }} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={color}
                fill={`url(#grad-${title})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function BreakdownRow({
  icon: Icon,
  label,
  count,
  total,
  color,
}: {
  icon: typeof Send;
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--ink2)]">{label}</span>
          <span className="text-sm font-medium text-[var(--ink)]">
            {formatNumber(count)}
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--s3)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}
