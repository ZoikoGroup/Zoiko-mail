"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ShieldOff, Plus, AlertTriangle } from "lucide-react";
import {
  useSuppressions,
  useAddSuppression,
  useDeactivateSuppression,
} from "@/lib/owner-hooks";
import type { SuppressionEntry } from "@/lib/owner-api";

function reasonPill(reason: SuppressionEntry["reason"]) {
  switch (reason) {
    case "HARD_BOUNCE": return <span className="zoiko-pill crit">Hard bounce</span>;
    case "COMPLAINT": return <span className="zoiko-pill warn">Complaint</span>;
    case "ADMIN": return <span className="zoiko-pill nu">Admin</span>;
    default: return <span className="zoiko-pill nu">{reason}</span>;
  }
}

function truncateHash(hash: string) {
  return `${hash.slice(0, 12)}…${hash.slice(-8)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export function SuppressionsTable() {
  const { data: entries = [], isLoading } = useSuppressions();
  const addSuppression = useAddSuppression();
  const deactivateSuppression = useDeactivateSuppression();

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SuppressionEntry | null>(null);

  const columns: Column<SuppressionEntry>[] = [
    {
      key: "emailHash",
      label: "Recipient hash",
      render: (row) => (
        <code className="rounded bg-[var(--s2)] px-1.5 py-0.5 font-mono text-xs text-[var(--ink2)]">
          {truncateHash(row.emailHash)}
        </code>
      ),
    },
    { key: "reason", label: "Reason", render: (row) => reasonPill(row.reason) },
    {
      key: "active",
      label: "Status",
      render: (row) =>
        row.active
          ? <span className="zoiko-pill ok">Active</span>
          : <span className="zoiko-pill nu">Deactivated</span>,
    },
    {
      key: "createdAt",
      label: "Added",
      sortable: true,
      render: (row) => <span className="text-sm text-[var(--ink2)]">{fmtDate(row.createdAt)}</span>,
    },
  ];

  const handleSubmit = () => {
    setFormError(null);
    if (!email.trim()) return;
    addSuppression.mutate(email.trim(), {
      onSuccess: () => setEmail(""),
      onError: (err) =>
        setFormError(err instanceof Error ? err.message : "Failed to add suppression."),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--ink2)]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
        Suppressed recipients never receive mail from your workspace. Only a one-way
        SHA-256 hash of the address is stored — the plaintext email is never kept.
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="recipient@example.com"
          className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button onClick={handleSubmit} disabled={!email.trim() || addSuppression.isPending} className="zoiko-btn pri">
          <Plus className="h-3.5 w-3.5" />
          {addSuppression.isPending ? "Adding…" : "Suppress"}
        </button>
      </div>

      {formError && (
        <div className="rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
          {formError}
        </div>
      )}

      <DataTable
        columns={columns}
        data={entries}
        keyExtractor={(row) => row.id}
        pageSize={10}
        loading={isLoading}
        emptyMessage={isLoading ? "Loading suppressions…" : "No active suppressions."}
        actions={(row) => (
          <DropdownMenu>
            <DropdownItem onClick={() => setConfirmDelete(row)}>
              <ShieldOff className="h-3.5 w-3.5" /> Deactivate
            </DropdownItem>
          </DropdownMenu>
        )}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deactivateSuppression.mutate(confirmDelete.id);
          }
          setConfirmDelete(null);
        }}
        title="Deactivate Suppression"
        message={`Allow this suppressed recipient to receive mail again? The entry stays in the history but marked inactive.`}
        confirmLabel="Deactivate"
        variant="warning"
      />
    </div>
  );
}
