"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ApiError } from "@/lib/api-client";
import { useLogout, useMe } from "@/lib/auth-hooks";
import {
  fetchSupportDiagnostics,
  fetchSupportOverview,
  fetchTenantSupportOverview,
  fetchTenantMailboxes,
  fetchTenantDomains,
  listTenantProviderEvents,
  listTenantDeliveryEvents,
  listTenantJobs,
  listTenantSuppressions,
  listTenantAudit,
  type SupportAccessGrant,
  type SupportDiagnosticsData,
  type SupportOverview,
  type TenantMailbox,
  type TenantDomain,
  type TenantProviderEvent,
  type TenantDeliveryEvent,
  type TenantJob,
  type TenantSuppression,
  type TenantAuditEvent,
  type TenantOverviewData,
  type TenantListParams,
} from "@/lib/support-api";
import { useLiveRefresh } from "@/lib/support-hooks";
import { supportStyles } from "@/components/support/support-styles";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  Activity,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Cog,
  Globe,
  KeyRound,
  Mail,
  ScrollText,
  Search,
  Send,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The tenant-scoped support console.
 *
 * This is what a workspace Support member (invited by the Owner with the
 * SUPPORT role) reaches at /support. Scope is limited to the member's own
 * workspace by the backend — /support/overview and /support/diagnostics are
 * tenant-context routes gated to OWNER / ADMIN / SUPPORT, and diagnostics only
 * run against an active grant an Owner or Admin approved. Fleet-wide tools
 * (all tenants, provider events, jobs, …) are staff-only and deliberately do
 * not exist here.
 */
type TabId = "overview" | "mailboxes" | "domains" | "provider-events" | "delivery-events" | "jobs" | "suppressions" | "audit" | "diagnostics" | "access";

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: "overview", label: "Workspace Overview", icon: "◈" },
  { id: "mailboxes", label: "Mailboxes", icon: "✉" },
  { id: "domains", label: "Domains", icon: "⊞" },
  { id: "provider-events", label: "Provider Events", icon: "⇄" },
  { id: "delivery-events", label: "Delivery Events", icon: "✉" },
  { id: "jobs", label: "Jobs", icon: "⚙" },
  { id: "suppressions", label: "Suppressions", icon: "⊘" },
  { id: "audit", label: "Audit Logs", icon: "🛡" },
  { id: "diagnostics", label: "Diagnostics", icon: "⚒" },
  { id: "access", label: "Access & Scope", icon: "🗝" },
];

function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pillOf(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (!s || s === "unknown") return "nu";
  if (/fail|error|crit|dead|revok|bounce|reject/.test(s)) return "crit";
  if (/pend|retry|warn|degrad|unverified|processing|queued|hold|expired/.test(s)) return "warn";
  if (/ok|active|complete|verified|success|deliver|open|resolved|enabled|sending/.test(s)) return "ok";
  return "nu";
}

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

function grantActive(grant: SupportAccessGrant): boolean {
  if (grant.revokedAt) return false;
  if (grant.expiresAt) {
    const exp = new Date(grant.expiresAt).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return false;
  }
  return true;
}

function LoadErr({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)" }}>
      <b>⚠</b>
      <div style={{ flex: 1 }}>{error}</div>
      <button className="btn sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div className="bd pad" style={{ color: "var(--ink3)", fontSize: "12px" }}>
      Loading…
    </div>
  );
}

function Pill({ status }: { status: string | null | undefined }) {
  return <span className={`pill ${pillOf(status)}`}>{status ?? "—"}</span>;
}

// ---------------------------------------------------------------------------
// Generic list hook for the collection pages.
// ---------------------------------------------------------------------------

function useList<T>(
  fetchFn: (p: TenantListParams) => Promise<Record<string, T[]>>,
  key: string,
) {
  const [params, setParams] = useState<TenantListParams>({ limit: 50 });
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFn(params)
      .then((res) => {
        if (!cancelled) setRows(res[key] ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([]);
          setError(apiErrorMessage(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchFn, key, params, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Runbook §5 sets a fifteen-minute initial response for a P0, which a
  // screen that only loads once cannot support: the operator would have to
  // keep pressing refresh to find out anything had happened. Every list in
  // this console keeps itself current, and pauses while the tab is hidden.
  useLiveRefresh(reload);

  return { params, setParams, rows, loading, error, reload };
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function overviewStats(o: SupportOverview) {
  const s = o.stats;
  return [
    { label: "Members", val: s.members, sub: "workspace members", icon: Users },
    { label: "Mailboxes", val: s.mailboxes, sub: "mailboxes", icon: Mail },
    { label: "Domains", val: s.domains, sub: "configured domains", icon: Globe },
    { label: "Active grants", val: s.activeGrants, sub: "diagnostics access", icon: KeyRound },
    { label: "Open commitments", val: s.openCommitments, sub: "member commitments", icon: Activity },
    { label: "Issues", val: s.issues, sub: "open issues", icon: AlertTriangle },
    { label: "Failed messages 24h", val: s.failedMessages24h, tone: s.failedMessages24h > 0 ? "crit" : "ok", sub: "messages", icon: Send },
    { label: "Failed deliveries 24h", val: s.failedDeliveries24h, tone: s.failedDeliveries24h > 0 ? "warn" : "ok", sub: "deliveries", icon: BellRing },
    { label: "Retry jobs", val: s.retryJobs, tone: s.retryJobs > 0 ? "warn" : "ok", sub: "scheduled to retry", icon: Cog },
    { label: "Failed jobs", val: s.failedJobs, tone: s.failedJobs > 0 ? "crit" : "ok", sub: "exhausted retries", icon: AlertTriangle },
    { label: "Delivery events 24h", val: s.deliveryEvents24h, sub: "events", icon: ScrollText },
  ] as Array<{ label: string; val: number; tone?: string; sub: string; icon: LucideIcon }>;
}

export default function TenantSupportConsole() {
  const logout = useLogout();
  const meQuery = useMe();
  const me = meQuery.data;
  const [tab, setTab] = useState<TabId>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);

  const [overview, setOverview] = useState<SupportOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [diagGrant, setDiagGrant] = useState<string | null>(null);
  const [diagState, setDiagState] = useState<
    Record<string, { status: "loading" } | { status: "done"; data: SupportDiagnosticsData } | { status: "error"; message: string }>
  >({});

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await fetchSupportOverview();
      setOverview(data);
      const firstActive = data.grants.find(grantActive)?.id;
      if (firstActive) setDiagGrant((cur) => cur ?? firstActive);
    } catch (e) {
      setOverviewError(apiErrorMessage(e));
    } finally {
      setOverviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A grant ends by itself. An expiry only noticed on reload is one the
  // screen misreports for as long as the tab stays open, and §7 wants the
  // expiry to be the control rather than a note about one.
  useLiveRefresh(() => void loadOverview(), 60_000);

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runDiagnostics = useCallback(
    async (grantId: string) => {
      setDiagGrant(grantId);
      setDiagState((prev) => ({ ...prev, [grantId]: { status: "loading" } }));
      try {
        const data = await fetchSupportDiagnostics(grantId);
        setDiagState((prev) => ({ ...prev, [grantId]: { status: "done", data } }));
      } catch (e) {
        setDiagState((prev) => ({ ...prev, [grantId]: { status: "error", message: apiErrorMessage(e) } }));
      }
    },
    []
  );

  const activeGrants = overview?.grants.filter(grantActive) ?? [];

  return (
    <div className="support-workspace">
      <style jsx global>
        {supportStyles}
      </style>

      {mobileOpen && (
        <div className="drawer">
          <div className="scrim" onClick={() => setMobileOpen(false)} />
          <div className="panel">
            <div className="drawerhead">
              <Image src="/ZoikoMail_Logo_DarkBG_PNG.png" width={400} height={100} className="h-10 w-auto" alt="Zoiko Mail" priority />
              <button className="menubtn" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                ✕
              </button>
            </div>
            <RailMenu
              current={tab}
              onNavigate={(id) => {
                setTab(id);
                setMobileOpen(false);
              }}
            />
          </div>
        </div>
      )}

      <div className="shell">
        <nav className="rail">
          <div className="rail-brand">
            <Image src="/ZoikoMail_Logo_DarkBG_PNG.png" width={400} height={100} className="h-10 w-auto" alt="Zoiko Mail" priority />
          </div>
          <RailMenu current={tab} onNavigate={setTab} />
        </nav>

        <div className="body">
          <div className="topbar">
            <button className="menubtn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              ☰
            </button>
            <div className="brand">
              <span className="bname">Support</span>
              <span className="bsub">{me?.tenant?.name ?? "Workspace"}</span>
            </div>
            <div className="sp" />
            <ThemeToggle />
            <span className="pill accent">Support member</span>
            <div className="who">
              <div className="avatar">{initials(me?.displayName)}</div>
              <div>
                <b>{me?.displayName ?? "Support member"}</b>
                <span>{me?.membership?.role ?? "SUPPORT"} · {me?.tenant?.name ?? ""}</span>
              </div>
              <button className="btn sm" onClick={() => logout.mutate()}>
                Log out
              </button>
            </div>
          </div>

          <main>
            <div className="page">
              <div className="crumbs">
                <span>Support Workspace</span>
                <span>/</span>
                <span className="cur">{TABS.find((t) => t.id === tab)?.label}</span>
              </div>

              <div className="pagehd">
                <div>
                  <h1>{TABS.find((t) => t.id === tab)?.label}</h1>
                  <p>Workspace support for {me?.tenant?.name ?? "your workspace"} — fleet-wide tools are staff-only.</p>
                </div>
              </div>

              {tab === "overview" &&
                (overviewLoading ? (
                  <Spinner />
                ) : overviewError ? (
                  <LoadErr error={overviewError} onRetry={loadOverview} />
                ) : (
                  <OverviewView data={overview!} />
                ))}

              {tab === "mailboxes" && <MailboxesPage />}
              {tab === "domains" && <DomainsPage />}
              {tab === "provider-events" && <ProviderEventsPage />}
              {tab === "delivery-events" && <DeliveryEventsPage />}
              {tab === "jobs" && <JobsPage />}
              {tab === "suppressions" && <SuppressionsPage />}
              {tab === "audit" && <AuditPage />}

              {tab === "diagnostics" &&
                (overviewLoading ? (
                  <Spinner />
                ) : overviewError ? (
                  <LoadErr error={overviewError} onRetry={loadOverview} />
                ) : (
                  <DiagnosticsView
                    grants={overview?.grants ?? []}
                    selected={diagGrant}
                    results={diagState}
                    onRun={runDiagnostics}
                    onSelect={setDiagGrant}
                  />
                ))}

              {tab === "access" && <AccessView grants={activeGrants.length} />}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function RailMenu({ current, onNavigate }: { current: TabId; onNavigate?: (id: TabId) => void }) {
  return (
    <>
      {TABS.map((t) => (
        <button key={t.id} className={`railitem ${current === t.id ? "on" : ""}`} onClick={() => onNavigate?.(t.id)}>
          <span className="ico">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewView({ data }: { data: SupportOverview }) {
  const stats = overviewStats(data);
  return (
    <div>
      <div className="stats">
        {stats.map((st) => (
          <div key={st.label} className={`stat ${st.tone ?? ""}`}>
            <div className="stt">
              <div className="lbl">{st.label}</div>
              <div className="ic">
                <st.icon className="h-4 w-4" />
              </div>
            </div>
            <div className="val">{st.val}</div>
            <div className="sub">{st.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="hd">
          <h2>Recent audit events</h2>
        </div>
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Actor</th>
                <th>Target</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No audit events yet.
                  </td>
                </tr>
              )}
              {data.audit.map((e) => (
                <tr key={e.id}>
                  <td className="nm">{e.eventType}</td>
                  <td>{e.actor ? `${e.actor.displayName} · ${e.actor.email}` : "—"}</td>
                  <td>{e.targetType ?? "—"}</td>
                  <td className="muted">{fmt(e.createdAt)} ({ago(e.createdAt)})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="hd">
            <h2>Support team</h2>
          </div>
          <div>
            {data.team.length === 0 && <div className="bd pad muted">No support members yet.</div>}
            {data.team.map((m) => (
              <div key={m.id} className="row">
                <div className="tx">
                  <b>{m.name}</b>
                  <span>{m.email}</span>
                </div>
                <div className="sp">
                  <Pill status={m.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="hd">
            <h2>Support grants</h2>
          </div>
          <div>
            {data.grants.length === 0 && (
              <div className="bd pad muted">
                No support grants yet. An Owner or Admin can create one to let
                support run diagnostics.
              </div>
            )}
            {data.grants.map((g) => (
              <div key={g.id} className="row">
                <div className="tx">
                  <b>{g.reason}</b>
                  <span>
                    {g.scopes.join(", ")} · {grantActive(g) ? `expires ${fmt(g.expiresAt)}` : g.revokedAt ? "revoked" : "expired"}
                  </span>
                </div>
                <div className="sp">
                  <Pill status={grantActive(g) ? "ACTIVE" : "REVOKED"} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

type DiagResult =
  | { status: "loading" }
  | { status: "done"; data: SupportDiagnosticsData }
  | { status: "error"; message: string };

function DiagnosticsView({
  grants,
  selected,
  results,
  onRun,
  onSelect,
}: {
  grants: SupportAccessGrant[];
  selected: string | null;
  results: Record<string, DiagResult>;
  onRun: (grantId: string) => void;
  onSelect: (grantId: string) => void;
}) {
  const active = grants.filter(grantActive);

  if (active.length === 0) {
    return (
      <div>
        <div className="notice">
          <b>No active grant</b>
          <div style={{ flex: 1 }}>
            Diagnostics run against an access grant, approved by a workspace
            Owner or Admin (Support &gt; Access &amp; Scope). Ask an
            administrator to create one before support can inspect mail flow.
          </div>
        </div>
      </div>
    );
  }

  const result = selected ? results[selected] : undefined;
  const current = active.find((g) => g.id === selected) ?? active[0];

  return (
    <div>
      <div className="card">
        <div className="bd pad">
          <div className="field">
            <label>Grant</label>
            <select className="fselect" value={current.id} onChange={(e) => onSelect(e.target.value)}>
              {active.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.reason} · {g.scopes.join(", ")}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ padding: "0 0 12px" }}>
            <div className="tx">
              <b>What this grant allows</b>
              <span>
                {current.scopes.join(", ")} · expires {fmt(current.expiresAt)}
              </span>
            </div>
            <div className="sp">
              <button className="btn pri sm" onClick={() => onRun(current.id)}>
                Run diagnostics
              </button>
            </div>
          </div>
        </div>
      </div>

      {result?.status === "loading" && <div className="bd pad muted">Running diagnostics…</div>}
      {result?.status === "error" && (
        <LoadErr error={result.message} onRetry={() => onRun(current.id)} />
      )}
      {result?.status === "done" && <DiagnosticsResults data={result.data} />}
    </div>
  );
}

function DiagnosticsResults({ data }: { data: SupportDiagnosticsData }) {
  const g = data.grant;
  return (
    <div>
      <div className="notice" style={{ background: "var(--ok-soft)", borderColor: "var(--ok)" }}>
        <b>✓</b>
        <div style={{ flex: 1 }}>
          Diagnostics completed under grant “{g.reason}” · {g.scopes.join(", ")}
        </div>
      </div>

      {data.tenant && (
        <div className="card">
          <div className="hd">
            <h2>Tenant</h2>
          </div>
          <div className="bd pad">
            <div className="kv">
              <span>Name</span>
              <span>{data.tenant.name}</span>
            </div>
            <div className="kv">
              <span>Status</span>
              <span>{data.tenant.status}</span>
            </div>
            <div className="kv">
              <span>Plan</span>
              <span>{data.tenant.planCode}</span>
            </div>
            <div className="kv">
              <span>Members</span>
              <span>{data.tenant.activeMembers}</span>
            </div>
            <div className="kv">
              <span>Mailboxes</span>
              <span>{data.tenant.mailboxes}</span>
            </div>
            <div className="kv">
              <span>Created</span>
              <span>{fmt(data.tenant.createdAt)}</span>
            </div>
          </div>
        </div>
      )}

      {data.domains && data.domains.length > 0 && (
        <div className="card">
          <div className="hd">
            <h2>Domain health</h2>
          </div>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Verification</th>
                  <th>MX</th>
                  <th>SPF</th>
                  <th>DKIM</th>
                  <th>DMARC</th>
                  <th>Last checked</th>
                </tr>
              </thead>
              <tbody>
                {data.domains.map((d) => (
                  <tr key={d.id}>
                    <td className="nm">{d.domainName}</td>
                    <td>
                      <Pill status={d.verificationStatus} />
                    </td>
                    <td>
                      <Pill status={d.mxStatus} />
                    </td>
                    <td>
                      <Pill status={d.spfStatus} />
                    </td>
                    <td>
                      <Pill status={d.dkimStatus} />
                    </td>
                    <td>
                      <Pill status={d.dmarcStatus} />
                    </td>
                    <td className="muted">{ago(d.lastCheckedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.delivery && data.delivery.length > 0 && (
        <div className="card">
          <div className="hd">
            <h2>Delivery breakdown</h2>
          </div>
          <div className="bd pad">
            {data.delivery.map((d) => (
              <div key={d.type} className="kv">
                <span>{d.type.replace(/_/g, " ")}</span>
                <span>{d._count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.audit && data.audit.length > 0 && (
        <div className="card">
          <div className="hd">
            <h2>Recent audit events</h2>
          </div>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Target</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((e) => (
                  <tr key={e.id}>
                    <td className="nm">{e.eventType}</td>
                    <td>{e.targetType ?? "—"}</td>
                    <td className="muted">{fmt(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI helpers for list pages
// ---------------------------------------------------------------------------

function FilterInputs({
  q,
  setQ,
  selectLabel,
  selectValue,
  selectOptions,
  setSelectValue,
  extraSelectLabel,
  extraSelectValue,
  extraSelectOptions,
  setExtraSelectValue,
  onApply,
  onReset,
}: {
  q: string;
  setQ: (v: string) => void;
  selectLabel: string;
  selectValue: string;
  selectOptions: string[];
  setSelectValue: (v: string) => void;
  extraSelectLabel?: string;
  extraSelectValue?: string;
  extraSelectOptions?: string[];
  setExtraSelectValue?: (v: string) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <div className="filterbar">
      <div className="searchin">
        <span>⌕</span>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <select className="fselect" value={selectValue} onChange={(e) => setSelectValue(e.target.value)}>
        <option value="">{selectLabel}</option>
        {selectOptions.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {extraSelectLabel !== undefined &&
        extraSelectValue !== undefined &&
        extraSelectOptions &&
        setExtraSelectValue && (
          <select
            className="fselect"
            value={extraSelectValue}
            onChange={(e) => setExtraSelectValue(e.target.value)}
          >
            <option value="">{extraSelectLabel}</option>
            {extraSelectOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}
      <button className="btn pri" onClick={onApply}>Apply</button>
      <button className="btn" onClick={onReset}>Reset</button>
    </div>
  );
}

function ListShell<T>({
  loading,
  error,
  onRetry,
  title,
  count,
  headers,
  rows,
  render,
  empty,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  title: string;
  count: number;
  headers: string[];
  rows: T[];
  render: (row: T, i: number) => React.ReactNode;
  empty: string;
}) {
  return (
    <div>
      {error && <LoadErr error={error} onRetry={onRetry} />}
      <div className="card">
        <div className="hd">
          <h2>{title}</h2>
          <div className="sp"><span className="pill nu">{count}</span></div>
        </div>
        {loading ? (
          <Spinner />
        ) : (
          <div className="bd">
            <Table headers={headers}>{rows.map(render)}</Table>
            {count === 0 && (
              <div className="bd pad muted" style={{ paddingTop: 12, paddingBottom: 16 }}>{empty}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tenant-scoped list pages
// ---------------------------------------------------------------------------

function MailboxesPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [mailboxes, setMailboxes] = useState<TenantMailbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTenantMailboxes(query, 200);
      setMailboxes(res.mailboxes);
    } catch (e) {
      setError(apiErrorMessage(e));
      setMailboxes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { search(""); }, [search]);

  return (
    <div>
      <div className="filterbar">
        <div className="gsearch" style={{ maxWidth: 360, marginLeft: 0 }}>
          <span>⌕</span>
          <input placeholder="Search mailboxes by address…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setApplied(q); search(q); } }} />
        </div>
        <button className="btn pri" onClick={() => { setApplied(q); search(q); }}>Search</button>
      </div>
      {error && <LoadErr error={error} onRetry={() => search(applied)} />}
      <div className="card">
        <div className="hd">
          <h2>{applied ? `Mailboxes matching "${applied}"` : "All mailboxes"}</h2>
          <div className="sp"><span className="pill nu">{mailboxes.length}</span></div>
        </div>
        <div className="bd">
          <Table headers={["Address", "Member", "Type", "Suspended", "Accounts", "Created"]}>
            {mailboxes.map((m) => (
              <tr key={m.id}>
                <td className="mo nm">{m.address}</td>
                <td>{m.memberName}</td>
                <td>{m.mailboxType}</td>
                <td><Pill status={m.suspended ? "suspended" : "active"} /></td>
                <td>{m.connectedAccounts.length}</td>
                <td className="muted">{ago(m.createdAt)}</td>
              </tr>
            ))}
            {mailboxes.length === 0 && !loading && (
              <tr><td colSpan={6} className="muted">No mailboxes found.</td></tr>
            )}
          </Table>
        </div>
      </div>
    </div>
  );
}

function DomainsPage() {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [domains, setDomains] = useState<TenantDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTenantDomains(query, 200);
      setDomains(res.domains);
    } catch (e) {
      setError(apiErrorMessage(e));
      setDomains([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { search(""); }, [search]);

  return (
    <div>
      <div className="filterbar">
        <div className="gsearch" style={{ maxWidth: 360, marginLeft: 0 }}>
          <span>⌕</span>
          <input placeholder="Search domains by name…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setApplied(q); search(q); } }} />
        </div>
        <button className="btn pri" onClick={() => { setApplied(q); search(q); }}>Search</button>
      </div>
      {error && <LoadErr error={error} onRetry={() => search(applied)} />}
      <div className="card">
        <div className="hd">
          <h2>{applied ? `Domains matching "${applied}"` : "All domains"}</h2>
          <div className="sp"><span className="pill nu">{domains.length}</span></div>
        </div>
        <div className="bd">
          <Table headers={["Domain", "Verification", "MX", "SPF", "DKIM", "DMARC", "Sending", "Checked"]}>
            {domains.map((d) => (
              <tr key={d.id}>
                <td className="mo nm">{d.domainName}</td>
                <td><Pill status={d.verificationStatus} /></td>
                <td><Pill status={d.mxStatus} /></td>
                <td><Pill status={d.spfStatus} /></td>
                <td><Pill status={d.dkimStatus} /></td>
                <td><Pill status={d.dmarcStatus} /></td>
                <td><Pill status={d.sendingEnabled ? "enabled" : "disabled"} /></td>
                <td className="muted">{ago(d.lastCheckedAt)}</td>
              </tr>
            ))}
            {domains.length === 0 && !loading && (
              <tr><td colSpan={8} className="muted">No domains found.</td></tr>
            )}
          </Table>
        </div>
      </div>
    </div>
  );
}

function ProviderEventsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<TenantProviderEvent>(listTenantProviderEvents, "events");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");

  return (
    <div>
      <FilterInputs
        q={q}
        setQ={setQ}
        selectLabel="Status"
        selectValue={status}
        selectOptions={["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "DEAD", "IGNORED"]}
        setSelectValue={setStatus}
        extraSelectLabel="Provider"
        extraSelectValue={provider}
        extraSelectOptions={["GMAIL", "OUTLOOK", "GENERIC"]}
        setExtraSelectValue={setProvider}
        onApply={() => setParams({ q, status, provider, limit: 50 })}
        onReset={() => { setQ(""); setStatus(""); setProvider(""); setParams({ limit: 50 }); }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Provider Events"
        count={rows.length}
        headers={["Provider", "Account", "Event", "Processing", "Error", "Attempts", "Received"]}
        rows={rows}
        render={(ev) => (
          <tr key={ev.id}>
            <td>{ev.provider}</td>
            <td className="mo">{ev.accountEmail || "—"}</td>
            <td className="mo">{ev.eventType}</td>
            <td><Pill status={ev.processingStatus} /></td>
            <td className="mo muted">{ev.errorCode ?? "—"}</td>
            <td className="mo">{ev.attempts}/{ev.maxAttempts}</td>
            <td className="muted">{ago(ev.receivedAt)}</td>
          </tr>
        )}
        empty="No provider events match."
      />
    </div>
  );
}

function DeliveryEventsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<TenantDeliveryEvent>(listTenantDeliveryEvents, "events");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");

  return (
    <div>
      <FilterInputs
        q={q}
        setQ={setQ}
        selectLabel="Type"
        selectValue={type}
        selectOptions={["BOUNCE", "COMPLAINT", "DELIVERY", "OPEN", "CLICK", "SYNC_ERROR", "RATE_LIMIT"]}
        setSelectValue={setType}
        onApply={() => setParams({ q, type, limit: 50 })}
        onReset={() => { setQ(""); setType(""); setParams({ limit: 50 }); }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Delivery Events"
        count={rows.length}
        headers={["Type", "Subject", "Failure", "Created"]}
        rows={rows}
        render={(ev) => (
          <tr key={ev.id}>
            <td><Pill status={ev.type} /></td>
            <td className="muted">{ev.message?.subject ?? "—"}</td>
            <td className="mo muted">{ev.failureCode ? `${ev.failureCode}${ev.failureReason ? ` · ${ev.failureReason}` : ""}` : "—"}</td>
            <td className="muted">{ago(ev.createdAt)}</td>
          </tr>
        )}
        empty="No delivery events match."
      />
    </div>
  );
}

function JobsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<TenantJob>(listTenantJobs, "jobs");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  return (
    <div>
      <FilterInputs
        q={q}
        setQ={setQ}
        selectLabel="Status"
        selectValue={status}
        selectOptions={["PENDING", "RUNNING", "RETRY", "FAILED", "COMPLETED", "DEAD"]}
        setSelectValue={setStatus}
        extraSelectLabel="Type"
        extraSelectValue={type}
        extraSelectOptions={["REFRESH_TOKEN", "FULL_SYNC", "MAILBOX_SYNC", "MESSAGE_SYNC", "NOTIFY", "SUPPRESS", "RETRY_SEND"]}
        setExtraSelectValue={setType}
        onApply={() => setParams({ q, status, type, limit: 50 })}
        onReset={() => { setQ(""); setStatus(""); setType(""); setParams({ limit: 50 }); }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Background Jobs"
        count={rows.length}
        headers={["Type", "Status", "Attempts", "Run At", "Completed", "Last Error"]}
        rows={rows}
        render={(job) => (
          <tr key={job.id}>
            <td><span className="pill accent">{job.type}</span></td>
            <td><Pill status={job.status} /></td>
            <td className="mo">{job.attempts}/{job.maxAttempts}</td>
            <td className="muted">{ago(job.runAt)}</td>
            <td className="muted">{job.completedAt ? ago(job.completedAt) : "—"}</td>
            <td className="mo muted">{job.lastError ?? "—"}</td>
          </tr>
        )}
        empty="No jobs match."
      />
    </div>
  );
}

function SuppressionsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<TenantSuppression>(listTenantSuppressions, "suppressions");
  const [q, setQ] = useState("");

  return (
    <div>
      <FilterInputs
        q={q}
        setQ={setQ}
        selectLabel="Active"
        selectValue={params.status ?? ""}
        selectOptions={["true", "false"]}
        setSelectValue={(v) => setParams({ ...params, status: v })}
        onApply={() => setParams({ q, status: params.status, limit: 50 })}
        onReset={() => { setQ(""); setParams({ limit: 50 }); }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Suppressions"
        count={rows.length}
        headers={["Email Hash", "Reason", "Active", "Since"]}
        rows={rows}
        render={(sp) => (
          <tr key={sp.id}>
            <td className="mo">{sp.emailHash}</td>
            <td>{sp.reason}</td>
            <td><Pill status={sp.active ? "active" : "inactive"} /></td>
            <td className="muted">{ago(sp.createdAt)}</td>
          </tr>
        )}
        empty="No suppressions found."
      />
    </div>
  );
}

function AuditPage() {
  const { params, setParams, rows, loading, error, reload } = useList<TenantAuditEvent>(listTenantAudit, "events");
  const [q, setQ] = useState("");

  return (
    <div>
      <FilterInputs
        q={q}
        setQ={setQ}
        selectLabel="Result"
        selectValue=""
        selectOptions={["SUCCESS", "DENIED", "FAILED"]}
        setSelectValue={() => {}}
        onApply={() => setParams({ q, limit: 50 })}
        onReset={() => { setQ(""); setParams({ limit: 50 }); }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Audit Logs"
        count={rows.length}
        headers={["Event", "Actor", "Resource", "Result", "When"]}
        rows={rows}
        render={(ev) => (
          <tr key={ev.id}>
            <td><span className="pill nu">{ev.eventType}</span></td>
            <td>{ev.actor?.displayName ?? ev.actor?.email ?? "system"}</td>
            <td className="mo muted">{ev.resource ? `${ev.resource}` : "—"}</td>
            <td><Pill status={ev.result} /></td>
            <td className="muted">{fmt(ev.createdAt)}</td>
          </tr>
        )}
        empty="No audit events match."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access & scope
// ---------------------------------------------------------------------------

function AccessView({ grants }: { grants: number }) {
  return (
    <div className="split">
      <div className="card">
        <div className="hd">
          <h2>What you can do</h2>
        </div>
        <div className="bd pad">
          <ul className="access-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: "var(--ok-soft)", color: "var(--ok)", display: "grid", placeItems: "center", flex: "none" }}>
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: "12.4px", display: "block" }}>Workspace health overview</b>
                <span className="muted" style={{ fontSize: "10.8px" }}>
                  Members, mailboxes, domains, job and delivery health for this workspace only.
                </span>
              </span>
            </li>
            <li style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: "var(--ok-soft)", color: "var(--ok)", display: "grid", placeItems: "center", flex: "none" }}>
                <Search className="h-4 w-4" />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: "12.4px", display: "block" }}>Scoped diagnostics</b>
                <span className="muted" style={{ fontSize: "10.8px" }}>
                  DNS and delivery diagnostics for this workspace, run against a
                  grant approved by an Owner or Admin.
                </span>
              </span>
            </li>
            <li style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 28, height: 28, borderRadius: 6, background: "var(--ok-soft)", color: "var(--ok)", display: "grid", placeItems: "center", flex: "none" }}>
                <ScrollText className="h-4 w-4" />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: "12.4px", display: "block" }}>Recent audit events</b>
                <span className="muted" style={{ fontSize: "10.8px" }}>What changed recently in this workspace.</span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h2>What is out of scope</h2>
        </div>
        <div className="bd pad">
          <p className="muted" style={{ fontSize: "11.8px", marginTop: 0 }}>
            Fleet-wide tools — every tenant, provider and mailbox, provider
            events, background jobs, support grants administration and the
            ticket queue — are reserved for the Zoiko support team (staff
            console). A workspace Support member cannot see them, and the
            backend refuses those requests for non-staff sessions.
          </p>
          <div className="kv">
            <span>Active grants</span>
            <span>{grants}</span>
          </div>
          <div className="kv">
            <span>Can create grants?</span>
            <span>No — Owner or Admin</span>
          </div>
          <div className="kv">
            <span>Can manage tickets?</span>
            <span>Staff only</span>
          </div>
        </div>
      </div>
    </div>
  );
}