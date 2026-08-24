"use client";

import { useState, useMemo } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar } from "@/components/ui/FilterBar";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pause, Play, Trash2, Mail, Eye, ExternalLink } from "lucide-react";
import { useAdminMailboxes, useDeleteAdminMailbox } from "@/lib/owner-hooks";
import { updateMailboxSendingStatus } from "@/lib/owner-api";
import type { Mailbox } from "@/lib/owner-api";
import { MailboxDetailsDrawer } from "./MailboxDetailsDrawer";

function formatBytes(mb: number) {
  if (mb === 0) return "—";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface MailboxesTableProps {
  onCreateMailbox: () => void;
}

export function MailboxesTable({ onCreateMailbox }: MailboxesTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState<Mailbox | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<Mailbox | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [detailsMailbox, setDetailsMailbox] = useState<Mailbox | null>(null);

  const { data: mailboxes = [], isLoading } = useAdminMailboxes();
  const deleteMailbox = useDeleteAdminMailbox();

  const domains = useMemo(() => {
    const set = new Set(mailboxes.map((m) => m.domain).filter(Boolean));
    return Array.from(set).sort();
  }, [mailboxes]);

  const filtered = useMemo(() => {
    return mailboxes.filter((m) => {
      if (statusFilter === "active" && m.sendSuspendedAt) return false;
      if (statusFilter === "suspended" && !m.sendSuspendedAt) return false;
      if (domainFilter !== "all" && m.domain !== domainFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          m.displayName.toLowerCase().includes(q) ||
          m.address.toLowerCase().includes(q) ||
          m.domain.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [mailboxes, search, statusFilter, domainFilter]);

  const columns: Column<Mailbox>[] = [
    {
      key: "displayName",
      label: "Mailbox",
      sortable: true,
      render: (row) => (
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
      key: "domain",
      label: "Domain",
      sortable: true,
      render: (row) => (
        <span className="text-sm text-[var(--ink2)]">{row.domain || "—"}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => (
        <StatusBadge variant={row.sendSuspendedAt ? "warn" : "ok"} dot>
          {row.sendSuspendedAt ? "Suspended" : "Active"}
        </StatusBadge>
      ),
    },
    {
      key: "storageUsedMb",
      label: "Storage",
      sortable: true,
      render: (row) =>
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
    {
      key: "createdAt",
      label: "Created",
      sortable: true,
      render: (row) => (
        <span className="text-xs text-[var(--ink3)]">{fmtDate(row.createdAt)}</span>
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          {domains.length > 0 && (
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Domains</option>
              {domains.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
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
        emptyMessage={isLoading ? "Loading mailboxes…" : "No mailboxes match your filters."}
        onRowClick={(row) => setDetailsMailbox(row)}
        actions={(row) => (
          <DropdownMenu>
            <DropdownItem onClick={() => setDetailsMailbox(row)}>
              <Eye className="h-3.5 w-3.5" /> View Details
            </DropdownItem>
            {!row.sendSuspendedAt ? (
              <DropdownItem onClick={() => setConfirmSuspend(row)}>
                <Pause className="h-3.5 w-3.5" /> Suspend Sending
              </DropdownItem>
            ) : (
              <DropdownItem onClick={() => {
                updateMailboxSendingStatus(row.id, { suspended: false });
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

      <MailboxDetailsDrawer
        mailbox={detailsMailbox}
        onClose={() => setDetailsMailbox(null)}
        onSuspend={(m) => { setDetailsMailbox(null); setConfirmSuspend(m); }}
        onResume={(m) => updateMailboxSendingStatus(m.id, { suspended: false })}
        onDelete={(m) => { setDetailsMailbox(null); setConfirmDelete(m); }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => { setConfirmDelete(null); setSuspendReason(""); }}
        onConfirm={() => {
          if (confirmDelete) deleteMailbox.mutate(confirmDelete.id);
          setConfirmDelete(null);
          setSuspendReason("");
        }}
        title="Delete Mailbox"
        message={`Are you sure you want to delete the mailbox for ${confirmDelete?.displayName}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={!!confirmSuspend}
        onClose={() => { setConfirmSuspend(null); setSuspendReason(""); }}
        onConfirm={() => {
          if (confirmSuspend) {
            updateMailboxSendingStatus(confirmSuspend.id, {
              suspended: true,
              reason: suspendReason || "Suspended by administrator",
            });
          }
          setConfirmSuspend(null);
          setSuspendReason("");
        }}
        title="Suspend Sending"
        message={`Suspend outbound sending for ${confirmSuspend?.displayName}'s mailbox?`}
        confirmLabel="Suspend"
        variant="warning"
      >
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Reason (required)</label>
          <input
            type="text"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="e.g. Policy violation, inactive account…"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
