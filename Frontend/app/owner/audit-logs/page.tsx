"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar, FilterSelect } from "@/components/ui/FilterBar";
import { FileText } from "lucide-react";

interface AuditRow {
  id: string;
  actorName: string;
  action: string;
  targetType: string;
  targetName: string;
  ipAddress: string;
  status: "SUCCESS" | "FAILURE";
  createdAt: string;
}

const mockAudit: AuditRow[] = [
  { id: "a1", actorName: "Alex Morgan", action: "user.invite", targetType: "user", targetName: "dev@zoiko.dev", ipAddress: "192.168.1.1", status: "SUCCESS", createdAt: "2026-08-18T09:32:00Z" },
  { id: "a2", actorName: "Sarah Chen", action: "mailbox.create", targetType: "mailbox", targetName: "support@zoiko.dev", ipAddress: "192.168.1.2", status: "SUCCESS", createdAt: "2026-08-18T08:15:00Z" },
  { id: "a3", actorName: "System", action: "domain.verify", targetType: "domain", targetName: "zoiko.dev", ipAddress: "—", status: "SUCCESS", createdAt: "2026-08-17T16:42:00Z" },
  { id: "a4", actorName: "Alex Morgan", action: "member.role_change", targetType: "member", targetName: "Jamie Lee", ipAddress: "192.168.1.1", status: "SUCCESS", createdAt: "2026-08-17T14:10:00Z" },
  { id: "a5", actorName: "Unknown", action: "auth.login_failed", targetType: "user", targetName: "casey@zoiko.dev", ipAddress: "203.0.113.42", status: "FAILURE", createdAt: "2026-08-16T03:45:00Z" },
  { id: "a6", actorName: "Alex Morgan", action: "policy.update", targetType: "policy", targetName: "AI Drafting Policy", ipAddress: "192.168.1.1", status: "SUCCESS", createdAt: "2026-08-16T15:30:00Z" },
];

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditLogsPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const filtered = mockAudit.filter((e) => {
    const matchSearch =
      !search ||
      e.actorName.toLowerCase().includes(search.toLowerCase()) ||
      e.targetName.toLowerCase().includes(search.toLowerCase()) ||
      e.action.toLowerCase().includes(search.toLowerCase());
    const matchAction = !actionFilter || e.action.startsWith(actionFilter);
    return matchSearch && matchAction;
  });

  const columns: Column<AuditRow>[] = [
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
      render: (row) => <span className="font-mono-num text-[11px] text-[var(--ink3)]">{row.ipAddress}</span>,
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
            onChange={setActionFilter}
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
          emptyMessage="No audit events match your filters."
        />
      </div>
    </ProtectedRoute>
  );
}
