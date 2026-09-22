"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  commentPlatformTicket,
  commentTenantTicket,
  createPlatformTicket,
  createTenantTicket,
  getPlatformTicket,
  getTenantTicket,
  listPlatformStaff,
  listPlatformTickets,
  listTenantTickets,
  searchPlatformTenants,
  updatePlatformTicket,
  type CreateTicketInput,
  type SupportTicket,
  type TicketAuthor,
  type TicketCategory,
  type TicketComment,
  type TicketListParams,
  type TicketSeverity,
  type TicketStatus,
} from "@/lib/support-api";
import { useLiveRefresh } from "@/lib/support-hooks";
import { ApiError } from "@/lib/api-client";

const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_TENANT", "RESOLVED", "CLOSED"];
const SEVERITIES: TicketSeverity[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const CATEGORIES: TicketCategory[] = ["DELIVERY", "DOMAIN", "BILLING", "ACCOUNT", "SECURITY", "OTHER"];

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === "resolved" || s === "closed") return "ok";
  if (s === "waiting_tenant") return "warn";
  if (s === "in_progress") return "accent";
  return "nu";
}

function severityTone(severity: string): string {
  switch (severity) {
    case "URGENT":
      return "crit";
    case "HIGH":
      return "warn";
    case "MEDIUM":
      return "accent";
    default:
      return "nu";
  }
}

function padNum(n: number): string {
  return `TKT-${String(n).padStart(4, "0")}`;
}

function dueIn(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return iso;
  const mins = Math.round(diff / 60000);
  if (mins <= 0) return "overdue";
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

function Avatar({ name }: { name: string | null | undefined }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return <span className="av">{initial}</span>;
}

export default function TicketsPage({ mode = "staff" }: { mode?: "staff" | "tenant" }) {
  const isTenant = mode === "tenant";
  const [params, setParams] = useState<TicketListParams>({ limit: 50 });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [assigned, setAssigned] = useState("");
  const [overdue, setOverdue] = useState("");

  const [rows, setRows] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (isTenant
      ? listTenantTickets({ status: params.status, q: params.q, limit: params.limit })
      : listPlatformTickets(params)
    )
      .then((res) => {
        if (!cancelled) setRows(res.tickets);
      })
      .catch((e) => {
        if (!cancelled) {
          setRows([]);
          setError(errMsg(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params, tick, isTenant]);

  // The queue Runbook §5 measures. A P0 carries a fifteen-minute initial
  // response target, which a list that only loads once cannot support —
  // whoever is on duty would have to keep pressing refresh to discover one
  // had arrived. Paused while the tab is hidden.
  useLiveRefresh(() => setTick((t) => t + 1));

  const reload = useCallback(() => setTick((t) => t + 1), []);

  if (selectedId) {
    return (
      <TicketDetail
        ticketId={selectedId}
        tenant={isTenant}
        onBack={() => {
          setSelectedId(null);
          reload();
        }}
      />
    );
  }

  return (
    <div>
      <div className="pagehd">
        <div>
          <h1>Tickets</h1>
          {isTenant ? (
            <p>Support cases for this workspace, opened by you or raised for it.</p>
          ) : (
            <p>Support cases opened by tenants or on their behalf.</p>
          )}
        </div>
        <div className="sp">
          <button className="btn pri" onClick={() => setCreating(true)}>
            New ticket
          </button>
        </div>
      </div>

      <div className="filterbar">
        <div className="searchin">
          <span>⌕</span>
          <input placeholder={isTenant ? "Search subject, requester…" : "Search subject, tenant, requester…"} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="fselect" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        {!isTenant && (
          <>
            <select className="fselect" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Severity</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select className="fselect" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">Assignment</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              <option value="all">All</option>
            </select>
            <select className="fselect" value={overdue} onChange={(e) => setOverdue(e.target.value)}>
              <option value="">SLA</option>
              <option value="overdue">Overdue</option>
            </select>
          </>
        )}
        <button
          className="btn pri"
          onClick={() =>
            isTenant
              ? setParams({
                  q: q || undefined,
                  status: (status || undefined) as TicketStatus | undefined,
                  limit: 50,
                })
              : setParams({
                  q: q || undefined,
                  status: (status || undefined) as TicketStatus | undefined,
                  severity: (severity || undefined) as TicketSeverity | undefined,
                  assigned: (assigned || undefined) as TicketListParams["assigned"],
                  overdue: overdue === "overdue" ? true : undefined,
                  limit: 50,
                })
          }
        >
          Apply
        </button>
        <button
          className="btn"
          onClick={() => {
            setQ("");
            setStatus("");
            setSeverity("");
            setAssigned("");
            setOverdue("");
            setParams({ limit: 50 });
          }}
        >
          Reset
        </button>
      </div>

      {error && (
        <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)" }}>
          <b>⚠</b>
          <div style={{ flex: 1 }}>{error}</div>
          <button className="btn sm" onClick={reload}>
            Retry
          </button>
        </div>
      )}

      <div className="card">
        <div className="hd">
          <h2>Support Tickets</h2>
          <div className="sp">
            <span className="pill nu">{rows.length}</span>
          </div>
        </div>
        {loading ? (
          <div className="bd pad" style={{ color: "var(--ink3)", fontSize: 12 }}>
            Loading…
          </div>
        ) : (
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Subject</th>
                  {!isTenant && <th>Tenant</th>}
                  <th>Requester</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>SLA</th>
                  {!isTenant && <th>Assignee</th>}
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => setSelectedId(t.id)}>
                    <td className="mo">{padNum(t.ticketNumber)}</td>
                    <td className="nm">{t.subject}</td>
                    {!isTenant && <td>{t.tenantName}</td>}
                    <td>{t.openedBy?.displayName ?? t.openedBy?.email ?? "—"}</td>
                    <td>
                      <span className={`pill ${severityTone(t.severity)}`}>{t.severity}</span>
                    </td>
                    <td>
                      <span className={`pill ${statusTone(t.status)}`}>{t.status.replace("_", " ")}</span>
                    </td>
                    <td className={t.slaOverdue ? "crit" : "muted"} title={t.slaTarget ? `Target: ${t.slaTarget}` : undefined}>
                      {t.slaOverdue ? "overdue" : dueIn(t.slaDueAt)}
                      {t.slaTarget && <span className="muted"> · {t.slaTarget}</span>}
                    </td>
                    {!isTenant && <td>{t.assignedStaff?.displayName ?? t.assignedStaff?.email ?? <span className="muted">Unassigned</span>}</td>}
                    <td className="muted">{ago(t.updatedAt)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={isTenant ? 7 : 9} className="muted">
                      No tickets match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewTicketModal
          tenant={isTenant}
          onClose={() => setCreating(false)}
          onCreated={(ticket) => {
            setCreating(false);
            setSelectedId(ticket.id);
          }}
        />
      )}
    </div>
  );
}

function NewTicketModal({ tenant = false, onClose, onCreated }: { tenant?: boolean; onClose: () => void; onCreated: (t: SupportTicket) => void }) {
  const [tenantQuery, setTenantQuery] = useState("");
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [tenantId, setTenantId] = useState("");
  const [staff, setStaff] = useState<TicketAuthor[]>([]);
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [form, setForm] = useState<CreateTicketInput>({ subject: "", description: "", category: "OTHER", severity: "MEDIUM" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tenant) return;
    listPlatformStaff()
      .then((res) => setStaff(res.staff))
      .catch(() => setStaff([]));
  }, [tenant]);

  useEffect(() => {
    if (tenant) return;
    let cancelled = false;
    searchPlatformTenants(tenantQuery)
      .then((res) => {
        if (!cancelled) setTenants(res.tenants.map((t) => ({ id: t.id, name: t.name })));
      })
      .catch(() => {
        if (!cancelled) setTenants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantQuery, tenant]);

  const valid = (tenant || tenantId) && form.subject.trim().length >= 3 && form.description.trim().length >= 10;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const ticket = tenant
        ? await createTenantTicket(form)
        : await createPlatformTicket({
            ...form,
            tenantId,
            assignedStaffId: assignedStaffId || null,
          });
      onCreated(ticket);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer" role="dialog" aria-modal="true">
      <div className="scrim" onClick={onClose} />
      <div
        className="panel"
        style={{ left: "auto", right: 0, width: "min(92vw, 460px)", borderRight: 0, borderLeft: "1px solid var(--border)" }}
      >
        <div className="drawerhead">
          <b style={{ fontSize: 14 }}>New support ticket</b>
          <button className="menubtn" onClick={onClose} style={{ display: "grid" }}>
            ✕
          </button>
        </div>
        <div style={{ padding: "8px 18px 24px" }}>
          {error && <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)" }}>{error}</div>}
          {!tenant && (
            <div className="field">
              <label>Tenant</label>
              <input
                placeholder="Search tenants…"
                value={tenantQuery}
                onChange={(e) => {
                  setTenantQuery(e.target.value);
                  setTenantId("");
                }}
              />
              {!tenantId && tenants.length > 0 && (
                <div className="dropdown" style={{ position: "static", marginTop: 6 }}>
                  {tenants.slice(0, 6).map((t) => (
                    <button
                      key={t.id}
                      className="ditem"
                      onClick={() => {
                        setTenantId(t.id);
                        setTenantQuery(t.name);
                      }}
                    >
                      <b>{t.name}</b>
                    </button>
                  ))}
                </div>
              )}
              {tenantId && <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>Selected: {tenantQuery}</div>}
            </div>
          )}
          <div className="field">
            <label>Subject</label>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={200} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={5000}
              style={{ minHeight: 110 }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Severity</label>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as TicketSeverity })}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!tenant && (
            <div className="field">
              <label>Assign to (optional)</label>
              <select value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} · {s.email}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button className="btn pri" disabled={!valid || saving} onClick={submit}>
              {saving ? "Creating…" : "Create ticket"}
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketDetail({ ticketId, tenant = false, onBack }: { ticketId: string; tenant?: boolean; onBack: () => void }) {
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<TicketAuthor[]>([]);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    (tenant ? getTenantTicket(ticketId) : getPlatformTicket(ticketId))
      .then(setTicket)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [ticketId, tenant]);

  useEffect(() => {
    load();
  }, [load]);

  // A comment added by the tenant while this is open is the other half of the
  // conversation, and an assignment made by a colleague changes who owns it.
  useLiveRefresh(() => void load());

  useEffect(() => {
    if (tenant) return;
    listPlatformStaff()
      .then((res) => setStaff(res.staff))
      .catch(() => setStaff([]));
  }, [tenant]);

  async function patch(input: { status?: TicketStatus; severity?: TicketSeverity; assignedStaffId?: string | null }) {
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updatePlatformTicket(ticket.id, input);
      setTicket(updated);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    if (!ticket || reply.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (tenant) {
        await commentTenantTicket(ticket.id, reply.trim());
      } else {
        await commentPlatformTicket(ticket.id, reply.trim(), internal);
      }
      setReply("");
      setInternal(false);
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const sla = useMemo(() => {
    if (!ticket?.slaDueAt) return null;
    const due = new Date(ticket.slaDueAt).getTime();
    const overdue = due < Date.now() && ticket.status !== "RESOLVED" && ticket.status !== "CLOSED";
    // The target in the runbook's own words — "15 minutes", "4 business
    // hours". A due time on its own states a deadline without the promise it
    // came from, so nobody reading the queue can tell a tight one from a
    // generous one.
    return { label: fmt(ticket.slaDueAt), overdue, target: ticket.slaTarget ?? null };
  }, [ticket]);

  if (loading && !ticket) {
    return (
      <div className="bd pad muted" style={{ fontSize: 12 }}>
        Loading ticket…
      </div>
    );
  }

  if (!ticket) {
    return (
      <div>
        <button className="btn sm" onClick={onBack}>
          ← Back
        </button>
        <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)", marginTop: 12 }}>
          {error ?? "Ticket not found."}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="crumbs">
        <a onClick={onBack} style={{ cursor: "pointer" }}>
          Tickets
        </a>
        <span>/</span>
        <span className="cur mo">{padNum(ticket.ticketNumber)}</span>
      </div>

      <div className="pagehd">
        <div>
          <h1>{ticket.subject}</h1>
          <p>
            {ticket.tenantName} · opened by {ticket.openedBy?.displayName ?? ticket.openedBy?.email ?? "—"} ({ticket.openedByType.toLowerCase()}) · {fmt(ticket.createdAt)}
          </p>
        </div>
        <div className="sp">
          <button className="btn" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>

      {error && (
        <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)" }}>
          <b>⚠</b>
          <div style={{ flex: 1 }}>{error}</div>
        </div>
      )}

      <div className="split">
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="hd">
            <h2>Conversation</h2>
            <div className="sp">
              <span className={`pill ${statusTone(ticket.status)}`}>{ticket.status.replace("_", " ")}</span>
              <span className={`pill ${severityTone(ticket.severity)}`}>{ticket.severity}</span>
            </div>
          </div>

          <div className="bd pad" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="msg">
              <Avatar name={ticket.openedBy?.displayName} />
              <div className="bub">
                <div className="hd2">
                  <b>{ticket.openedBy?.displayName ?? ticket.openedBy?.email ?? "Requester"}</b>
                  <span>{fmt(ticket.createdAt)}</span>
                  <span className="pill nu">{ticket.category}</span>
                </div>
                <div className="txt">{ticket.description}</div>
              </div>
            </div>
            {ticket.comments.map((c) => (
              <Comment key={c.id} comment={c} />
            ))}
          </div>

          <div className="composer">
            <textarea
              placeholder={tenant ? "Reply to the support team…" : internal ? "Internal note (staff only)…" : "Reply to the tenant…"}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <div className="bar">
              {!tenant && (
                <div className="visitoggle">
                  <button className={!internal ? "on" : ""} onClick={() => setInternal(false)}>
                    Reply
                  </button>
                  <button className={internal ? "on" : ""} onClick={() => setInternal(true)}>
                    Internal note
                  </button>
                </div>
              )}
              <button className="btn pri" style={{ marginLeft: "auto" }} disabled={busy || reply.trim().length === 0} onClick={addComment}>
                {busy ? "Sending…" : internal ? "Add note" : "Send reply"}
              </button>
            </div>
          </div>
        </div>

        <div className="card sidepane" style={{ marginBottom: 0, alignSelf: "start" }}>
          {!tenant && (
            <>
              <div className="block">
                <h3>Status</h3>
                <select
                  className="fselect"
                  style={{ width: "100%" }}
                  value={ticket.status}
                  disabled={busy}
                  onChange={(e) => patch({ status: e.target.value as TicketStatus })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="block">
                <h3>Severity</h3>
                <select
                  className="fselect"
                  style={{ width: "100%" }}
                  value={ticket.severity}
                  disabled={busy}
                  onChange={(e) => patch({ severity: e.target.value as TicketSeverity })}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="block">
                <h3>Assignee</h3>
                <select
                  className="fselect"
                  style={{ width: "100%" }}
                  value={ticket.assignedStaff?.id ?? ""}
                  disabled={busy}
                  onChange={(e) => patch({ assignedStaffId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="block">
            <h3>Details</h3>
            <div className="kv">
              <span>Ticket</span>
              <span className="mo">{padNum(ticket.ticketNumber)}</span>
            </div>
            <div className="kv">
              <span>Category</span>
              <span>{ticket.category}</span>
            </div>
            <div className="kv">
              <span>SLA due</span>
              <span style={{ color: sla?.overdue ? "var(--crit)" : undefined }}>
                {sla
                  ? `${sla.label}${sla.target ? ` · target ${sla.target}` : ""}${sla.overdue ? " · overdue" : ""}`
                  : "—"}
              </span>
            </div>
            <div className="kv">
              <span>Updated</span>
              <span>{fmt(ticket.updatedAt)}</span>
            </div>
            {ticket.resolvedAt && (
              <div className="kv">
                <span>Resolved</span>
                <span>{fmt(ticket.resolvedAt)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Comment({ comment }: { comment: TicketComment }) {
  const staff = comment.authorType === "STAFF";
  return (
    <div className={`msg ${staff ? "support" : ""}`}>
      <Avatar name={comment.author?.displayName} />
      <div className="bub">
        <div className="hd2">
          <b>{comment.author?.displayName ?? comment.author?.email ?? comment.authorType}</b>
          <span>{fmt(comment.createdAt)}</span>
          {comment.internal && <span className="pill warn">Internal</span>}
          {staff && !comment.internal && <span className="pill accent">Support</span>}
        </div>
        <div className="txt">{comment.body}</div>
      </div>
    </div>
  );
}