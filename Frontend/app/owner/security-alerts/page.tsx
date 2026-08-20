"use client";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { mockSecurityAlerts } from "@/lib/owner-mock-data";
import { ShieldAlert, AlertTriangle, CheckCircle2, Info, ExternalLink } from "lucide-react";

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const severityConfig = {
  critical: { icon: ShieldAlert, color: "text-[var(--crit)]", bg: "bg-[var(--crit-soft)]", variant: "crit" as const },
  warning: { icon: AlertTriangle, color: "text-[var(--warn)]", bg: "bg-[var(--warn-soft)]", variant: "warn" as const },
  info: { icon: Info, color: "text-[var(--accent-ink)]", bg: "bg-[var(--accent-soft)]", variant: "accent" as const },
};

export default function SecurityAlertsPage() {
  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Security Alerts"
          description="Monitor security events and suspicious activity."
        />

        <div className="space-y-3">
          {mockSecurityAlerts.map((alert) => {
            const { icon: Icon, color, bg, variant } = severityConfig[alert.severity];
            return (
              <div
                key={alert.id}
                className={`zoiko-card p-4 ${alert.resolved ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bg}`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">{alert.title}</h3>
                      <StatusBadge variant={variant}>{alert.severity}</StatusBadge>
                      {alert.resolved && (
                        <StatusBadge variant="ok">
                          <CheckCircle2 className="h-3 w-3" /> Resolved
                        </StatusBadge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--ink3)]">{alert.description}</p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--ink3)]">
                      <span>{alert.source}</span>
                      {alert.ipAddress && (
                        <>
                          <span>·</span>
                          <code className="font-mono">{alert.ipAddress}</code>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatDate(alert.timestamp)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!alert.resolved && (
                      <button className="zoiko-btn sm">Mark Resolved</button>
                    )}
                    <button className="zoiko-btn sm">
                      <ExternalLink className="h-3 w-3" /> Details
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ProtectedRoute>
  );
}
