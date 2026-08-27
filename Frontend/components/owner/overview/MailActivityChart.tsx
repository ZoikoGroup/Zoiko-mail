"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUsage } from "@/lib/owner-hooks";

const SERIES = [
  { key: "sent", label: "Sent", stroke: "var(--ok)" },
  { key: "received", label: "Received", stroke: "var(--accent)" },
  { key: "failed", label: "Failed", stroke: "var(--crit)" },
] as const;

function tickDate(value: string) {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function MailActivityChart({ days = 30 }: { days?: number }) {
  const { data, isLoading, isError } = useUsage(days);

  const rows = data?.emailVolumeByStatus ?? [];
  const totals = SERIES.reduce<Record<string, number>>((acc, s) => {
    acc[s.key] = rows.reduce((sum, r) => sum + (Number(r[s.key]) || 0), 0);
    return acc;
  }, {});

  return (
    <div className="zoiko-card p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Mail activity</h2>
        <span className="text-[11px] text-[var(--ink3)]">Last {days} days</span>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="flex h-64 items-center justify-center text-sm text-[var(--crit)]">
          Couldn&rsquo;t load mail activity.
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-[var(--ink3)]">
          No data in this period.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink2)]">
            {SERIES.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.stroke }} />
                {s.label}
                <strong className="font-mono-num text-[var(--ink)]">{totals[s.key]}</strong>
              </span>
            ))}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient key={s.key} id={`mail-vol-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.stroke} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={s.stroke} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--ink3)" }}
                  tickFormatter={tickDate}
                />
                <YAxis tick={{ fontSize: 10, fill: "var(--ink3)" }} width={40} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
                />
                {SERIES.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={s.stroke}
                    fill={`url(#mail-vol-${s.key})`}
                    strokeWidth={2}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

export default MailActivityChart;
