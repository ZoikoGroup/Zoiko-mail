"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api-client";
import { getPlatformToken, isLoggedIn } from "@/lib/auth-storage";
import { useLogout } from "@/lib/auth-hooks";
import {
  fetchPlatformDiagnostics,
  fetchPlatformOverview,
  fetchTenantOverview,
  listPlatformAudit,
  listPlatformDeliveryEvents,
  listPlatformGrants,
  listPlatformJobs,
  listPlatformProviderEvents,
  listPlatformSuppressions,
  revokePlatformGrant,
  searchPlatformTenants,
  type PlatformAuditEvent,
  type PlatformDeliveryEvent,
  type PlatformGrant,
  type PlatformIssue,
  type PlatformJob,
  type PlatformListParams,
  type PlatformOverview,
  type PlatformProviderEvent,
  type PlatformSuppression,
  type PlatformTenant,
  type SupportDiagnosticsData,
  type TenantOverview,
} from "@/lib/support-api";
import { supportStyles } from "@/components/support/SupportWorkspace";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

type PageId = "overview" | "tenants" | "provider-events" | "delivery-events" | "jobs" | "audit" | "grants";

const PAGES: Array<{ id: PageId; label: string; icon: string }> = [
  { id: "overview", label: "Platform Overview", icon: "◈" },
  { id: "tenants", label: "Tenants", icon: "▣" },
  { id: "provider-events", label: "Provider Events", icon: "⇄" },
  { id: "delivery-events", label: "Delivery Events", icon: "✉" },
  { id: "jobs", label: "Jobs", icon: "⚙" },
  { id: "audit", label: "Audit", icon: "🛡" },
  { id: "grants", label: "Support Grants", icon: "🗝" },
];

function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong";
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

function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return iso;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function pillOf(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (!s || s === "unknown") return "nu";
  if (/fail|error|crit|dead|revok|bounce|reject/.test(s)) return "crit";
  if (/pend|retry|warn|degrad|unverified|processing|queued|hold|ready|scheduled/.test(s)) return "warn";
  if (/ok|active|complete|verified|success|deliver|open|resolved|enabled|ready/.test(s)) return "ok";
  return "nu";
}

function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function val(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Generic list hook for the collection pages.
// ---------------------------------------------------------------------------

function useList<T>(
  fetchFn: (p: PlatformListParams) => Promise<Record<string, T[]>>,
  key: string,
) {
  const [params, setParams] = useState<PlatformListParams>({ limit: 50 });
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
  return { params, setParams, rows, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

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

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
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
  );
}

function Pill({ status }: { status: string | null | undefined }) {
  return <span className={`pill ${pillOf(status)}`}>{status ?? "—"}</span>;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function OverviewPage({
  data,
  onOpenTenant,
}: {
  data: PlatformOverview | null;
  onOpenTenant: (tenantId: string) => void;
}) {
  if (!data) return null;
  const s = data.stats;
  const stats: Array<{ label: string; val: string | number; tone: string; sub: string }> = [
    { label: "Active Tenants", val: s.activeTenants, tone: "", sub: "across the platform" },
    { label: "Members", val: s.tenantMembers, tone: "", sub: "tenant users" },
    { label: "Active Mailboxes", val: s.activeMailboxes, tone: "", sub: "connected inboxes" },
    { label: "Configured Domains", val: s.configuredDomains, tone: "", sub: "verified + pending" },
    { label: "Provider Accounts", val: s.providerAccounts, tone: "", sub: "connected OAuth accounts" },
    { label: "Failed Sends 24h", val: s.failedSends24h, tone: s.failedSends24h > 0 ? "crit" : "ok", sub: "rejected / bounced" },
    { label: "Sync Failures 24h", val: s.syncFailures24h, tone: s.syncFailures24h > 0 ? "warn" : "ok", sub: "provider webhook errors" },
    { label: "Failed Jobs", val: s.failedJobs, tone: s.failedJobs > 0 ? "crit" : "ok", sub: "exhausted retries" },
    { label: "Retry Jobs", val: s.retryJobs, tone: s.retryJobs > 0 ? "warn" : "ok", sub: "scheduled to retry" },
  ];

  return (
    <div>
      <div className="stats">
        {stats.map((st) => (
          <div key={st.label} className={`stat ${st.tone}`}>
            <div className="lbl">{st.label}</div>
            <div className="val">{st.val}</div>
            <div className="sub">{st.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="hd">
          <h2>Provider Health Matrix</h2>
        </div>
        <div className="bd">
          <Table headers={["Provider", "Accounts", "Status", "Count"]}>
            {data.providerHealth.matrix.map((m, i) => (
              <tr key={`${m.provider}-${m.status}-${i}`}>
                <td className="nm">{m.provider || "unknown"}</td>
                <td>{m.count}</td>
                <td>
                  <Pill status={m.status} />
                </td>
                <td className="mo">{m.count}</td>
              </tr>
            ))}
            {data.providerHealth.matrix.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No provider accounts connected yet.
                </td>
              </tr>
            )}
          </Table>
        </div>
      </div>

      <div className="card">
        <div className="hd">
          <h2>Cross-Tenant Issues</h2>
          <div className="sp">
            <span className="pill warn">{data.issues.filter((i) => i.status === "OPEN").length} open</span>
          </div>
        </div>
        <div className="bd">
          <Table
            headers={["Kind", "Tenant", "Resource", "Status", "Error", "Since"]}
          >
            {data.issues.map((issue: PlatformIssue) => (
              <tr
                key={issue.id}
                className="clickable"
                onClick={() => onOpenTenant(issue.tenantId)}
              >
                <td>
                  <span className="pill accent">{issue.kind}</span>
                </td>
                <td className="nm">{issue.tenantName}</td>
                <td className="mo">
                  {issue.resourceType} · {shortId(issue.resource)}
                </td>
                <td>
                  <Pill status={issue.status} />
                </td>
                <td className="mo muted">{issue.error ?? "—"}</td>
                <td className="muted">{ago(issue.createdAt)}</td>
              </tr>
            ))}
            {data.issues.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No open issues across the platform.
                </td>
              </tr>
            )}
          </Table>
        </div>
      </div>
    </div>
  );
}

function TenantDetail({ tenant, onBack }: { tenant: TenantOverview; onBack: () => void }) {
  const t = tenant.tenant;
  const counts = t._count ?? {};
  const sections: Array<{
    label: string;
    rows: Array<Record<string, unknown>>;
    cols: string[];
    renderCell?: (row: Record<string, unknown>, col: string) => string;
  }> = [
    { label: `Members (${tenant.members.length})`, rows: tenant.members, cols: ["name", "email", "role", "status"] },
    { label: `Mailboxes (${tenant.mailboxes.length})`, rows: tenant.mailboxes, cols: ["email", "provider", "status", "isPrimary"] },
    { label: `Domains (${tenant.domains.length})`, rows: tenant.domains, cols: ["domainName", "verificationStatus", "mxStatus", "spfStatus", "dkimStatus", "dmarcStatus"] },
    { label: `Connected Accounts (${tenant.connectedAccounts.length})`, rows: tenant.connectedAccounts, cols: ["email", "provider", "accountStatus", "lastSyncAt"] },
    { label: `Provider Events (${tenant.providerEvents.length})`, rows: tenant.providerEvents, cols: ["provider", "accountEmail", "eventType", "processingStatus", "errorCode", "receivedAt"] },
    { label: `Delivery Events (${tenant.deliveryEvents.length})`, rows: tenant.deliveryEvents, cols: ["type", "failureCode", "failureReason", "createdAt"] },
    { label: `Jobs (${tenant.jobs.length})`, rows: tenant.jobs, cols: ["type", "status", "attempts", "runAt", "completedAt", "lastError"] },
    {
      label: `Audit (${tenant.audit.length})`,
      rows: tenant.audit,
      cols: ["eventType", "actor", "resource", "result", "createdAt"],
      renderCell: (row, col) => {
        if (col === "actor") {
          const a = row.actor;
          if (a && typeof a === "object") {
            const rec = a as Record<string, unknown>;
            return String(rec.displayName ?? rec.email ?? "system");
          }
          return "system";
        }
        return val(row, col);
      },
    },
  ];

  return (
    <div>
      <button className="btn sm" onClick={onBack}>
        ← Back to tenants
      </button>

      <div className="pagehd" style={{ marginTop: 14 }}>
        <div>
          <h1>{t.name}</h1>
          <p>
            {t.id} · created {fmt(t.createdAt)}
          </p>
        </div>
        <div className="sp">
          <Pill status={t.status} />
          <span className="pill accent">{t.planCode || "no plan"}</span>
        </div>
      </div>

      <div className="stats">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="stat">
            <div className="lbl">{k}</div>
            <div className="val">{String(v)}</div>
          </div>
        ))}
      </div>

      {sections.map((sec) => (
        <div key={sec.label} className="card">
          <div className="hd">
            <h2>{sec.label}</h2>
          </div>
          <div className="bd">
            <Table headers={sec.cols.map((c) => c)}>
              {sec.rows.map((row, i) => (
                <tr key={i}>
                  {sec.cols.map((c) => (
                    <td key={c} className={c === "email" || c === "domainName" ? "mo" : undefined}>
                      {c === "status" || c === "processingStatus" || c === "verificationStatus" ? (
                        <Pill status={val(row, c)} />
                      ) : (
                        (sec.renderCell ? sec.renderCell(row, c) : val(row, c))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {sec.rows.length === 0 && (
                <tr>
                  <td colSpan={sec.cols.length} className="muted">
                    None found.
                  </td>
                </tr>
              )}
            </Table>
          </div>
        </div>
      ))}

      {tenant.grants.length > 0 && (
        <div className="card">
          <div className="hd">
            <h2>Support Grants ({tenant.grants.length})</h2>
          </div>
          <div className="bd">
            <Table headers={["Reason", "Member", "Scopes", "Status", "Expires"]}>
              {tenant.grants.map((g) => (
                <tr key={g.id}>
                  <td>{g.reason}</td>
                  <td>{g.supportMember?.displayName ?? "—"}</td>
                  <td className="mo">{g.scopes.join(", ")}</td>
                  <td>
                    <Pill status={g.revokedAt ? "revoked" : new Date(g.expiresAt).getTime() < Date.now() ? "expired" : "active"} />
                  </td>
                  <td className="muted">{fmt(g.expiresAt)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}

      {tenant.suppressions.length > 0 && (
        <div className="card">
          <div className="hd">
            <h2>Suppressions ({tenant.suppressions.length})</h2>
          </div>
          <div className="bd">
            <Table headers={["Email hash", "Reason", "Active", "Since"]}>
              {tenant.suppressions.map((sp) => (
                <tr key={sp.id}>
                  <td className="mo">{sp.emailHash}</td>
                  <td>{sp.reason}</td>
                  <td>
                    <Pill status={sp.active ? "active" : "inactive"} />
                  </td>
                  <td className="muted">{ago(sp.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function TenantsPage({
  initialOpenTenant,
  onConsumed,
}: {
  initialOpenTenant?: string | null;
  onConsumed?: () => void;
}) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [tenants, setTenants] = useState<PlatformTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TenantOverview | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchPlatformTenants(query);
      setTenants(res.tenants);
    } catch (e) {
      setError(apiErrorMessage(e));
      setTenants([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search("");
  }, [search]);

  useEffect(() => {
    if (initialOpenTenant) {
      openTenant(initialOpenTenant);
      onConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenTenant]);

  const openTenant = useCallback(async (tenantId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const res = await fetchTenantOverview(tenantId);
      setDetail(res);
    } catch (e) {
      setDetailError(apiErrorMessage(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  if (detail) return <TenantDetail tenant={detail} onBack={() => setDetail(null)} />;

  return (
    <div>
      <div className="filterbar">
        <div className="gsearch" style={{ width: 360, marginLeft: 0 }}>
          <span>⌕</span>
          <input
            placeholder="Search tenants by name or id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setApplied(q);
                search(q);
              }
            }}
          />
        </div>
        <button
          className="btn pri"
          onClick={() => {
            setApplied(q);
            search(q);
          }}
        >
          Search
        </button>
      </div>

      {error && <LoadErr error={error} onRetry={() => search(applied)} />}
      {detailError && <LoadErr error={detailError} onRetry={() => {}} />}
      {detailLoading && <Spinner />}

      <div className="card">
        <div className="hd">
          <h2>{applied ? `Tenants matching "${applied}"` : "All tenants"}</h2>
          <div className="sp">
            <span className="pill nu">{tenants.length}</span>
          </div>
        </div>
        <div className="bd">
          <Table headers={["Tenant", "Status", "Plan", "Members", "Mailboxes", "Domains", "Accounts", "Created"]}>
            {tenants.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => openTenant(t.id)}>
                <td className="nm">{t.name}</td>
                <td>
                  <Pill status={t.status} />
                </td>
                <td>
                  <span className="pill accent">{t.planCode || "—"}</span>
                </td>
                <td>{t.members}</td>
                <td>{t.mailboxes}</td>
                <td>{t.domains}</td>
                <td>{t.connectedAccounts}</td>
                <td className="muted">{ago(t.createdAt)}</td>
              </tr>
            ))}
            {tenants.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="muted">
                  No tenants found.
                </td>
              </tr>
            )}
          </Table>
        </div>
      </div>
    </div>
  );
}

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
          <option key={o} value={o}>
            {o}
          </option>
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
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      <button className="btn pri" onClick={onApply}>
        Apply
      </button>
      <button className="btn" onClick={onReset}>
        Reset
      </button>
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
          <div className="sp">
            <span className="pill nu">{count}</span>
          </div>
        </div>
        {loading ? (
          <Spinner />
        ) : (
          <div className="bd">
            <Table headers={headers}>{rows.map(render)}</Table>
            {count === 0 && (
              <div className="bd pad muted" style={{ paddingTop: 12, paddingBottom: 16 }}>
                {empty}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderEventsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<PlatformProviderEvent>(listPlatformProviderEvents, "events");
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
        onReset={() => {
          setQ("");
          setStatus("");
          setProvider("");
          setParams({ limit: 50 });
        }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Provider Events"
        count={rows.length}
        headers={["Tenant", "Provider", "Account", "Event", "Processing", "Error", "Attempts", "Received"]}
        rows={rows}
        render={(ev) => (
          <tr key={ev.id}>
            <td className="nm">{ev.tenantName}</td>
            <td>{ev.provider}</td>
            <td className="mo">{ev.accountEmail || "—"}</td>
            <td className="mo">{ev.eventType}</td>
            <td>
              <Pill status={ev.processingStatus} />
            </td>
            <td className="mo muted">{ev.errorCode ?? "—"}</td>
            <td className="mo">
              {ev.attempts}/{ev.maxAttempts}
            </td>
            <td className="muted">{ago(ev.receivedAt)}</td>
          </tr>
        )}
        empty="No provider events match."
      />
    </div>
  );
}

function DeliveryEventsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<PlatformDeliveryEvent>(listPlatformDeliveryEvents, "events");
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
        onReset={() => {
          setQ("");
          setType("");
          setParams({ limit: 50 });
        }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Delivery Events"
        count={rows.length}
        headers={["Type", "Tenant", "Subject", "Failure", "Created"]}
        rows={rows}
        render={(ev) => (
          <tr key={ev.id}>
            <td>
              <Pill status={ev.type} />
            </td>
            <td className="nm">{ev.tenantName}</td>
            <td className="muted">{ev.message?.subject ?? "—"}</td>
            <td className="mo muted">
              {ev.failureCode ? `${ev.failureCode}${ev.failureReason ? ` · ${ev.failureReason}` : ""}` : "—"}
            </td>
            <td className="muted">{ago(ev.createdAt)}</td>
          </tr>
        )}
        empty="No delivery events match."
      />
    </div>
  );
}

function JobsPage() {
  const { params, setParams, rows, loading, error, reload } = useList<PlatformJob>(listPlatformJobs, "jobs");
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
        onReset={() => {
          setQ("");
          setStatus("");
          setType("");
          setParams({ limit: 50 });
        }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Background Jobs"
        count={rows.length}
        headers={["Type", "Tenant", "Status", "Attempts", "Run At", "Completed", "Last Error"]}
        rows={rows}
        render={(job) => (
          <tr key={job.id}>
            <td>
              <span className="pill accent">{job.type}</span>
            </td>
            <td className="nm">{job.tenantName}</td>
            <td>
              <Pill status={job.status} />
            </td>
            <td className="mo">
              {job.attempts}/{job.maxAttempts}
            </td>
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

function AuditPage() {
  const { params, setParams, rows, loading, error, reload } = useList<PlatformAuditEvent>(listPlatformAudit, "events");
  const [q, setQ] = useState("");

  return (
    <div>
      <FilterInputs
        q={q}
        setQ={setQ}
        selectLabel="Result"
        selectValue={params.result ?? ""}
        selectOptions={["SUCCESS", "DENIED", "FAILED"]}
        setSelectValue={(v) => setParams({ ...params, result: v })}
        onApply={() => setParams({ q, result: params.result, limit: 50 })}
        onReset={() => {
          setQ("");
          setParams({ limit: 50 });
        }}
      />
      <ListShell
        loading={loading}
        error={error}
        onRetry={reload}
        title="Platform Audit"
        count={rows.length}
        headers={["Event", "Actor", "Tenant", "Resource", "Result", "When"]}
        rows={rows}
        render={(ev) => (
          <tr key={ev.id}>
            <td>
              <span className="pill nu">{ev.eventType}</span>
            </td>
            <td>{ev.actor?.displayName ?? ev.actor?.email ?? "system"}</td>
            <td className="nm">{ev.tenantName}</td>
            <td className="mo muted">
              {ev.resource ? `${ev.resource}` : "—"}
            </td>
            <td>
              <Pill status={ev.result} />
            </td>
            <td className="muted">{fmt(ev.createdAt)}</td>
          </tr>
        )}
        empty="No audit events match."
      />
    </div>
  );
}

function DiagnosticsPanel({
  diag,
  onClose,
}: {
  diag: SupportDiagnosticsData | null;
  onClose: () => void;
}) {
  if (!diag) return null;
  return (
    <div className="card">
      <div className="hd">
        <h2>Diagnostics · {diag.grant.reason || diag.grant.id}</h2>
        <div className="sp">
          <span className="pill accent">{diag.grant.scopes.join(", ")}</span>
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {diag.tenant && (
        <div className="bd pad">
          <div className="kv">
            <span>Tenant</span>
            <span>{diag.tenant.name}</span>
          </div>
          <div className="kv">
            <span>Status</span>
            <span>
              <Pill status={diag.tenant.status} />
            </span>
          </div>
          <div className="kv">
            <span>Members / Mailboxes</span>
            <span>
              {diag.tenant.activeMembers} / {diag.tenant.mailboxes}
            </span>
          </div>
          <div className="kv">
            <span>Created</span>
            <span>{fmt(diag.tenant.createdAt)}</span>
          </div>
        </div>
      )}
      {diag.domains && diag.domains.length > 0 && (
        <div className="bd">
          <Table headers={["Domain", "Verification", "MX", "SPF", "DKIM", "DMARC"]}>
            {diag.domains.map((d) => (
              <tr key={d.id}>
                <td className="mo nm">{d.domainName}</td>
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
              </tr>
            ))}
          </Table>
        </div>
      )}
      {diag.delivery && diag.delivery.length > 0 && (
        <div className="bd">
          <Table headers={["Delivery type", "Count"]}>
            {diag.delivery.map((d, i) => (
              <tr key={i}>
                <td>
                  <Pill status={d.type} />
                </td>
                <td className="mo">{d._count}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {diag.audit && diag.audit.length > 0 && (
        <div className="bd">
          <Table headers={["Audit event", "Target", "When"]}>
            {diag.audit.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="pill nu">{a.eventType}</span>
                </td>
                <td className="mo muted">
                  {a.targetType ? `${a.targetType} · ${shortId(a.targetId)}` : "—"}
                </td>
                <td className="muted">{fmt(a.createdAt)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

function GrantsPage() {
  const [grants, setGrants] = useState<PlatformGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<SupportDiagnosticsData | null>(null);
  const [diagLoading, setDiagLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPlatformGrants();
      setGrants(res.grants);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = useCallback(
    async (grantId: string) => {
      try {
        await revokePlatformGrant(grantId);
        await load();
      } catch (e) {
        setError(apiErrorMessage(e));
      }
    },
    [load],
  );

  const diagnose = useCallback(async (grantId: string) => {
    setDiagLoading(grantId);
    try {
      const res = await fetchPlatformDiagnostics(grantId);
      setDiag(res);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setDiagLoading(null);
    }
  }, []);

  return (
    <div>
      {error && <LoadErr error={error} onRetry={load} />}
      <DiagnosticsPanel diag={diag} onClose={() => setDiag(null)} />
      <div className="card">
        <div className="hd">
          <h2>Support Access Grants</h2>
          <div className="sp">
            <span className="pill nu">{grants.length}</span>
            <button className="btn sm" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
        {loading ? (
          <Spinner />
        ) : (
          <div className="bd">
            <Table headers={["Reason", "Support Member", "Tenant", "Scopes", "Status", "Expires", "Actions"]}>
              {grants.map((g) => {
                const expired = new Date(g.expiresAt).getTime() < Date.now();
                const status = g.revokedAt ? "revoked" : expired ? "expired" : "active";
                return (
                  <tr key={g.id}>
                    <td>{g.reason}</td>
                    <td>{g.supportMember?.displayName ?? "—"}</td>
                    <td className="nm">{g.tenantName}</td>
                    <td className="mo muted">{g.scopes.join(", ")}</td>
                    <td>
                      <Pill status={status} />
                    </td>
                    <td className="muted">{fmt(g.expiresAt)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn sm" onClick={() => diagnose(g.id)} disabled={diagLoading === g.id}>
                          {diagLoading === g.id ? "…" : "Diagnose"}
                        </button>
                        {!g.revokedAt && (
                          <button
                            className="btn sm"
                            style={{ color: "var(--crit)" }}
                            onClick={() => revoke(g.id)}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
            {grants.length === 0 && (
              <div className="bd pad muted">No support grants exist yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function PlatformConsole() {
  const router = useRouter();
  const logout = useLogout();
  const [page, setPage] = useState<PageId>("overview");
  const [pendingTenant, setPendingTenant] = useState<string | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const isPlatform = !!getPlatformToken();

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      setOverview(await fetchPlatformOverview());
    } catch (e) {
      setOverviewError(apiErrorMessage(e));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    loadOverview();
  }, [router, loadOverview]);

  const openTenant = useCallback((tenantId: string) => {
    setPendingTenant(tenantId);
    setPage("tenants");
  }, []);

  return (
    <div className="support-workspace">
      <style jsx global>
        {supportStyles}
      </style>

      <div className="topbar">
        <div className="brand">
          <img src="/ZoikoMail_Logo_DarkBG_PNG.png" alt="Zoiko Mail" style={{ height: 28, width: "auto" }} />
        </div>
        <div className="gsearch" style={{ flex: 1, maxWidth: 420, marginLeft: 16 }}>
          <span>⌕</span>
          <input placeholder="Cross-tenant search (API endpoint)…" readOnly />
        </div>
        <div className="sp" />
        <ThemeToggle />
        <span className={`pill ${isPlatform ? "violet" : "accent"}`}>
          {isPlatform ? "Platform (staff)" : "Support member"}
        </span>
        <div className="who">
          <div className="avatar">P</div>
          <div>
            <b>Platform Staff</b>
            <span>Staff Console</span>
          </div>
          <button className="btn sm" onClick={() => logout.mutate()}>
            Log out
          </button>
        </div>
      </div>

      <div className="shell">
        <nav className="rail">
          {PAGES.map((p) => (
            <button
              key={p.id}
              className={`railitem ${page === p.id ? "on" : ""}`}
              onClick={() => setPage(p.id)}
            >
              <span className="ico">{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <main>
          <div className="crumbs">
            <span>Platform</span>
            <span>/</span>
            <span className="cur">{PAGES.find((p) => p.id === page)?.label}</span>
          </div>

          <div className="pagehd">
            <div>
              <h1>{PAGES.find((p) => p.id === page)?.label}</h1>
              <p>Fleet-wide visibility across every tenant, provider account, and background job.</p>
            </div>
          </div>

          {page === "overview" &&
            (overviewLoading ? (
              <Spinner />
            ) : overviewError ? (
              <LoadErr error={overviewError} onRetry={loadOverview} />
            ) : (
              <OverviewPage data={overview} onOpenTenant={openTenant} />
            ))}
          {page === "tenants" && (
            <TenantsPage
              initialOpenTenant={pendingTenant}
              onConsumed={() => setPendingTenant(null)}
            />
          )}
          {page === "provider-events" && <ProviderEventsPage />}
          {page === "delivery-events" && <DeliveryEventsPage />}
          {page === "jobs" && <JobsPage />}
          {page === "audit" && <AuditPage />}
          {page === "grants" && <GrantsPage />}
        </main>
      </div>
    </div>
  );
}
