"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertCircle, CheckCircle2, ChevronRight, Clock, Eye, Link2, Loader2, Lock, Mail, Pencil, Plus,
  RefreshCw, Search, Send, ShieldAlert, ShieldCheck, Trash2, X,
} from "lucide-react";
import {
  useConnectorEvents, useConnectors, useCreateConnector, useDisconnectConnector, useGoogleAuth,
  useMicrosoftAuth, useSyncConnector,
} from "@/lib/connectors-hooks";
import { READONLY_SCOPES, type Connector, type ConnectorEvent, type ConnectorProvider } from "@/lib/connectors-api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { SettingsNotice } from "@/components/settings/SettingsBits";
import type { SettingsSection } from "@/components/settings/sections";

/**
 * Settings → Connected Mailboxes: Gmail and Microsoft 365 accounts linked
 * read-only, so Zoiko Mail can find actions and follow-ups in them.
 *
 * Replaces /connected-accounts, which now redirects here — with its query
 * string, because that is where the provider's sign-in returns
 * (?connected=true&provider=…, or ?error=…).
 */

export const PROVIDER_LABEL: Record<string, string> = { GMAIL: "Gmail", MICROSOFT_365: "Microsoft 365" };

type Tone = "ok" | "warn" | "crit" | "nu";
const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Connected", tone: "ok" },
  PENDING: { label: "Pending", tone: "warn" },
  DEGRADED: { label: "Degraded", tone: "warn" },
  REAUTH_REQUIRED: { label: "Needs review", tone: "warn" },
  ERROR: { label: "Error", tone: "crit" },
  DISCONNECTED: { label: "Disconnected", tone: "nu" },
};
const status = (s: string) => STATUS[s] ?? { label: s, tone: "nu" as Tone };

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-[var(--ok)]/40 bg-[var(--ok-soft)] text-[var(--ok)]",
  warn: "border-[var(--warn)]/40 bg-[var(--warn-soft)] text-[var(--warn)]",
  crit: "border-[var(--crit)]/40 bg-[var(--crit-soft)] text-[var(--crit)]",
  nu: "border-[var(--border)] bg-[var(--s2)] text-[var(--ink3)]",
};

export function StatusPill({ value }: { value: string }) {
  const s = status(value);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[s.tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> {s.label}
    </span>
  );
}

/** What each scope the server accepts lets Zoiko Mail do; unknown ones are shown as granted, by name. */
const SCOPES: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.readonly": "Read messages and labels in this account",
  "Mail.Read": "Read messages and folders in this account",
};

function when(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const humanize = (value: string) => value.replace(/[_.]+/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function ProviderLogo({ provider, size = "md" }: { provider: ConnectorProvider; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";
  const icon = size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center bg-white shadow-sm ${box}`} aria-hidden>
      {provider === "MICROSOFT_365" ? (
        <svg className={icon} viewBox="0 0 21 21">
          <rect x="1" y="1" width="9" height="9" fill="#F25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
      ) : (
        <svg className={icon} viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      )}
    </span>
  );
}

function Banner({ tone, children, onDismiss }: { tone: "ok" | "crit"; children: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <div role={tone === "crit" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px] ${TONE_CLASS[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/10">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function ConnectedMailboxes({ section }: { section: SettingsSection }) {
  const { data: accounts = [], isLoading, error } = useConnectors();
  const [showConnect, setShowConnect] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callback, setCallback] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);

  // Where the provider's sign-in comes back to. Read once, then cleared from
  // the address bar so a reload does not announce it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("error");
    if (!connected && !failed) return;
    const provider = PROVIDER_LABEL[params.get("provider") ?? ""] ?? "Your account";
    setCallback(
      connected === "true"
        ? { tone: "ok", text: `${provider} connected. Mail will start syncing shortly.` }
        : { tone: "crit", text: `The connection did not complete: ${humanize(failed ?? "unknown error")}.` }
    );
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? accounts.filter((a) => a.email.toLowerCase().includes(q) || (PROVIDER_LABEL[a.provider] ?? "").toLowerCase().includes(q))
      : accounts;
  }, [accounts, query]);
  // The chosen one, or the first, so the detail panel is never empty while there are accounts.
  const selected = accounts.find((a) => a.id === selectedId) ?? shown[0] ?? null;
  const needsReview = accounts.filter((a) => a.status === "REAUTH_REQUIRED" || a.status === "ERROR");

  return (
    <SettingsWorkspace
      section={section}
      actions={
        <button type="button" className="zoiko-btn pri" onClick={() => setShowConnect((v) => !v)} aria-expanded={showConnect}>
          {showConnect ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {showConnect ? "Close" : "Connect mailbox"}
        </button>
      }
    >
      <SettingsNotice lead="Read-only connections." icon={ShieldCheck}>
        Zoiko Mail reads these accounts to find actions and follow-ups. It cannot send, change or delete anything in them, and you can disconnect at any time.
      </SettingsNotice>

      {callback && <Banner tone={callback.tone} onDismiss={() => setCallback(null)}>{callback.text}</Banner>}
      {showConnect && <ConnectPanel onDone={() => setShowConnect(false)} />}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        <section aria-label="Connections" className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--ink)]">Connections</h2>
            <span className="text-[11.5px] text-[var(--ink3)]">{accounts.length} linked</span>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connections…"
              aria-label="Search connections"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] pl-8 pr-3 text-[12.5px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] focus:border-[var(--accent)]"
            />
          </div>
          <p className="mt-4 flex justify-between text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">
            <span>Connected mailboxes</span>
            <span>Health</span>
          </p>

          {isLoading ? (
            <p className="flex items-center gap-2 py-8 text-[12.5px] text-[var(--ink3)]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading connections…
            </p>
          ) : error ? (
            <p role="alert" className="py-6 text-[12.5px] text-[var(--crit)]">Could not load your connections ({(error as Error).message}).</p>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Link2 className="h-9 w-9 text-[var(--ink3)]" aria-hidden />
              <p className="mt-3 text-[13px] font-medium text-[var(--ink2)]">No mailboxes connected</p>
              <p className="mt-1 text-[12px] text-[var(--ink3)]">Connect Gmail or Microsoft 365 to find actions in that mail.</p>
              {!showConnect && (
                <button type="button" className="zoiko-btn mt-4" onClick={() => setShowConnect(true)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Connect mailbox
                </button>
              )}
            </div>
          ) : shown.length === 0 ? (
            <p className="py-6 text-[12.5px] text-[var(--ink3)]">No connections match “{query}”.</p>
          ) : (
            <ul className="mt-2 space-y-1.5" data-testid="connection-list">
              {shown.map((a) => {
                const active = selected?.id === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        active ? "border-[var(--accent)] bg-[var(--zm-selected,var(--accent-soft))]" : "border-transparent hover:bg-[var(--s2)]"
                      }`}
                    >
                      <ProviderLogo provider={a.provider} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{PROVIDER_LABEL[a.provider] ?? a.provider}</span>
                        <span className="block truncate text-[11.5px] text-[var(--ink3)]">{a.email}</span>
                      </span>
                      <StatusPill value={a.status} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink3)]" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selected ? (
          <ConnectionDetail key={selected.id} account={selected} onDisconnected={() => setSelectedId(null)} />
        ) : (
          <section className="hidden items-center justify-center rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-[13px] text-[var(--ink3)] xl:flex">
            Connected mailboxes appear here, with what they can access and how they are syncing.
          </section>
        )}

        <aside className="flex flex-col gap-4 xl:col-span-2 2xl:col-span-1">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Governance & privacy
            </h2>
            <ul className="mt-3 space-y-3 text-[12.5px] text-[var(--ink2)]">
              <li className="flex gap-2"><Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden /> Read-only access — only the read scopes below are ever requested.</li>
              <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden /> Sign-in tokens are kept in secure storage, never with your workspace data.</li>
              <li className="flex gap-2"><Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden /> Disconnecting stops syncing straight away. You can reconnect any time.</li>
            </ul>
          </section>
          {needsReview.length > 0 && (
            <section className="rounded-2xl border border-[var(--warn)]/40 bg-[var(--warn-soft)] p-5" data-testid="needs-review">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
                <ShieldAlert className="h-4 w-4 text-[var(--warn)]" aria-hidden />
                {needsReview.length} connection{needsReview.length === 1 ? " needs" : "s need"} review
              </h2>
              <p className="mt-1.5 text-[12.5px] text-[var(--ink2)]">
                {needsReview.map((a) => a.email).join(", ")}. Other connections are unaffected.
              </p>
              <button type="button" className="zoiko-btn mt-3" onClick={() => setSelectedId(needsReview[0]!.id)}>
                Review connection <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </section>
          )}
        </aside>
      </div>
    </SettingsWorkspace>
  );
}

export function ConnectionDetail({ account: a, onDisconnected }: { account: Connector; onDisconnected: () => void }) {
  const sync = useSyncConnector();
  const disconnect = useDisconnectConnector();
  const googleAuth = useGoogleAuth();
  const microsoftAuth = useMicrosoftAuth();
  const events = useConnectorEvents(a.id);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = PROVIDER_LABEL[a.provider] ?? a.provider;
  const auth = a.provider === "GMAIL" ? googleAuth : microsoftAuth;
  const canSync = a.status !== "DISCONNECTED" && a.status !== "PENDING";

  const reconnect = () => {
    setProblem(null);
    auth.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err) => setProblem(`Could not start ${label} sign-in: ${(err as Error).message}`),
    });
  };

  return (
    <section aria-label={`${label} connection`} className="flex min-w-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)]" data-testid="connection-detail">
      <div className="flex flex-wrap items-start gap-4 border-b border-[var(--border)] p-5">
        <ProviderLogo provider={a.provider} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-semibold text-[var(--ink)]">{label}</h2>
          <p className="truncate text-[13px] text-[var(--ink3)]">{a.email}</p>
        </div>
        <StatusPill value={a.status} />
      </div>

      <div className="flex flex-col gap-5 p-5">
        {problem && <Banner tone="crit">{problem}</Banner>}
        {sync.isError && <Banner tone="crit">Sync failed: {(sync.error as Error).message}</Banner>}
        {a.status === "REAUTH_REQUIRED" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn-soft)] px-4 py-3">
            <ShieldAlert className="h-4 w-4 shrink-0 text-[var(--warn)]" aria-hidden />
            <p className="min-w-0 flex-1 text-[12.5px] text-[var(--ink)]">{label} needs you to sign in again before syncing can resume.</p>
            <button type="button" className="zoiko-btn pri sm" onClick={reconnect} disabled={auth.isPending}>
              {auth.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />} Reconnect
            </button>
          </div>
        )}
        {a.status === "PENDING" && (
          <p className="text-[12.5px] text-[var(--warn)]">Waiting for {label} to confirm — syncing starts once the connection is active.</p>
        )}

        <div>
          <h3 className="flex items-center justify-between text-[14px] font-semibold text-[var(--ink)]">
            Permission scope <span className="text-[11.5px] font-medium text-[var(--ink3)]">Least-privilege access</span>
          </h3>
          <ul className="mt-2 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]" data-testid="permission-scope">
            {a.scopes.map((scope) => (
              <ScopeRow key={scope} icon={Mail} title="Read mail" description={SCOPES[scope] ?? scope} granted="Read" />
            ))}
            <ScopeRow icon={Send} title="Send mail" description="Send messages as this account" />
            <ScopeRow icon={Pencil} title="Change or delete mail" description="Move, label or delete messages" />
          </ul>
        </div>

        <dl className="grid gap-3 rounded-xl border border-[var(--border)] p-4 text-[12.5px] sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-[var(--ink)]">Connected account</dt>
            <dd className="mt-0.5 truncate text-[var(--ink3)]">{a.email}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">Last sync</dt>
            <dd className="mt-0.5 text-[var(--ink3)]">{when(a.lastSyncedAt)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">Connected</dt>
            <dd className="mt-0.5 text-[var(--ink3)]">{when(a.createdAt)}</dd>
          </div>
          {a.lastErrorCode && (
            <div className="sm:col-span-3">
              <dt className="font-semibold text-[var(--crit)]">Last error</dt>
              <dd className="mt-0.5 text-[var(--ink3)]">{humanize(a.lastErrorCode)}</dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="zoiko-btn pri" onClick={() => sync.mutate(a.id)} disabled={!canSync || sync.isPending}>
            {sync.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" className="zoiko-btn crit" onClick={() => setConfirming(true)} disabled={disconnect.isPending}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Disconnect
          </button>
        </div>

        <div>
          <h3 className="flex items-center justify-between text-[14px] font-semibold text-[var(--ink)]">
            Recent connection activity
            {events.data && events.data.length > 0 && (
              <span className="text-[11.5px] font-medium text-[var(--ink3)]">Latest {Math.min(events.data.length, 6)}</span>
            )}
          </h3>
          <Activity events={events.data} loading={events.isLoading} failed={events.isError} />
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          disconnect.mutate(a.id, { onSuccess: onDisconnected });
        }}
        title="Disconnect this mailbox?"
        message={`Syncing from ${a.email} stops, and actions found in it will no longer update. You can reconnect any time.`}
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
      />
    </section>
  );
}

function ScopeRow({ icon: Icon, title, description, granted }: { icon: typeof Mail; title: string; description: string; granted?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-[var(--ink)]">{title}</span>
        <span className="block text-[11.5px] text-[var(--ink3)]">{description}</span>
      </span>
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
          granted ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "bg-[var(--s2)] text-[var(--ink3)]"
        }`}
      >
        {granted ?? "Not granted"}
      </span>
    </li>
  );
}

function Activity({ events, loading, failed }: { events: ConnectorEvent[] | undefined; loading: boolean; failed: boolean }) {
  if (loading) return <p className="mt-2 text-[12.5px] text-[var(--ink3)]">Loading activity…</p>;
  if (failed) return <p className="mt-2 text-[12.5px] text-[var(--crit)]">Could not load recent activity.</p>;
  if (!events || events.length === 0) return <p className="mt-2 text-[12.5px] text-[var(--ink3)]">No activity from this account yet.</p>;
  return (
    <ul className="mt-2 divide-y divide-[var(--border)]" data-testid="connection-activity">
      {events.slice(0, 6).map((e) => {
        const failedEvent = Boolean(e.errorCode) || /FAIL|ERROR|DEAD/i.test(e.processingStatus);
        return (
          <li key={e.id} className="flex items-center gap-3 py-2.5 text-[12.5px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${failedEvent ? "bg-[var(--crit)]" : "bg-[var(--accent)]"}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[var(--ink)]">
              {humanize(e.eventType)}
              {failedEvent && <span className="text-[var(--crit)]"> · {humanize(e.errorCode ?? e.processingStatus)}</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--ink3)]">
              <Clock className="h-3 w-3" aria-hidden /> {when(e.receivedAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Google and Microsoft sign-in, and the manual registration the old page offered. */
function ConnectPanel({ onDone }: { onDone: () => void }) {
  const googleAuth = useGoogleAuth();
  const microsoftAuth = useMicrosoftAuth();
  const create = useCreateConnector();
  const [problem, setProblem] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [provider, setProvider] = useState<ConnectorProvider>("GMAIL");
  const [email, setEmail] = useState("");
  const [providerAccountId, setProviderAccountId] = useState("");
  const busy = googleAuth.isPending || microsoftAuth.isPending;

  const start = (which: ConnectorProvider) => {
    setProblem(null);
    (which === "GMAIL" ? googleAuth : microsoftAuth).mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err) => setProblem(`Could not start ${PROVIDER_LABEL[which]} sign-in: ${(err as Error).message}`),
    });
  };

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !providerAccountId.trim()) return;
    create.mutate(
      { provider, email: email.trim(), providerAccountId: providerAccountId.trim(), scopes: READONLY_SCOPES[provider] },
      { onSuccess: onDone }
    );
  };

  const field =
    "h-10 rounded-lg border border-[var(--border)] bg-[var(--ground)] px-3 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <section aria-label="Connect a mailbox" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="connect-panel">
      <h2 className="text-[15px] font-semibold text-[var(--ink)]">Connect a mailbox</h2>
      <p className="mt-0.5 text-[12.5px] text-[var(--ink3)]">You will sign in with the provider and approve read-only access.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["GMAIL", "MICROSOFT_365"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => start(p)}
            disabled={busy}
            className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--ground)] p-3 text-left transition hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
          >
            <ProviderLogo provider={p} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-[var(--ink)]">Continue with {p === "GMAIL" ? "Google" : "Microsoft 365"}</span>
              <span className="block text-[11.5px] text-[var(--ink3)]">{p === "GMAIL" ? "Gmail and Google Workspace" : "Outlook and Exchange Online"}</span>
            </span>
            {(p === "GMAIL" ? googleAuth : microsoftAuth).isPending && <Loader2 className="h-4 w-4 animate-spin text-[var(--ink3)]" aria-hidden />}
          </button>
        ))}
      </div>
      {problem && <p role="alert" className="mt-3 text-[12.5px] text-[var(--crit)]">{problem}</p>}

      <button type="button" onClick={() => setShowManual((v) => !v)} className="mt-4 text-[12px] text-[var(--ink3)] hover:text-[var(--ink2)]" aria-expanded={showManual}>
        {showManual ? "Hide manual registration" : "Register an existing account manually"}
      </button>
      {showManual && (
        <form onSubmit={submitManual} className="mt-3 space-y-3">
          <p className="text-[12px] text-[var(--ink3)]">Registers an already-authorized, read-only account without the provider&rsquo;s consent screen.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select aria-label="Provider" value={provider} onChange={(e) => setProvider(e.target.value as ConnectorProvider)} className={field}>
              <option value="GMAIL">Gmail</option>
              <option value="MICROSOFT_365">Microsoft 365</option>
            </select>
            <input type="email" aria-label="Account email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Account email" required className={`flex-1 ${field}`} />
          </div>
          <input aria-label="Provider account ID" value={providerAccountId} onChange={(e) => setProviderAccountId(e.target.value)} placeholder="Provider account ID (e.g. gmail-user-0001)" required className={`w-full ${field}`} />
          <div className="flex items-center gap-3">
            <button type="submit" className="zoiko-btn pri" disabled={create.isPending || !email.trim() || !providerAccountId.trim()}>
              {create.isPending ? "Connecting…" : "Connect"}
            </button>
            <span className="text-[11.5px] text-[var(--ink3)]">Scope: {READONLY_SCOPES[provider][0]}</span>
          </div>
          {create.isError && <p className="text-[12px] text-[var(--crit)]">Could not connect — check the fields (this account may already be linked).</p>}
        </form>
      )}
    </section>
  );
}
