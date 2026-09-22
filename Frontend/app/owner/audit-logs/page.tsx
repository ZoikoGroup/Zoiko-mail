"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar, FilterSelect } from "@/components/ui/FilterBar";
import { useAuditEvents } from "@/lib/owner-hooks";
import type { AuditEventQuery } from "@/lib/owner-api";

/**
 * Categories are sets of real event-type prefixes, sent to the server as
 * `eventTypePrefix`. It used to send single words ("auth", "mailbox") that
 * matched no event name in any workspace — the server filters on prefixes such
 * as LOGIN_ and MAILBOX_, so we must send the prefixes themselves.
 */
const CATEGORIES: Array<{ label: string; prefixes: string[] }> = [
  { label: "All events", prefixes: [] },
  { label: "Auth", prefixes: ["LOGIN_", "SIGNED_IN", "SESSION_", "PASSWORD_", "MFA_", "REFRESH_"] },
  { label: "Members & Access", prefixes: ["MEMBERSHIP_", "INVITATION_", "USER_", "SUPPORT_"] },
  { label: "Mailboxes", prefixes: ["MAILBOX_"] },
  { label: "Domains", prefixes: ["DOMAIN_"] },
  { label: "Connectors", prefixes: ["CONNECTED_", "PROVIDER_"] },
  { label: "Policies", prefixes: ["POLICY_"] },
  { label: "Data & Lifecycle", prefixes: ["DATA_", "RETENTION_", "TENANT_", "AUDIT_"] },
  { label: "Billing", prefixes: ["BILLING_", "SUBSCRIPTION_", "INVOICE_", "PLAN_"] },
];

/** A date input gives a day; the API wants an instant. */
function startOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined;
}
function endOfDay(value: string): string | undefined {
  return value ? new Date(`${value}T23:59:59.999Z`).toISOString() : undefined;
}

function formatDate(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditLogsPage() {
  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <Suspense fallback={<Loading />}>
        <AuditLogs />
      </Suspense>
    </ProtectedRoute>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title="Audit Logs" description="Track all privileged actions and security events." />
      <div className="flex h-48 items-center justify-center text-sm text-[var(--ink3)]">Loading audit logs…</div>
    </div>
  );
}

function AuditLogs() {
  const searchParams = useSearchParams();
  const grantId = searchParams.get("grantId") ?? "";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]!.label);
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo<AuditEventQuery>(() => {
    const prefixes = CATEGORIES.find((c) => c.label === category)?.prefixes ?? [];
    return {
      page,
      limit: 15,
      eventTypePrefix: prefixes.length ? prefixes : undefined,
      targetId: grantId || undefined,
      from: startOfDay(fromDay),
      to: endOfDay(toDay),
    };
  }, [category, fromDay, toDay, grantId, page]);

  const { data, isLoading } = useAuditEvents(filters);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  /** Resetting a filter must also leave any page that belonged to it. */
  const reset = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

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
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Audit Logs"
        description="Track all privileged actions and security events."
      />

      {grantId && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--ai)]/30 bg-[var(--ai-soft)] px-4 py-3 text-sm text-[var(--ai)]">
          <span>Showing audit events for support access grant <code className="font-mono">{grantId}</code>.</span>
          <a href="/owner/audit-logs" className="font-medium hover:underline">Clear</a>
        </div>
      )}

      <FilterBar>
        <SearchInput placeholder="Search logs…" value={search} onChange={setSearch} className="w-64" />
        <FilterSelect
          label="Category"
          value={category}
          onChange={reset(setCategory)}
          options={CATEGORIES.map((c) => ({ label: c.label, value: c.label }))}
        />
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">From</label>
          <input
            type="date"
            value={fromDay}
            onChange={(e) => reset(setFromDay)(e.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">To</label>
          <input
            type="date"
            value={toDay}
            onChange={(e) => reset(setToDay)(e.target.value)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        {(fromDay || toDay) && (
          <button
            className="zoiko-btn sm self-end"
            onClick={() => {
              setFromDay("");
              setToDay("");
              setPage(1);
            }}
          >
            Clear dates
          </button>
        )}
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        keyExtractor={(row) => row.id}
        pageSize={15}
        loading={isLoading}
        emptyMessage={isLoading ? "Loading audit events…" : total > 0 ? "No results for your server-side filters on this page." : "No audit events match your filters."}
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
  );
}