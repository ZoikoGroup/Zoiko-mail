"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, statusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar, FilterSelect } from "@/components/ui/FilterBar";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Sparkles, Pause, Play, Trash2, Mail } from "lucide-react";
import { mockMailboxes } from "@/lib/owner-mock-data";
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
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = mockMailboxes.filter((m) => {
    const matchSearch =
      !search ||
      m.displayName.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || m.type === typeFilter;
    const matchStatus = !statusFilter || m.status === statusFilter;
    return matchSearch && matchType && matchStatus;
  });

  const columns: Column<Mailbox>[] = [
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
      key: "type",
      label: "Type",
      sortable: true,
      render: (row) => (
        <StatusBadge variant={row.type === "PRIMARY" ? "accent" : row.type === "SHARED" ? "ai" : "nu"}>
          {row.type}
        </StatusBadge>
      ),
    },
    {
      key: "provider",
      label: "Provider",
      sortable: true,
      render: (row) => (
        <span className="text-sm text-[var(--ink2)]">{row.provider}</span>
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
      key: "aiEnabled",
      label: "AI",
      render: (row) =>
        row.aiEnabled ? (
          <span className="zoiko-pill ai">
            <Sparkles className="h-3 w-3" /> Enabled
          </span>
        ) : (
          <span className="zoiko-pill nu">Off</span>
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
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { label: "Primary", value: "PRIMARY" },
              { label: "Alias", value: "ALIAS" },
              { label: "Shared", value: "SHARED" },
            ]}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: "Active", value: "ACTIVE" },
              { label: "Suspended", value: "SUSPENDED" },
            ]}
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
        emptyMessage="No mailboxes match your search."
        actions={(row) => (
          <DropdownMenu>
            {row.status === "ACTIVE" && (
              <DropdownItem onClick={() => {}}>
                <Pause className="h-3.5 w-3.5" /> Suspend
              </DropdownItem>
            )}
            {row.status === "SUSPENDED" && (
              <DropdownItem onClick={() => {}}>
                <Play className="h-3.5 w-3.5" /> Activate
              </DropdownItem>
            )}
            <DropdownItem onClick={() => {}}>
              <Mail className="h-3.5 w-3.5" /> Manage Aliases
            </DropdownItem>
            <DropdownItem danger onClick={() => {}}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownItem>
          </DropdownMenu>
        )}
      />
    </div>
  );
}
