"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { useLifecycleRequests, useApproveDeletion, useConfirmDeletion, useCancelLifecycleRequest, useTenant } from "@/lib/owner-hooks";
import { Trash2, X } from "lucide-react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DeletionRequestsPage() {
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [confirmTarget, setConfirmTarget] = useState<any>(null);
  const [typedName, setTypedName] = useState("");

  const { data: requests = [], isLoading } = useLifecycleRequests();
  const { data: tenant } = useTenant();
  const approveDeletion = useApproveDeletion();
  const confirmDeletion = useConfirmDeletion();
  const cancelRequest = useCancelLifecycleRequest();

  const deletionRequests = requests.filter((r: any) => r.type === "DELETION");
  const tenantName = tenant?.name ?? "";

  const columns: Column<any>[] = [
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => (
        <StatusBadge
          variant={
            row.status === "COMPLETED" ? "ok"
              : row.status === "PROCESSING" || row.status === "APPROVED" ? "warn"
              : row.status === "CANCELLED" ? "nu"
              : "accent"
          }
          dot
        >
          {row.status}
        </StatusBadge>
      ),
    },
    {
      key: "reason",
      label: "Reason",
      render: (row) => <span className="text-[var(--ink2)]">{row.reason || "—"}</span>,
    },
    {
      key: "createdAt",
      label: "Created",
      sortable: true,
      render: (row) => <span className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(row.createdAt)}</span>,
    },
  ];

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Deletion Requests"
          description="Manage data and mailbox deletion requests."
        />
        <DataTable
          columns={columns}
          data={deletionRequests}
          keyExtractor={(row) => row.id}
          pageSize={10}
          emptyMessage={isLoading ? "Loading…" : "No deletion requests."}
          actions={(row) => {
            if (row.status === "REQUESTED") {
              return (
                <div className="flex gap-2">
                  <button onClick={() => setCancelTarget(row)} className="zoiko-btn sm">
                    <X className="h-3 w-3" /> Cancel
                  </button>
                  <button onClick={() => setConfirmTarget(row)} className="zoiko-btn crit sm">
                    <Trash2 className="h-3 w-3" /> Process
                  </button>
                </div>
              );
            }
            return null;
          }}
        />

        {/* Cancel confirmation */}
        <Modal
          open={!!cancelTarget}
          onClose={() => setCancelTarget(null)}
          title="Cancel Deletion Request"
          size="sm"
          footer={
            <>
              <button onClick={() => setCancelTarget(null)} className="zoiko-btn">Go Back</button>
              <button
                onClick={() => {
                  if (cancelTarget) cancelRequest.mutate(cancelTarget.id);
                  setCancelTarget(null);
                }}
                className="zoiko-btn crit"
                disabled={cancelRequest.isPending}
              >
                {cancelRequest.isPending ? "Cancelling…" : "Cancel Request"}
              </button>
            </>
          }
        >
          <p className="text-sm text-[var(--ink2)]">
            Cancel this deletion request? No data will be deleted.
          </p>
        </Modal>

        {/* Type tenant name to confirm permanent deletion */}
        <Modal
          open={!!confirmTarget}
          onClose={() => { setConfirmTarget(null); setTypedName(""); }}
          title="Confirm Permanent Deletion"
          size="sm"
          footer={
            <>
              <button onClick={() => { setConfirmTarget(null); setTypedName(""); }} className="zoiko-btn">Cancel</button>
              <button
                onClick={() => {
                  if (confirmTarget && typedName === tenantName) {
                    approveDeletion.mutate(confirmTarget.id, {
                      onSuccess: () => {
                        setConfirmTarget(null);
                        setTypedName("");
                      },
                    });
                  }
                }}
                className="zoiko-btn crit"
                disabled={typedName !== tenantName || approveDeletion.isPending}
              >
                {approveDeletion.isPending ? "Processing…" : "Approve Deletion"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-[var(--ink2)]">
              This will permanently delete all organization data. This action cannot be undone.
            </p>
            <div className="rounded-lg bg-[var(--crit-soft)] p-3 text-[11px] text-[var(--crit)]">
              Type <strong>{tenantName}</strong> to confirm deletion.
            </div>
            <div>
              <input
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={tenantName}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--crit)] focus:outline-none focus:ring-1 focus:ring-[var(--crit)]"
              />
            </div>
          </div>
        </Modal>
      </div>
    </ProtectedRoute>
  );
}
