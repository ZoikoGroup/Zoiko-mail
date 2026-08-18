"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, statusBadge } from "@/components/ui/StatusBadge";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Link2, RefreshCw, Unplug, Mail } from "lucide-react";

interface ConnectorRow {
  id: string;
  displayName: string;
  email: string;
  provider: "GMAIL" | "MICROSOFT_365";
  status: "ACTIVE" | "DISCONNECTED" | "ERROR";
  syncStatus: "IDLE" | "SYNCING" | "FAILED";
  lastSyncAt: string | null;
  connectedAt: string;
}

const mockConnectors: ConnectorRow[] = [
  { id: "c1", displayName: "Alex Morgan", email: "alex.morgan@gmail.com", provider: "GMAIL", status: "ACTIVE", syncStatus: "IDLE", lastSyncAt: "2026-08-18T08:30:00Z", connectedAt: "2026-06-01T00:00:00Z" },
  { id: "c2", displayName: "Sarah Chen", email: "sarah.chen@outlook.com", provider: "MICROSOFT_365", status: "ACTIVE", syncStatus: "IDLE", lastSyncAt: "2026-08-18T07:45:00Z", connectedAt: "2026-06-05T00:00:00Z" },
  { id: "c3", displayName: "Jordan Patel", email: "jordan.patel@gmail.com", provider: "GMAIL", status: "ERROR", syncStatus: "FAILED", lastSyncAt: "2026-08-17T18:00:00Z", connectedAt: "2026-06-10T00:00:00Z" },
  { id: "c4", displayName: "Jamie Lee", email: "jamie.lee@outlook.com", provider: "MICROSOFT_365", status: "ACTIVE", syncStatus: "SYNCING", lastSyncAt: "2026-08-18T09:00:00Z", connectedAt: "2026-06-15T00:00:00Z" },
  { id: "c5", displayName: "Taylor Kim", email: "taylor.kim@gmail.com", provider: "GMAIL", status: "ACTIVE", syncStatus: "IDLE", lastSyncAt: "2026-08-17T22:00:00Z", connectedAt: "2026-07-01T00:00:00Z" },
];

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const providerIcon: Record<string, string> = {
  GMAIL: "bg-[var(--crit-soft)] text-[var(--crit)]",
  MICROSOFT_365: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
};

export function ConnectedAccountsTable() {
  const columns: Column<ConnectorRow>[] = [
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
        data={mockConnectors}
        keyExtractor={(row) => row.id}
        pageSize={10}
        emptyMessage="No connected accounts."
        actions={(row) => (
          <DropdownMenu>
            <DropdownItem onClick={() => {}}>
              <RefreshCw className="h-3.5 w-3.5" /> Sync Now
            </DropdownItem>
            <DropdownItem danger onClick={() => {}}>
              <Unplug className="h-3.5 w-3.5" /> Disconnect
            </DropdownItem>
          </DropdownMenu>
        )}
      />
    </div>
  );
}
