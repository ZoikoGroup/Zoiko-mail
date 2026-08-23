"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useProviderEvents, useReplayProviderEvent } from "@/lib/owner-hooks";
import type { ProviderEventRow, ProviderEventStatus, ConnectorProvider } from "@/lib/owner-api";
import { Radio, RotateCcw } from "lucide-react";

const STATUSES: (ProviderEventStatus | "")[] = ["", "FAILED", "DEAD_LETTER", "RETRY", "RECEIVED", "PROCESSED"];
const PROVIDERS: (ConnectorProvider | "")[] = ["", "GMAIL", "MICROSOFT_365", "IMAP_SMTP"];

function statusPill(status: ProviderEventRow["processingStatus"]) {
  switch (status) {
    case "PROCESSED": return <span className="zoiko-pill ok">Processed</span>;
    case "RECEIVED": return <span className="zoiko-pill nu">Received</span>;
    case "RETRY": return <span className="zoiko-pill warn">Retrying</span>;
    default: return <span className="zoiko-pill crit">{status}</span>;
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function ProviderEventsTable() {
  const [status, setStatus] = useState<ProviderEventStatus | "">("");
  const [provider, setProvider] = useState<ConnectorProvider | "">("");
  const [confirmReplay, setConfirmReplay] = useState<ProviderEventRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data: events = [], isLoading } = useProviderEvents({
    ...(status ? { status } : {}),
    ...(provider ? { provider } : {}),
  });
  const replayEvent = useReplayProviderEvent();

  const handleReplay = () => {
    if (!confirmReplay) return;
    setActionError(null);
    replayEvent.mutate(confirmReplay.id, {
      onSuccess: () => setConfirmReplay(null),
      onError: (err) =>
        setActionError(err instanceof Error ? err.message : "Failed to replay event."),
    });
  };

  const columns: Column<ProviderEventRow>[] = [
    { key: "provider", label: "Provider", render: (row) => <span className="text-sm text-[var(--ink2)]">{row.provider}</span> },
    {
      key: "accountEmail",
      label: "Account",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-[var(--ink)]">{row.accountEmail}</p>
          <p className="text-xs capitalize text-[var(--ink3)]">{row.accountStatus.toLowerCase()}</p>
        </div>
      ),
    },
    {
      key: "eventType",
      label: "Event",
      render: (row) => <code className="rounded bg-[var(--s2)] px-1.5 py-0.5 font-mono text-xs text-[var(--ink2)]">{row.eventType}</code>,
    },
    { key: "processingStatus", label: "Processing", render: (row) => statusPill(row.processingStatus) },
    {
      key: "errorCode",
      label: "Error",
      render: (row) =>
        row.errorCode ? (
          <span className="text-xs text-[var(--crit)]">{row.errorCode}</span>
        ) : (
          <span className="text-xs text-[var(--ink3)]">—</span>
        ),
    },
    {
      key: "attempts",
      label: "Attempts",
      render: (row) => (
        <span className={`text-xs ${row.attempts > 1 ? "text-[var(--warn)]" : "text-[var(--ink3)]"}`}>
          {row.attempts}/{row.maxAttempts}
        </span>
      ),
    },
    {
      key: "receivedAt",
      label: "Received",
      sortable: true,
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-[var(--ink3)]">{fmtDate(row.receivedAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="h-4 w-4 text-[var(--ink3)]" />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ProviderEventStatus | "")}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === "" ? "All statuses" : s}</option>
          ))}
        </select>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ConnectorProvider | "")}
          className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>{p === "" ? "All providers" : p}</option>
          ))}
        </select>
      </div>

      {actionError && (
        <div className="rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
          {actionError}
        </div>
      )}

      <DataTable
        columns={columns}
        data={events}
        keyExtractor={(row) => row.id}
        pageSize={15}
        loading={isLoading}
        emptyMessage={isLoading ? "Loading provider events…" : "No provider events recorded."}
        actions={(row) =>
          row.processingStatus === "DEAD_LETTER" ? (
            <DropdownMenu>
              <DropdownItem onClick={() => setConfirmReplay(row)}>
                <RotateCcw className="h-3.5 w-3.5" /> Replay
              </DropdownItem>
            </DropdownMenu>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={!!confirmReplay}
        onClose={() => setConfirmReplay(null)}
        onConfirm={handleReplay}
        title="Replay Provider Event"
        message={`Requeue this ${confirmReplay?.eventType ?? ""} event from ${
          confirmReplay?.accountEmail ?? "the connected account"
        }? It will be processed again immediately.`}
        confirmLabel="Replay"
        variant="warning"
        loading={replayEvent.isPending}
      />
    </div>
  );
}
