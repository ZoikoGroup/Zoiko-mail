"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar } from "@/components/ui/FilterBar";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pause, Play, Trash2, Mail } from "lucide-react";
import { useAdminMailboxes, useDeleteAdminMailbox } from "@/lib/owner-hooks";
import { updateMailboxSendingStatus } from "@/lib/owner-api";
import type { Mailbox } from "@/lib/owner-api";

function formatBytes(mb: number) {
  if (mb === 0) return "—";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

interface MailboxesTableProps {
  onCreateMailbox: () => void;
}

export function MailboxesTable({ onCreateMailbox }: MailboxesTableProps) {
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Mailbox | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<Mailbox | null>(null);

  const { data: mailboxes = [], isLoading } = useAdminMailboxes();
  const deleteMailbox = useDeleteAdminMailbox();

  const filtered = mailboxes.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.address.toLowerCase().includes(q)
    );
  });

  const columns = [
    {
      key: "displayName",
      label: "User",
      sortable: true,
      render: (row: Mailbox) => (
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--s3)] text-xs font-semibold text-[var(--ink3)]">
            <Mail className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="font-medium text-[var(--ink)]">{row.displayName}</div>
            <div className="text-[11px] text-[var(--ink3)]">{row.address}</div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row: Mailbox) => (
        <StatusBadge variant={row.sendSuspendedAt ? "warn" : "ok"} dot>
          {row.sendSuspendedAt ? "Suspended" : "Active"}
        </StatusBadge>
      ),
    },
    {
      key: "storageUsedMb",
      label: "Storage",
      sortable: true,
      render: (row: Mailbox) =>
        row.storageLimitMb > 0 ? (
          <div className="min-w-[120px]">
            <ProgressBar value={row.storageUsedMb} max={row.storageLimitMb} size="sm" />
            <span className="mt-0.5 block font-mono-num text-[10px] text-[var(--ink3)]">
              {formatBytes(row.storageUsedMb)} / {formatBytes(row.storageLimitMb)}
            </span>
          </div>
        ) : (
          <span className="text-[var(--ink3)]">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterBar>
          <SearchInput
            placeholder="Search mailboxes…"
            value={search}
            onChange={setSearch}
            className="w-64"
          />
        </FilterBar>
        <button onClick={onCreateMailbox} className="zoiko-btn pri">
          <Mail className="h-3.5 w-3.5" />
          Create Mailbox
        </button>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        keyExtractor={(row) => row.id}
        pageSize={10}
        emptyMessage={isLoading ? "Loading mailboxes…" : "No mailboxes match your search."}
        actions={(row) => (
          <DropdownMenu>
            {!row.sendSuspendedAt ? (
              <DropdownItem onClick={() => setConfirmSuspend(row)}>
                <Pause className="h-3.5 w-3.5" /> Suspend Sending
              </DropdownItem>
            ) : (
              <DropdownItem onClick={() => {
                updateMailboxSendingStatus(row.id, { sendingEnabled: true });
              }}>
                <Play className="h-3.5 w-3.5" /> Resume Sending
              </DropdownItem>
            )}
            <DropdownItem danger onClick={() => setConfirmDelete(row)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownItem>
          </DropdownMenu>
        )}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) deleteMailbox.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        title="Delete Mailbox"
        message={`Are you sure you want to delete the mailbox for ${confirmDelete?.displayName}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={!!confirmSuspend}
        onClose={() => setConfirmSuspend(null)}
        onConfirm={() => {
          if (confirmSuspend) {
            updateMailboxSendingStatus(confirmSuspend.id, { sendingEnabled: false });
          }
          setConfirmSuspend(null);
        }}
        title="Suspend Sending"
        message={`Suspend outbound sending for ${confirmSuspend?.displayName}'s mailbox?`}
        confirmLabel="Suspend"
        variant="warning"
      />
    </div>
  );
}
