"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useLifecycleRequests, useRequestDataExport, useTenant } from "@/lib/owner-hooks";
import { downloadExport } from "@/lib/owner-api";
import { Download, FileText, Building2, Mail } from "lucide-react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const typeIcons: Record<string, typeof Building2> = {
  EXPORT: Building2,
  DELETION: FileText,
};

export default function ExportDataPage() {
  const [confirmExport, setConfirmExport] = useState<string | null>(null);
  const { data: requests = [], isLoading } = useLifecycleRequests();
  const requestDataExport = useRequestDataExport();
  const { data: tenant } = useTenant();

  const exportRequests = requests.filter((r) => r.type === "EXPORT");

  const handleRequestExport = (type: string) => {
    setConfirmExport(type);
  };

  const handleDownload = async (requestId: string) => {
    try {
      const blob = await downloadExport(requestId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zoiko-export-${requestId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Export Data"
          description="Request data exports for your organization."
        />

        {/* Request new export */}
        <div className="zoiko-card p-6">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Request New Export</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { type: "organization", label: "Organization Data", desc: "All users, settings, and configurations.", icon: Building2 },
              { type: "user", label: "User Data", desc: "Individual user data and activity.", icon: FileText },
              { type: "mailbox", label: "Mailbox Export", desc: "All mailbox contents and metadata.", icon: Mail },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  className="flex flex-col items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-center transition hover:border-[var(--accent)] hover:shadow-[var(--sh2)]"
                  onClick={() => handleRequestExport(item.type)}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="mt-2 text-sm font-medium text-[var(--ink)]">{item.label}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--ink3)]">{item.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Export history */}
        <div className="zoiko-card">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Export History</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">Loading…</div>
            ) : exportRequests.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">No export requests yet.</div>
            ) : (
              exportRequests.map((req) => {
                const Icon = typeIcons[req.type] ?? FileText;
                const isCompleted = req.status === "COMPLETED";
                return (
                  <div key={req.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--s3)] text-[var(--ink3)]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--ink)] capitalize">{req.type.toLowerCase()} Export</div>
                      <div className="text-[11px] text-[var(--ink3)]">
                        {formatDate(req.createdAt)}
                        {req.reason && <> · {req.reason}</>}
                      </div>
                    </div>
                    <StatusBadge
                      variant={
                        isCompleted ? "ok" : req.status === "PROCESSING" || req.status === "APPROVED" ? "warn" : req.status === "FAILED" ? "crit" : "nu"
                      }
                    >
                      {req.status}
                    </StatusBadge>
                    {isCompleted && (
                      <button onClick={() => handleDownload(req.id)} className="zoiko-btn sm">
                        <Download className="h-3 w-3" /> Download
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <ConfirmDialog
          open={!!confirmExport}
          onClose={() => setConfirmExport(null)}
          onConfirm={() => {
            requestDataExport.mutate({
              idempotencyKey: crypto.randomUUID(),
              reason: `Owner requested ${confirmExport} export`,
            });
            setConfirmExport(null);
          }}
          title="Request Data Export"
          message={`Request a ${confirmExport} data export? The export will be processed in the background and you'll be notified when it's ready.`}
          confirmLabel="Request Export"
          variant="warning"
        />
      </div>
    </ProtectedRoute>
  );
}
