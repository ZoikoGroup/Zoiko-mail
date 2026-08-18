"use client";

import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: { value: string; positive: boolean };
  href?: string;
}

export function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <div className="zoiko-stat">
      <div className="flex items-center justify-between">
        <div className="font-mono-num text-[10px] font-medium uppercase tracking-wider text-[var(--ink3)]">
          {label}
        </div>
        {Icon && (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="mt-1 text-xl font-semibold text-[var(--ink)]">{value}</div>
      {trend && (
        <div className={`mt-0.5 text-xs font-medium ${trend.positive ? "text-[var(--ok)]" : "text-[var(--crit)]"}`}>
          {trend.value}
        </div>
      )}
    </div>
  );
}
