"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useDeliveryEvents } from "@/lib/owner-hooks";
import type { DeliveryEventRow, DeliveryEventType } from "@/lib/owner-api";
import { Activity } from "lucide-react";

const EVENT_TYPES: (DeliveryEventType | "")[] = [
  "", "BOUNCED", "COMPLAINED", "BLOCKED", "FAILED", "DEFERRED", "REJECTED",
  "SUPPRESSED", "RATE_LIMITED", "PROVIDER_ERROR", "DELIVERED", "QUEUED",
  "ACCEPTED",
];

function typePill(type: DeliveryEventRow["type"]) {
  switch (type) {
    case "DELIVERED":
    case "ACCEPTED":
    case "QUEUED":
      return <span className="zoiko-pill ok">{type}</span>;
    case "DEFERRED":
    case "RATE_LIMITED":
      return <span className="zoiko-pill warn">{type}</span>;
    default:
      return <span className="zoiko-pill crit">{type}</span>;
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function DeliveryEventsTable() {
  const [type, setType] = useState<DeliveryEventType | "">("");
  const { data: events = [], isLoading } = useDeliveryEvents(type ? { type } : {});

  const columns: Column<DeliveryEventRow>[] = [
    { key: "type", label: "Type", render: (row) => typePill(row.type) },
    {
      key: "subject",
      label: "Message",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]">
            {row.subject || "(no subject)"}
          </p>
          <p className="truncate text-xs text-[var(--ink3)]">from {row.fromAddress || "—"}</p>
        </div>
      ),
    },
    {
      key: "recipients",
      label: "Recipients",
      render: (row) => (
        <span className="text-xs text-[var(--ink2)]">
          {row.recipients.map((r) => r.email).join(", ") || "—"}
        </span>
      ),
    },
    {
      key: "failureCode",
      label: "Failure",
      render: (row) =>
        row.failureCode ? (
          <span className="text-xs text-[var(--crit)]" title={row.failureReason ?? undefined}>
            {row.failureCode}
          </span>
        ) : (
          <span className="text-xs text-[var(--ink3)]">—</span>
        ),
    },
    {
      key: "createdAt",
      label: "When",
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-[var(--ink3)]">{fmtDate(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--ink3)]" />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as DeliveryEventType | "")}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t === "" ? "All event types" : t}</option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        data={events}
        keyExtractor={(row) => row.id}
        pageSize={15}
        loading={isLoading}
        emptyMessage={isLoading ? "Loading delivery events…" : "No delivery events recorded."}
      />
    </div>
  );
}
