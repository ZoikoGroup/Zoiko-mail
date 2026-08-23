"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
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

function deliveryStatusPill(status: string) {
  switch (status) {
    case "DELIVERED":
    case "QUEUED":
      return <span className="zoiko-pill ok">{status}</span>;
    default:
      return <span className="zoiko-pill crit">{status}</span>;
  }
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">{label}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-28 shrink-0 text-[var(--ink3)]">{label}</span>
      <span className="min-w-0 break-words text-[var(--ink)]">{value ?? "—"}</span>
    </div>
  );
}

export function DeliveryEventsTable() {
  const [type, setType] = useState<DeliveryEventType | "">("");
  const [selected, setSelected] = useState<DeliveryEventRow | null>(null);
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
        <span className="ml-auto hidden text-xs text-[var(--ink3)] sm:block">
          Click a row for full details
        </span>
      </div>

      <DataTable
        columns={columns}
        data={events}
        keyExtractor={(row) => row.id}
        pageSize={15}
        loading={isLoading}
        emptyMessage={isLoading ? "Loading delivery events…" : "No delivery events recorded."}
        onRowClick={(row) => setSelected(row)}
      />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Delivery Event"
        size="lg"
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              {typePill(selected.type)}
              <span className="text-xs text-[var(--ink3)]">{fmtDate(selected.createdAt)}</span>
            </div>

            <DetailSection label="Failure">
              {selected.failureCode || selected.failureReason ? (
                <div className="space-y-1">
                  <DetailRow label="Code" value={
                    selected.failureCode ? (
                      <code className="rounded bg-[var(--s2)] px-1.5 py-0.5 font-mono text-xs text-[var(--crit)]">
                        {selected.failureCode}
                      </code>
                    ) : "—"
                  } />
                  <DetailRow label="Reason" value={selected.failureReason} />
                </div>
              ) : (
                <p className="text-sm text-[var(--ink3)]">No failure recorded for this event.</p>
              )}
            </DetailSection>

            <DetailSection label="Message">
              <div className="space-y-1">
                <DetailRow label="Subject" value={selected.subject} />
                <DetailRow label="From" value={selected.fromAddress} />
                <DetailRow
                  label="Provider"
                  value={
                    typeof selected.metadata?.provider === "string" ? (
                      <code className="rounded bg-[var(--s2)] px-1.5 py-0.5 font-mono text-xs text-[var(--ink2)]">
                        {String(selected.metadata.provider)}
                      </code>
                    ) : "—"
                  }
                />
              </div>
            </DetailSection>

            <DetailSection label={`Recipients (${selected.recipients.length})`}>
              {selected.recipients.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--s2)] text-left text-xs text-[var(--ink3)]">
                        <th className="px-3 py-2 font-medium">Address</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.recipients.map((r, i) => (
                        <tr key={`${r.email}-${i}`} className="border-b border-[var(--border)] last:border-0">
                          <td className="max-w-[220px] truncate px-3 py-2 text-[var(--ink)]">{r.email}</td>
                          <td className="px-3 py-2 capitalize text-[var(--ink3)]">{r.type.toLowerCase()}</td>
                          <td className="px-3 py-2">{deliveryStatusPill(r.deliveryStatus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-[var(--ink3)]">No recipients recorded.</p>
              )}
            </DetailSection>
          </div>
        )}
      </Modal>
    </div>
  );
}
