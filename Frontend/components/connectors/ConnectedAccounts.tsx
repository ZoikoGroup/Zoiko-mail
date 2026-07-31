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

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700 ring-green-600/20",
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  ERROR: "bg-rose-50 text-rose-700 ring-rose-600/20",
  DISCONNECTED: "bg-slate-100 text-slate-500 ring-slate-500/20",
};

function statusStyle(s: ConnectorStatus) {
  return STATUS_STYLES[s] ?? "bg-slate-100 text-slate-600 ring-slate-500/20";
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
          <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold text-slate-900">
            <Link2 className="h-6 w-6 text-teal-600" /> Connected accounts
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Read-only Gmail / Microsoft 365 accounts used to detect actions.
          </p>
        </div>
        <button
          onClick={() => setShowConnect((s) => !s)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
        >
          {showConnect ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span className="hidden sm:inline">{showConnect ? "Close" : "Connect account"}</span>
        </button>
      </div>

      {showConnect && <ConnectForm onDone={() => setShowConnect(false)} />}

      <div className="mt-4 space-y-2">
        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load accounts. Try again.
          </div>
        )}
        {!isLoading && !error && accounts.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center text-slate-400">
            <Link2 className="h-10 w-10" />
            <p className="mt-3 text-sm font-medium text-slate-600">No accounts connected</p>
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Mail className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{PROVIDER_LABEL[a.provider] ?? a.provider}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyle(a.status)}`}>
              {a.status}
            </span>
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-500">{a.email}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Last synced: {formatDate(a.lastSyncedAt)}</span>
            {a.lastErrorCode && (
              <span className="inline-flex items-center gap-1 text-rose-500"><ShieldAlert className="h-3 w-3" /> {a.lastErrorCode}</span>
            )}
          </div>
          {a.status === "PENDING" && (
            <p className="mt-2 text-xs text-amber-600">Waiting for the provider to confirm — sync starts once active.</p>
          )}
        </div>
        <button
          onClick={onDisconnect}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
        >
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

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs text-slate-500">
        Registers an already-authorized, read-only account. (Provider consent pop-up comes once the backend OAuth flow is ready.)
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ConnectorProvider)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500"
        >
          <option value="GMAIL">Gmail</option>
          <option value="MICROSOFT_365">Microsoft 365</option>
        </select>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="account email" required
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500"
        />
      </div>
      <input
        value={providerAccountId} onChange={(e) => setProviderAccountId(e.target.value)}
        placeholder="provider account id (e.g. gmail-user-0001)" required
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit" disabled={create.isPending || !email.trim() || !providerAccountId.trim()}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
        >
          {create.isPending ? "Connecting…" : "Connect"}
        </button>
        <span className="text-xs text-slate-400">
          Scope: {READONLY_SCOPES[provider][0]}
        </span>
      </div>
      {create.isError && (
        <p className="text-xs text-rose-600">Couldn&rsquo;t connect — check the fields (this account may already be linked).</p>
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
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        <Activity className="h-4 w-4" /> Provider operations (admin)
      </h2>

      {/* Health */}
      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Provider health</span>
          <button onClick={() => health.refetch()} className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
        {health.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {health.error && <p className="text-sm text-rose-600">Couldn&rsquo;t load health.</p>}
        {health.data != null && (
          <pre className="overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            {JSON.stringify(health.data, null, 2)}
          </pre>
        )}
      </div>

      {/* Dead-letter */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Failed events (dead-letter)</span>
          <button onClick={() => dead.refetch()} className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
        {dead.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {dead.error && <p className="text-sm text-rose-600">Couldn&rsquo;t load dead-letter events.</p>}
        {!dead.isLoading && deadEvents.length === 0 && (
          <p className="inline-flex items-center gap-1.5 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-green-500" /> No failed events.
          </p>
        )}
        <div className="space-y-2">
          {deadEvents.map((e, i) => {
            const id = e?.id ?? e?.eventId ?? String(i);
            return (
              <div key={id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500">{id}</span>
                  <button
                    onClick={() => replay.mutate(id)}
                    disabled={replay.isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" /> Replay
                  </button>
                </div>
                <pre className="overflow-auto text-[11px] text-slate-600">{JSON.stringify(e, null, 2)}</pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}