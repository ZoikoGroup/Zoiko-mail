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
  useGoogleAuth,
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

  // Handle OAuth callback success
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const connected = searchParams?.get("connected");
  const oauthError = searchParams?.get("error");

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

      {connected === "true" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-soft)] p-4 text-sm text-[var(--ok)]">
          <CheckCircle2 className="h-4 w-4" /> Account connected successfully!
        </div>
      )}

      {oauthError && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
          <AlertCircle className="h-4 w-4" /> Connection failed: {oauthError}
        </div>
      )}

      {showConnect && <ConnectPanel onDone={() => setShowConnect(false)} />}

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

function ConnectPanel({ onDone }: { onDone: () => void }) {
  const googleAuth = useGoogleAuth();
  const create = useCreateConnector();
  const [showManual, setShowManual] = useState(false);
  const [provider, setProvider] = useState<ConnectorProvider>("GMAIL");
  const [email, setEmail] = useState("");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [googleError, setGoogleError] = useState<string | null>(null);

  const handleGoogleConnect = () => {
    setGoogleError(null);
    googleAuth.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err: any) => {
        const msg = err?.message || "Failed to start Google OAuth. Make sure GOOGLE_CLIENT_ID is configured in the backend .env.";
        setGoogleError(msg);
      },
    });
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !providerAccountId.trim()) return;
    create.mutate(
      {
        provider,
        email: email.trim(),
        providerAccountId: providerAccountId.trim(),
        scopes: READONLY_SCOPES[provider],
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
    <div className="mt-4 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
      {/* OAuth buttons */}
      <div className="space-y-2">
        <button
          onClick={handleGoogleConnect}
          disabled={googleAuth.isPending}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:shadow-[var(--sh2)] disabled:opacity-50"
        >
          {googleAuth.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          )}
          Continue with Google
        </button>
        {googleError && (
          <p className="mt-2 text-xs text-[var(--crit)]">{googleError}</p>
        )}
      </div>

      {/* Manual form toggle */}
      <div className="border-t border-[var(--border)] pt-3">
        <button
          onClick={() => setShowManual(!showManual)}
          className="text-xs text-[var(--ink3)] hover:text-[var(--ink2)]"
        >
          {showManual ? "Hide manual form" : "Register an existing account manually"}
        </button>
      </div>

      {showManual && (
        <form onSubmit={submitManual} className="space-y-3">
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
      )}
    </div>
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