"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mockDeletionRequests } from "@/lib/owner-mock-data";
import { Trash2 } from "lucide-react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface DeletionRow {
  id: string;
  type: string;
  requestedBy: string;
  target: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export default function DeletionRequestsPage() {
  const [confirmDelete, setConfirmDelete] = useState<DeletionRow | null>(null);

  const columns: Column<DeletionRow>[] = [
    {
      key: "type",
      label: "Type",
      sortable: true,
      render: (row) => (
        <span className="capitalize text-[var(--ink2)]">{row.type.replace("_", " ")}</span>
      ),
    },
    {
      key: "target",
      label: "Target",
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--ink)]">{row.target}</span>,
    },
    {
      key: "requestedBy",
      label: "Requested By",
      sortable: true,
      render: (row) => <span className="text-[var(--ink2)]">{row.requestedBy}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusBadge
          variant={
            row.status === "completed" ? "ok" : row.status === "in_progress" ? "warn" : row.status === "cancelled" ? "nu" : "accent"
          }
          dot
        >
          {row.status}
        </StatusBadge>
      ),
    },
    {
      key: "createdAt",
      label: "Created",
      sortable: true,
      render: (row) => <span className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "completedAt",
      label: "Completed",
      sortable: true,
      render: (row) => <span className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(row.completedAt)}</span>,
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
          data={mockDeletionRequests}
          keyExtractor={(row) => row.id}
          pageSize={10}
          emptyMessage="No deletion requests."
          actions={(row) =>
            row.status === "pending" ? (
              <button
                onClick={() => setConfirmDelete(row)}
                className="zoiko-btn crit sm"
              >
                <Trash2 className="h-3 w-3" /> Process
              </button>
            ) : null
          }
        />

        <ConfirmDialog
          open={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            // TODO: wire to deletion API
            console.log("Process deletion:", confirmDelete?.id);
            setConfirmDelete(null);
          }}
          title="Confirm Deletion"
          message={`This will permanently delete ${confirmDelete?.target}. This action cannot be undone.`}
          confirmLabel="Delete Permanently"
          variant="danger"
        />
      </div>
    </ProtectedRoute>
  );
}
