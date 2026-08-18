"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, statusBadge } from "@/components/ui/StatusBadge";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RefreshCw, Unplug, Mail } from "lucide-react";
import { useConnectors, useDeleteConnector } from "@/lib/owner-hooks";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ConnectedAccountsTable() {
  const [confirmDisconnect, setConfirmDisconnect] = useState<any>(null);
  const { data: connectors = [], isLoading } = useConnectors();
  const deleteConnector = useDeleteConnector();

  const columns: Column<any>[] = [
    {
      key: "displayName",
      label: "User",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--s3)] text-xs font-semibold text-[var(--ink3)]">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="font-medium text-[var(--ink)]">{row.displayName}</div>
            <div className="text-[11px] text-[var(--ink3)]">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "provider",
      label: "Provider",
      sortable: true,
      render: (row) => (
        <StatusBadge variant={row.provider === "GMAIL" ? "crit" : "accent"}>
          {row.provider === "GMAIL" ? "Gmail" : "Microsoft 365"}
        </StatusBadge>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => (
        <StatusBadge variant={statusBadge(row.status)} dot>{row.status}</StatusBadge>
      ),
    },
    {
      key: "syncStatus",
      label: "Sync",
      sortable: true,
      render: (row) => (
        <StatusBadge
          variant={
            row.syncStatus === "IDLE" ? "ok" : row.syncStatus === "SYNCING" ? "warn" : "crit"
          }
        >
          {row.syncStatus}
        </StatusBadge>
      ),
    },
    {
      key: "lastSyncAt",
      label: "Last Sync",
      sortable: true,
      render: (row) => (
        <span className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(row.lastSyncAt)}</span>
      ),
    },
    {
      key: "connectedAt",
      label: "Connected",
      sortable: true,
      render: (row) => (
        <span className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(row.connectedAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={connectors}
        keyExtractor={(row) => row.id}
        pageSize={10}
        emptyMessage={isLoading ? "Loading connected accounts…" : "No connected accounts."}
        actions={(row) => (
          <DropdownMenu>
            <DropdownItem danger onClick={() => setConfirmDisconnect(row)}>
              <Unplug className="h-3.5 w-3.5" /> Disconnect
            </DropdownItem>
          </DropdownMenu>
        )}
      />

      <ConfirmDialog
        open={!!confirmDisconnect}
        onClose={() => setConfirmDisconnect(null)}
        onConfirm={() => {
          if (confirmDisconnect) deleteConnector.mutate(confirmDisconnect.id);
          setConfirmDisconnect(null);
        }}
        title="Disconnect Account"
        message={`Disconnect ${confirmDisconnect?.displayName}'s ${confirmDisconnect?.provider === "GMAIL" ? "Gmail" : "Microsoft 365"} account? This will stop syncing.`}
        confirmLabel="Disconnect"
        variant="danger"
      />
    </div>
  );
}
