"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar, FilterSelect } from "@/components/ui/FilterBar";
import { useAuditEvents } from "@/lib/owner-hooks";

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditLogsPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditEvents({
    page,
    limit: 15,
    action: actionFilter || undefined,
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  const filtered = search
    ? events.filter((e) => {
        const q = search.toLowerCase();
        return (
          e.actorName.toLowerCase().includes(q) ||
          e.targetName.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q)
        );
      })
    : events;

  const columns: Column<any>[] = [
    {
      key: "actorName",
      label: "Actor",
      sortable: true,
      render: (row) => <span className="font-medium text-[var(--ink)]">{row.actorName}</span>,
    },
    {
      key: "action",
      label: "Action",
      sortable: true,
      render: (row) => <code className="rounded bg-[var(--s2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink2)]">{row.action}</code>,
    },
    {
      key: "targetName",
      label: "Target",
      sortable: true,
      render: (row) => (
        <div>
          <div className="text-[var(--ink2)]">{row.targetName}</div>
          <div className="text-[10px] text-[var(--ink3)]">{row.targetType}</div>
        </div>
      ),
    },
    {
      key: "createdAt",
      label: "Date & Time",
      sortable: true,
      render: (row) => <span className="font-mono-num text-[11px] text-[var(--ink3)]">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "ipAddress",
      label: "IP Address",
      render: (row) => <span className="font-mono-num text-[11px] text-[var(--ink3)]">{row.ipAddress || "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusBadge variant={row.status === "SUCCESS" ? "ok" : "crit"} dot>
          {row.status}
        </StatusBadge>
      ),
    },
  ];

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Audit Logs"
          description="Track all privileged actions and security events."
        />
        <FilterBar>
          <SearchInput placeholder="Search logs…" value={search} onChange={setSearch} className="w-64" />
          <FilterSelect
            label="Event Type"
            value={actionFilter}
            onChange={(v) => { setActionFilter(v); setPage(1); }}
            options={[
              { label: "Auth", value: "auth" },
              { label: "User", value: "user" },
              { label: "Mailbox", value: "mailbox" },
              { label: "Domain", value: "domain" },
              { label: "Policy", value: "policy" },
              { label: "Member", value: "member" },
            ]}
          />
        </FilterBar>
        <DataTable
          columns={columns}
          data={filtered}
          keyExtractor={(row) => row.id}
          pageSize={15}
          loading={isLoading}
          emptyMessage={isLoading ? "Loading audit events…" : "No audit events match your filters."}
        />
        {total > 15 && (
          <div className="flex justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="zoiko-btn sm"
            >
              Previous
            </button>
            <span className="self-center text-sm text-[var(--ink3)]">Page {page} of {Math.ceil(total / 15)}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 15 >= total}
              className="zoiko-btn sm"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
}
