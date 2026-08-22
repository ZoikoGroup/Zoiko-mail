"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useLifecycleRequests, useApproveDeletion, useConfirmDeletion, useCancelLifecycleRequest, useTenant } from "@/lib/owner-hooks";
import { Trash2, X, ShieldCheck } from "lucide-react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DeletionRequestsPage() {
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [confirmTarget, setConfirmTarget] = useState<any>(null);
  const [phase, setPhase] = useState<"approve" | "confirm">("approve");
  const [typedName, setTypedName] = useState("");

  const { data: requests = [], isLoading } = useLifecycleRequests();
  const { data: tenant } = useTenant();
  const approveDeletion = useApproveDeletion();
  const confirmDeletion = useConfirmDeletion();
  const cancelRequest = useCancelLifecycleRequest();

  const deletionRequests = requests.filter((r: any) => r.type === "DELETION");
  const tenantName = tenant?.name ?? "";

  const handleProcess = (row: any) => {
    setConfirmTarget(row);
    setPhase("approve");
    setTypedName("");
  };

  const handleApprove = () => {
    if (!confirmTarget) return;
    approveDeletion.mutate(confirmTarget.id, {
      onSuccess: () => {
        setPhase("confirm");
        setTypedName("");
      },
    });
  };

  const handleConfirmDeletion = () => {
    if (!confirmTarget || typedName !== tenantName) return;
    confirmDeletion.mutate(
      {
        requestId: confirmTarget.id,
        data: { confirmation: typedName, tenantName },
      },
      {
        onSuccess: () => {
          setConfirmTarget(null);
          setPhase("approve");
          setTypedName("");
        },
      }
    );
  };

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
          loading={isLoading}
          emptyMessage={isLoading ? "Loading deletion requests…" : "No deletion requests."}
          actions={(row) => {
            if (row.status === "REQUESTED") {
              return (
                <div className="flex gap-2">
                  <button onClick={() => setCancelTarget(row)} className="zoiko-btn sm">
                    <X className="h-3 w-3" /> Cancel
                  </button>
                  <button onClick={() => handleProcess(row)} className="zoiko-btn crit sm">
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

        {/* Step 1: Approve */}
        {phase === "approve" && (
          <Modal
            open={!!confirmTarget}
            onClose={() => { setConfirmTarget(null); setPhase("approve"); setTypedName(""); }}
            title="Approve Deletion"
            size="sm"
            footer={
              <>
                <button onClick={() => { setConfirmTarget(null); setPhase("approve"); setTypedName(""); }} className="zoiko-btn">Cancel</button>
                <button
                  onClick={handleApprove}
                  className="zoiko-btn crit"
                  disabled={approveDeletion.isPending}
                >
                  {approveDeletion.isPending ? "Approving…" : "Approve Deletion"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--warn-soft)] text-[var(--warn)]">
                  <Trash2 className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--ink)]">Step 1 of 2: Approve</p>
                  <p className="mt-1 text-sm text-[var(--ink3)]">
                    This will approve the deletion request. A second confirmation step will follow requiring you to type the organization name.
                  </p>
                </div>
              </div>
            </div>
          </Modal>
        )}

        {/* Step 2: Confirm by typing tenant name */}
        {phase === "confirm" && (
          <Modal
            open={!!confirmTarget}
            onClose={() => { setConfirmTarget(null); setPhase("approve"); setTypedName(""); }}
            title="Confirm Permanent Deletion"
            size="sm"
            footer={
              <>
                <button onClick={() => { setConfirmTarget(null); setPhase("approve"); setTypedName(""); }} className="zoiko-btn">Cancel</button>
                <button
                  onClick={handleConfirmDeletion}
                  className="zoiko-btn crit"
                  disabled={typedName !== tenantName || confirmDeletion.isPending}
                >
                  {confirmDeletion.isPending ? "Deleting…" : "Confirm Deletion"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--crit-soft)] text-[var(--crit)]">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--ink)]">Step 2 of 2: Type to confirm</p>
                  <p className="mt-1 text-sm text-[var(--ink3)]">
                    This will permanently delete all organization data. This action cannot be undone.
                  </p>
                </div>
              </div>
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
        )}
      </div>
    </ProtectedRoute>
  );
}
