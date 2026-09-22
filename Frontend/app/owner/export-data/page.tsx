"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { useLifecycleRequests, useRequestDataExport } from "@/lib/owner-hooks";
import { downloadExport } from "@/lib/owner-api";
import { AlertTriangle, Download, FileText, Building2 } from "lucide-react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const typeIcons: Record<string, typeof Building2> = {
  EXPORT: Building2,
  DELETION: FileText,
};

export default function ExportDataPage() {
  const [confirmExport, setConfirmExport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: requests = [], isLoading } = useLifecycleRequests();
  const requestDataExport = useRequestDataExport();
  // Exporting is a STEP_UP capability (RBAC §2): "Request export" and the
  // download both need a fresh sign-in, so the refused-then-retry dance is the
  // expected happy path rather than a dead end.
  const stepUp = useStepUp();

  const exportRequests = requests.filter((r) => r.type === "EXPORT");

  const handleDownload = (requestId: string) => {
    void stepUp
      .attempt("Download your workspace data export", (stepUpToken) =>
        downloadExport(requestId, stepUpToken)
      )
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Download failed.");
      });
  };

  const handleRequestExport = () => {
    setConfirmExport(false);
    void stepUp
      .attempt("Request a full workspace data export", (stepUpToken) =>
        requestDataExport.mutateAsync({
          input: {
            idempotencyKey: crypto.randomUUID(),
            reason: "Owner requested full workspace export",
          },
          stepUpToken,
        })
      )
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not request the export.");
      });
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <StepUpDialog {...stepUp.dialog} />
        <PageHeader
          title="Export Data"
          description="Request data exports for your organization."
        />

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Request new export */}
        <div className="zoiko-card p-6">
          <h3 className="text-sm font-semibold text-[var(--ink)] mb-4">Request Export</h3>
          <button
            className="flex w-full max-w-sm flex-col items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)] hover:shadow-[var(--sh2)]"
            onClick={() => setConfirmExport(true)}
            disabled={requestDataExport.isPending}
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-medium text-[var(--ink)]">Full Workspace Data</div>
              <div className="mt-0.5 text-[11px] text-[var(--ink3)]">
                Every user, mailbox, setting and stored document in this workspace, delivered as a JSON file.
              </div>
            </div>
          </button>
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
          open={confirmExport}
          onClose={() => setConfirmExport(false)}
          onConfirm={handleRequestExport}
          title="Request Data Export"
          message="Request a full export of every user, mailbox and document in this workspace? The export will be processed in the background and you'll be notified when it's ready."
          confirmLabel="Request Export"
          loading={requestDataExport.isPending}
          variant="warning"
        />
      </div>
    </ProtectedRoute>
  );
}
