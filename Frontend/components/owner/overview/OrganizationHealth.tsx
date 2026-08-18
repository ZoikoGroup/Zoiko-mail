"use client";

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { mockOrgHealth, type HealthItem } from "@/lib/owner-mock-data";

const statusConfig: Record<HealthItem["status"], { icon: typeof CheckCircle2; color: string; bg: string }> = {
  healthy: { icon: CheckCircle2, color: "text-[var(--ok)]", bg: "bg-[var(--ok-soft)]" },
  warning: { icon: AlertTriangle, color: "text-[var(--warn)]", bg: "bg-[var(--warn-soft)]" },
  error: { icon: XCircle, color: "text-[var(--crit)]", bg: "bg-[var(--crit-soft)]" },
};

export function OrganizationHealth() {
  return (
    <div className="zoiko-card">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Organization Health</h2>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {mockOrgHealth.map((item) => {
          const { icon: Icon, color, bg } = statusConfig[item.status];
          return (
            <div key={item.label} className="flex items-center gap-3 px-4 py-3">
              <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${bg}`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[var(--ink)]">{item.label}</div>
                <div className="text-[11px] text-[var(--ink3)]">{item.detail}</div>
              </div>
              <span
                className={`zoiko-pill ${
                  item.status === "healthy" ? "ok" : item.status === "warning" ? "warn" : "crit"
                }`}
              >
                {item.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
