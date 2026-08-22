"use client";

import { useMemo } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuditEvents, useConnectors } from "@/lib/owner-hooks";
import { ShieldAlert, AlertTriangle, CheckCircle2, Info, ExternalLink, ShieldCheck } from "lucide-react";

interface SecurityAlert {
  id: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  source: string;
  ipAddress?: string;
  timestamp: string;
  resolved: boolean;
}

const severityConfig = {
  critical: { icon: ShieldAlert, color: "text-[var(--crit)]", bg: "bg-[var(--crit-soft)]", variant: "crit" as const },
  warning: { icon: AlertTriangle, color: "text-[var(--warn)]", bg: "bg-[var(--warn-soft)]", variant: "warn" as const },
  info: { icon: Info, color: "text-[var(--accent-ink)]", bg: "bg-[var(--accent-soft)]", variant: "accent" as const },
};

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function SecurityAlertsPage() {
  const { data: auditData, isLoading: auditLoading } = useAuditEvents({ limit: 50 });
  const { data: connectors = [], isLoading: connectorsLoading } = useConnectors();

  const isLoading = auditLoading || connectorsLoading;

  const alerts = useMemo<SecurityAlert[]>(() => {
    const result: SecurityAlert[] = [];
    const events = auditData?.events ?? [];

    // Derive alerts from failed auth events
    const failedAuthEvents = events.filter(
      (e) => e.action.includes("LOGIN_FAILED") || e.action.includes("AUTH_FAILURE") || e.action.includes("OTP_FAILED")
    );
    if (failedAuthEvents.length > 0) {
      const latest = failedAuthEvents[0];
      result.push({
        id: `alert-auth-${latest.id}`,
        type: "failed_auth",
        severity: failedAuthEvents.length >= 5 ? "critical" : "warning",
        title: `${failedAuthEvents.length} failed authentication attempt${failedAuthEvents.length > 1 ? "s" : ""}`,
        description: `Multiple authentication failures detected. Most recent from ${latest.ipAddress || "unknown IP"}.`,
        source: "Auth System",
        ipAddress: latest.ipAddress || undefined,
        timestamp: latest.createdAt,
        resolved: false,
      });
    }

    // Derive alerts from suspicious role changes
    const roleChanges = events.filter((e) => e.action.includes("ROLE_CHANGED") || e.action.includes("MEMBERSHIP_REMOVED"));
    if (roleChanges.length > 0) {
      const latest = roleChanges[0];
      result.push({
        id: `alert-role-${latest.id}`,
        type: "policy_violation",
        severity: "info",
        title: "Membership changes detected",
        description: `${roleChanges.length} membership modification(s) occurred. Most recent: ${latest.action} by ${latest.actorName}.`,
        source: "Access Control",
        timestamp: latest.createdAt,
        resolved: true,
      });
    }

    // Derive alerts from connector health
    const unhealthyConnectors = connectors.filter((c) => c.status !== "ACTIVE");
    unhealthyConnectors.forEach((c) => {
      result.push({
        id: `alert-conn-${c.id}`,
        type: "provider_issue",
        severity: "warning",
        title: `Connector issue: ${c.email}`,
        description: `The ${c.provider} connector for ${c.email} is ${c.status.toLowerCase()}. Re-authentication may be required.`,
        source: "Connector Service",
        timestamp: c.lastSyncAt || c.connectedAt,
        resolved: false,
      });
    });

    // Derive alerts from sending suspensions
    const sendingSuspensions = events.filter((e) => e.action.includes("SENDING_SUSPENDED"));
    if (sendingSuspensions.length > 0) {
      const latest = sendingSuspensions[0];
      result.push({
        id: `alert-suspend-${latest.id}`,
        type: "rate_limit",
        severity: "critical",
        title: "Mailbox sending suspended",
        description: `Sending has been suspended for a mailbox. Target: ${latest.targetName}. This may be due to bounce rate limits.`,
        source: "Delivery Protection",
        timestamp: latest.createdAt,
        resolved: false,
      });
    }

    // Derive alerts from domain verification failures
    const domainFailures = events.filter((e) => e.action.includes("VERIFICATION_FAILED") || e.action.includes("DNS_CHECK_FAILED"));
    if (domainFailures.length > 0) {
      const latest = domainFailures[0];
      result.push({
        id: `alert-domain-${latest.id}`,
        type: "provider_issue",
        severity: "warning",
        title: "Domain verification issue",
        description: `DNS verification failed for ${latest.targetName}. Please check your DNS records.`,
        source: "Domain Service",
        timestamp: latest.createdAt,
        resolved: false,
      });
    }

    // Sort by timestamp (most recent first)
    result.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return result;
  }, [auditData, connectors]);

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Security Alerts"
          description="Monitor security events and suspicious activity."
        />

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="zoiko-card p-4">
                <div className="flex items-start gap-3">
                  <Skeleton variant="rect" className="h-8 w-8 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-7 w-7" />}
            title="No security alerts"
            description="Your organization looks healthy. Security alerts will appear here when suspicious activity is detected."
          />
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
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
                      <button className="zoiko-btn sm" disabled>
                        <ExternalLink className="h-3 w-3" /> Details
                      </button>
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
