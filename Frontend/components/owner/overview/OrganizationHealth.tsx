"use client";

import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useDomains, useAdminMailboxes, useConnectorHealth } from "@/lib/owner-hooks";

interface HealthItem {
  label: string;
  status: "healthy" | "warning" | "error";
  detail: string;
}

const statusConfig: Record<HealthItem["status"], { icon: typeof CheckCircle2; color: string; bg: string }> = {
  healthy: { icon: CheckCircle2, color: "text-[var(--ok)]", bg: "bg-[var(--ok-soft)]" },
  warning: { icon: AlertTriangle, color: "text-[var(--warn)]", bg: "bg-[var(--warn-soft)]" },
  error: { icon: XCircle, color: "text-[var(--crit)]", bg: "bg-[var(--crit-soft)]" },
};

export function OrganizationHealth() {
  const { data: domains = [] } = useDomains();
  const { data: mailboxes = [] } = useAdminMailboxes();
  const { data: healthData = [] } = useConnectorHealth();

  const verifiedDomains = domains.filter((d) => d.verificationStatus === "VERIFIED").length;
  const totalDomains = domains.length;
  const activeMailboxes = mailboxes.filter((m) => !m.sendSuspendedAt).length;
  const totalMailboxes = mailboxes.length;
  const healthyProviders = healthData.filter((h) => h.healthy).length;
  const totalProviders = healthData.length;

  const items: HealthItem[] = [
    {
      label: "Domain Health",
      status: totalDomains === 0 ? "warning" : verifiedDomains === totalDomains ? "healthy" : "warning",
      detail: `${verifiedDomains}/${totalDomains} domains verified`,
    },
    {
      label: "Mailbox Status",
      status: totalMailboxes === 0 ? "warning" : activeMailboxes === totalMailboxes ? "healthy" : "warning",
      detail: `${activeMailboxes} active mailboxes`,
    },
    {
      label: "Provider Connection",
      status: totalProviders === 0 ? "healthy" : healthyProviders === totalProviders ? "healthy" : "warning",
      detail: totalProviders === 0 ? "No providers connected" : `${healthyProviders}/${totalProviders} healthy`,
    },
    {
      label: "Storage Usage",
      status: "healthy",
      detail: `${mailboxes.reduce((s, m) => s + m.storageUsedMb, 0)} MB used`,
    },
  ];

  return (
    <div className="zoiko-card">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Organization Health</h2>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item) => {
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
