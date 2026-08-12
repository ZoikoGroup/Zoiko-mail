"use client";

import React, { useMemo, useState } from "react";
import {
  Link2, Plus, X, Loader2, AlertCircle, RefreshCw, Trash2, Mail,
  CheckCircle2, Clock, ShieldAlert, Activity,
} from "lucide-react";
import {
  useConnectors,
  useCreateConnector,
  useDisconnectConnector,
  useConnectorHealth,
  useDeadLetter,
  useReplayDeadLetter,
} from "@/lib/connectors-hooks";
import {
  READONLY_SCOPES,
  type Connector,
  type ConnectorProvider,
  type ConnectorStatus,
} from "@/lib/connectors-api";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";

const PROVIDER_LABEL: Record<ConnectorProvider, string> = {
  GMAIL: "Gmail",
  MICROSOFT_365: "Microsoft 365",
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "ok",
  PENDING: "warn",
  ERROR: "crit",
  DISCONNECTED: "nu",
};

function statusTone(s: ConnectorStatus) {
  return STATUS_TONE[s] ?? "nu";
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function ConnectedAccounts() {
  const { data } = useMe();
  const me = data as MeResponse | undefined;
  const isAdmin = me?.membership.role === "OWNER" || me?.membership.role === "ADMIN";

  const { data: accounts = [], isLoading, error } = useConnectors();
  const disconnect = useDisconnectConnector();
  const [showConnect, setShowConnect] = useState(false);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
            <Link2 className="h-6 w-6 text-[var(--accent)]" /> Connected accounts
          </h1>
          <p className="mt-1 text-sm text-[var(--ink3)]">
            Read-only Gmail / Microsoft 365 accounts used to detect actions.
          </p>
        </div>
        <button onClick={() => setShowConnect((s) => !s)} className="zoiko-btn pri shrink-0">
          {showConnect ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span className="hidden sm:inline">{showConnect ? "Close" : "Connect account"}</span>
        </button>
      </div>

      {showConnect && <ConnectForm onDone={() => setShowConnect(false)} />}

      <div className="mt-4 space-y-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-[var(--ink3)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load accounts. Try again.
          </div>
        )}
        {!isLoading && !error && accounts.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-[var(--ink3)]">
            <Link2 className="h-10 w-10" />
            <p className="mt-3 text-sm font-medium text-[var(--ink2)]">No accounts connected</p>
            <p className="text-xs">Connect Gmail or Microsoft 365 to start detecting actions.</p>
          </div>
        )}

        {accounts.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            onDisconnect={() => disconnect.mutate(a.id)}
            busy={disconnect.isPending}
          />
        ))}
      </div>

      {isAdmin && <AdminPanel />}
    </div>
  );
}

function AccountCard({
  account: a, onDisconnect, busy,
}: { account: Connector; onDisconnect: () => void; busy: boolean }) {
  return (
    <div className="zoiko-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--s3)] text-[var(--ink2)]">
          <Mail className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--ink)]">{PROVIDER_LABEL[a.provider] ?? a.provider}</span>
            <span className={`zoiko-pill ${statusTone(a.status)}`}>{a.status}</span>
          </div>
          <div className="mt-0.5 truncate text-sm text-[var(--ink3)]">{a.email}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink3)]">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Last synced: {formatDate(a.lastSyncedAt)}</span>
            {a.lastErrorCode && (
              <span className="inline-flex items-center gap-1 text-[var(--crit)]"><ShieldAlert className="h-3 w-3" /> {a.lastErrorCode}</span>
            )}
          </div>
          {a.status === "PENDING" && (
            <p className="mt-2 text-xs text-[var(--warn)]">Waiting for the provider to confirm — sync starts once active.</p>
          )}
        </div>
        <button onClick={onDisconnect} disabled={busy} className="zoiko-btn crit sm shrink-0 disabled:opacity-50">
          <Trash2 className="h-3.5 w-3.5" /> Disconnect
        </button>
      </div>
    </div>
  );
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const create = useCreateConnector();
  const [provider, setProvider] = useState<ConnectorProvider>("GMAIL");
  const [email, setEmail] = useState("");
  const [providerAccountId, setProviderAccountId] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !providerAccountId.trim()) return;
    create.mutate(
      {
        provider,
        email: email.trim(),
        providerAccountId: providerAccountId.trim(),
        scopes: READONLY_SCOPES[provider], // read-only, derived — can't be invalid
      },
      {
        onSuccess: () => {
          setEmail(""); setProviderAccountId(""); setProvider("GMAIL"); onDone();
        },
      }
    );
  };

  const field =
    "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
      <p className="text-xs text-[var(--ink3)]">
        Registers an already-authorized, read-only account. (Provider consent pop-up comes once the backend OAuth flow is ready.)
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <select value={provider} onChange={(e) => setProvider(e.target.value as ConnectorProvider)} className={field}>
          <option value="GMAIL">Gmail</option>
          <option value="MICROSOFT_365">Microsoft 365</option>
        </select>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="account email" required
          className={`flex-1 ${field}`}
        />
      </div>
      <input
        value={providerAccountId} onChange={(e) => setProviderAccountId(e.target.value)}
        placeholder="provider account id (e.g. gmail-user-0001)" required
        className={`w-full ${field}`}
      />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={create.isPending || !email.trim() || !providerAccountId.trim()} className="zoiko-btn pri disabled:opacity-50">
          {create.isPending ? "Connecting…" : "Connect"}
        </button>
        <span className="text-xs text-[var(--ink3)]">Scope: {READONLY_SCOPES[provider][0]}</span>
      </div>
      {create.isError && (
        <p className="text-xs text-[var(--crit)]">Couldn&rsquo;t connect — check the fields (this account may already be linked).</p>
      )}
    </form>
  );
}

// ---- OWNER/ADMIN operational panel ----------------------------------------
function AdminPanel() {
  const health = useConnectorHealth(true);
  const dead = useDeadLetter(true);
  const replay = useReplayDeadLetter();

  // Defensive: real response shapes not yet confirmed.
  const deadEvents: any[] = useMemo(() => {
    const d: any = dead.data;
    if (Array.isArray(d)) return d;
    return d?.events ?? d?.deadLetter ?? d?.items ?? [];
  }, [dead.data]);

  return (
    <div className="mt-10">
      <h2 className="font-mono-num flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
        <Activity className="h-4 w-4" /> Provider operations (admin)
      </h2>

      {/* Health */}
      <div className="zoiko-card mt-3 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ink2)]">Provider health</span>
          <button onClick={() => health.refetch()} className="inline-flex items-center gap-1 text-xs text-[var(--accent-ink)] hover:underline">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
        {health.isLoading && <p className="text-sm text-[var(--ink3)]">Loading…</p>}
        {health.error && <p className="text-sm text-[var(--crit)]">Couldn&rsquo;t load health.</p>}
        {health.data != null && (
          <pre className="overflow-auto rounded-lg bg-[var(--s2)] p-3 text-xs text-[var(--ink2)]">
            {JSON.stringify(health.data, null, 2)}
          </pre>
        )}
      </div>

      {/* Dead-letter */}
      <div className="zoiko-card mt-4 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ink2)]">Failed events (dead-letter)</span>
          <button onClick={() => dead.refetch()} className="inline-flex items-center gap-1 text-xs text-[var(--accent-ink)] hover:underline">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
        {dead.isLoading && <p className="text-sm text-[var(--ink3)]">Loading…</p>}
        {dead.error && <p className="text-sm text-[var(--crit)]">Couldn&rsquo;t load dead-letter events.</p>}
        {!dead.isLoading && deadEvents.length === 0 && (
          <p className="inline-flex items-center gap-1.5 text-sm text-[var(--ink3)]">
            <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" /> No failed events.
          </p>
        )}
        <div className="space-y-2">
          {deadEvents.map((e, i) => {
            const id = e?.id ?? e?.eventId ?? String(i);
            return (
              <div key={id} className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono-num text-xs text-[var(--ink3)]">{id}</span>
                  <button
                    onClick={() => replay.mutate(id)}
                    disabled={replay.isPending}
                    className="zoiko-btn pri sm disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" /> Replay
                  </button>
                </div>
                <pre className="overflow-auto text-[11px] text-[var(--ink2)]">{JSON.stringify(e, null, 2)}</pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}