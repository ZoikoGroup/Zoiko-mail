"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  fetchSupportDiagnostics,
  fetchSupportOverview,
  createSupportAccessGrant,
  revokeSupportAccessGrant,
  type SupportDiagnosticsData,
  type SupportOverview,
  type SupportScope,
} from "@/lib/support-api";
import { isLoggedIn } from "@/lib/auth-storage";
import { useLogout, useMe } from "@/lib/auth-hooks";
import { ApiError } from "@/lib/api-client";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

type Role = "agent" | "lead";
type Page = "dashboard" | "tickets" | "customers" | "diagnostics" | "kb" | "audit" | "team" | "settings";

type TicketRow = {
  id: string;
  subject: string;
  customer: string;
  category: string;
  priority: string;
  status: string;
  updated: string;
  sla: string;
  meta: string;
};

type Ticket = {
  id: string;
  subject: string;
  customer: string;
  tenant: string;
  category: string;
  priority: string;
  status: string;
  assignee: string;
  created: string;
  updated: string;
  sla: string;
};

type Customer = {
  id: string;
  name: string;
  email: string;
  tenant: string;
  role: string;
  mailboxes: string[];
  mfa: string;
  lastLogin: string;
};

type AuditItem = {
  t: string;
  actor: string;
  tenant: string;
  action: string;
  resource: string;
  result: string;
};

type KBCategory = {
  cat: string;
  n: string;
  count: number;
};

type Agent = {
  name: string;
  status: string;
  open: number;
  sla: number;
};

const NAV: Array<{ id: Page; label: string; ico: string; cnt?: number; leadOnly?: boolean }> = [
  { id: "dashboard", label: "Dashboard", ico: "▦" },
  { id: "tickets", label: "Tickets", ico: "🎫", cnt: 14 },
  { id: "customers", label: "Customers", ico: "👤" },
  { id: "diagnostics", label: "Mail Diagnostics", ico: "⚙" },
  { id: "kb", label: "Knowledge Base", ico: "📘" },
  { id: "audit", label: "Audit Logs", ico: "☰" },
  { id: "team", label: "Support Team", ico: "★", leadOnly: true },
  { id: "settings", label: "Settings", ico: "⚙︎" },
];

const TICKETS: Ticket[] = [
  { id: "TCK-1042", subject: "Mailbox not syncing since this morning", customer: "Priya Nair", tenant: "Acme Corp", category: "Sync", priority: "High", status: "In Progress", assignee: "Jordan Reyes", created: "Aug 8, 9:02 AM", updated: "12m ago", sla: "At risk" },
  { id: "TCK-1041", subject: "Cannot send email — 550 rejection", customer: "Sam Okafor", tenant: "Acme Corp", category: "Delivery", priority: "Urgent", status: "New", assignee: "Unassigned", created: "Aug 8, 8:41 AM", updated: "40m ago", sla: "Breached" },
  { id: "TCK-1039", subject: "Login MFA code not arriving", customer: "Devon Blake", tenant: "Acme Corp", category: "Authentication", priority: "High", status: "Waiting for Customer", assignee: "Marcus Webb", created: "Aug 7, 4:15 PM", updated: "2h ago", sla: "OK" },
  { id: "TCK-1037", subject: "Request to increase mailbox quota", customer: "Lena Fischer", tenant: "Northwind Ltd", category: "Provisioning", priority: "Low", status: "Open", assignee: "Jordan Reyes", created: "Aug 7, 2:03 PM", updated: "3h ago", sla: "OK" },
  { id: "TCK-1035", subject: "IMAP client repeatedly disconnecting", customer: "Tariq Hassan", tenant: "Northwind Ltd", category: "IMAP", priority: "Medium", status: "In Progress", assignee: "Ava Chen", created: "Aug 7, 11:22 AM", updated: "5h ago", sla: "At risk" },
  { id: "TCK-1031", subject: "DKIM failing after domain change", customer: "Priya Nair", tenant: "Acme Corp", category: "Delivery", priority: "High", status: "Resolved", assignee: "Jordan Reyes", created: "Aug 6, 9:40 AM", updated: "1d ago", sla: "OK" },
  { id: "TCK-1028", subject: "Duplicate messages appearing in inbox", customer: "Rosa Alvarez", tenant: "Meridian Partners", category: "Sync", priority: "Medium", status: "Closed", assignee: "Marcus Webb", created: "Aug 5, 3:12 PM", updated: "2d ago", sla: "OK" },
  { id: "TCK-1024", subject: "Unable to reset password", customer: "Sam Okafor", tenant: "Acme Corp", category: "Authentication", priority: "Medium", status: "Closed", assignee: "Ava Chen", created: "Aug 4, 1:05 PM", updated: "3d ago", sla: "OK" },
];

const CUSTOMERS: Customer[] = [
  { id: "cus_8841", name: "Priya Nair", email: "priya@acme.com", tenant: "Acme Corp", role: "Member", mailboxes: ["priya@acme.com"], mfa: "Enabled", lastLogin: "14 min ago" },
  { id: "cus_8842", name: "Sam Okafor", email: "sam@acme.com", tenant: "Acme Corp", role: "Member", mailboxes: ["sam@acme.com"], mfa: "Not set", lastLogin: "3 days ago" },
  { id: "cus_8850", name: "Devon Blake", email: "devon@acme.com", tenant: "Acme Corp", role: "Admin", mailboxes: ["devon@acme.com"], mfa: "Enabled", lastLogin: "9 min ago" },
  { id: "cus_9120", name: "Lena Fischer", email: "lena@northwind.co", tenant: "Northwind Ltd", role: "Owner", mailboxes: ["lena@northwind.co", "billing@northwind.co"], mfa: "Enabled", lastLogin: "1 hr ago" },
  { id: "cus_9134", name: "Tariq Hassan", email: "tariq@northwind.co", tenant: "Northwind Ltd", role: "Member", mailboxes: ["tariq@northwind.co"], mfa: "Enabled", lastLogin: "20 min ago" },
];

const AUDIT: AuditItem[] = [
  { t: "14:02", actor: "Jordan Reyes (Support)", tenant: "Acme Corp", action: "Ran mailbox sync", resource: "priya@acme.com", result: "Success" },
  { t: "13:58", actor: "System", tenant: "Acme Corp", action: "Login failed — invalid MFA code", resource: "devon@acme.com", result: "Failure" },
  { t: "13:40", actor: "Jordan Reyes (Support)", tenant: "Acme Corp", action: "Viewed customer profile", resource: "cus_8841", result: "Success" },
  { t: "12:10", actor: "System", tenant: "Northwind Ltd", action: "Provider token refreshed", resource: "tariq@northwind.co", result: "Success" },
  { t: "11:55", actor: "Ava Chen (Support)", tenant: "Northwind Ltd", action: "Reassigned ticket", resource: "TCK-1035", result: "Success" },
  { t: "11:20", actor: "System", tenant: "Acme Corp", action: "Delivery failure — 550 rejection", resource: "sam@acme.com", result: "Failure" },
  { t: "Yesterday", actor: "Marcus Webb (Support)", tenant: "Acme Corp", action: "Password reset link issued", resource: "sam@acme.com", result: "Success" },
];

const KB: KBCategory[] = [
  { cat: "IMAP troubleshooting", n: "📥", count: 6 },
  { cat: "SMTP troubleshooting", n: "📤", count: 5 },
  { cat: "Login & authentication", n: "🔑", count: 8 },
  { cat: "Sync issues", n: "🔄", count: 7 },
  { cat: "Delivery failures", n: "✉", count: 9 },
  { cat: "Tenant configuration", n: "🏢", count: 4 },
];

const AGENTS: Agent[] = [
  { name: "Jordan Reyes", status: "Online", open: 5, sla: 1 },
  { name: "Ava Chen", status: "Online", open: 3, sla: 0 },
  { name: "Marcus Webb", status: "Away", open: 4, sla: 1 },
  { name: "Nina Kowalski", status: "Offline", open: 0, sla: 0 },
];

export function SupportWorkspace() {
  const router = useRouter();
  const logout = useLogout();
  const { data: meData } = useMe();
  const [role, setRole] = useState<Role>("agent"); // demo view switch (Agent / Lead) — UI parity only
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedTicket, setSelectedTicket] = useState("");
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [openDrop, setOpenDrop] = useState<"notif" | "profile" | null>(null);

  // Live Backend Overview State
  const [overview, setOverview] = useState<SupportOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Live Backend Grant State
  const [grantIdInput, setGrantIdInput] = useState("");
  const [activeGrantId, setActiveGrantId] = useState<string | null>(null);
  const [liveDiagnostics, setLiveDiagnostics] = useState<SupportDiagnosticsData | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  // Auth guard: no token -> back to login.
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
  }, [router]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setOverviewError(null);
    try {
      const data = await fetchSupportOverview();
      setOverview(data);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setOverviewError(err?.message || "Failed to load support workspace data");
    } finally {
      setLoadingOverview(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isLoggedIn()) return;
    loadOverview();
  }, [loadOverview]);

  const me = meData;
  const tenantName = me?.tenant?.name ?? "My Workspace";
  const membershipRole = me?.membership?.role;
  const roleLabel = role === "lead" ? "Support Lead" : "Support Agent";
  const userName = me?.displayName?.trim() || me?.email || "Support Agent";
  const userEmail = me?.email ?? "";
  const userInitials =
    userName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "SA";

  const loadDiagnostics = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoadingDiagnostics(true);
    setDiagnosticsError(null);
    try {
      const data = await fetchSupportDiagnostics(id.trim());
      setLiveDiagnostics(data);
      setActiveGrantId(id.trim());
    } catch (err: any) {
      setDiagnosticsError(err.message || "Failed to fetch support diagnostics using grant ID");
      setLiveDiagnostics(null);
    } finally {
      setLoadingDiagnostics(false);
    }
  }, []);

  const clearGrant = () => {
    setActiveGrantId(null);
    setLiveDiagnostics(null);
    setDiagnosticsError(null);
    setGrantIdInput("");
  };

  const revokeGrant = async (grantId: string) => {
    try {
      await revokeSupportAccessGrant(grantId);
      if (activeGrantId === grantId) clearGrant();
      loadOverview();
    } catch (err: any) {
      setDiagnosticsError(err.message || "Failed to revoke grant");
    }
  };

  const createGrant = async (input: { supportMembershipId: string; reason: string; expiresInMinutes: number; scopes: SupportScope[] }) => {
    try {
      await createSupportAccessGrant(input);
      loadOverview();
      return null;
    } catch (err: any) {
      return err.message || "Failed to create grant";
    }
  };

  const [grantFormOpen, setGrantFormOpen] = useState(false);
  const [grantSupportMemberId, setGrantSupportMemberId] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantExpiry, setGrantExpiry] = useState(60);
  const [grantScopes, setGrantScopes] = useState<SupportScope[]>(["TENANT_DIAGNOSTICS", "DNS_DIAGNOSTICS", "DELIVERY_DIAGNOSTICS", "AUDIT_READ"]);
  const [grantFormError, setGrantFormError] = useState<string | null>(null);
  const [creatingGrant, setCreatingGrant] = useState(false);

  const toggleScope = (scope: SupportScope) => {
    setGrantScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const submitGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantSupportMemberId) { setGrantFormError("Select a support member"); return; }
    if (grantReason.trim().length < 10) { setGrantFormError("Reason must be at least 10 characters"); return; }
    if (grantScopes.length === 0) { setGrantFormError("Select at least one scope"); return; }
    setCreatingGrant(true);
    setGrantFormError(null);
    const error = await createGrant({
      supportMembershipId: grantSupportMemberId,
      reason: grantReason.trim(),
      expiresInMinutes: grantExpiry,
      scopes: grantScopes,
    });
    if (error) {
      setGrantFormError(error);
    } else {
      setGrantReason("");
      setGrantSupportMemberId("");
      setGrantExpiry(60);
      setGrantScopes(["TENANT_DIAGNOSTICS", "DNS_DIAGNOSTICS", "DELIVERY_DIAGNOSTICS", "AUDIT_READ"]);
      setGrantFormOpen(false);
    }
    setCreatingGrant(false);
  };

  const ticketRows: TicketRow[] = useMemo(() => {
    if (overview && overview.issues.length > 0) {
      return overview.issues.map((issue) => ({
        id: issue.id,
        subject: issue.subject,
        customer: issue.customer,
        category: issue.category,
        priority: issue.priority,
        status: issue.status,
        updated: timeAgo(issue.updatedAt),
        sla: slaFor(issue.status),
        meta: `${issue.kind.toUpperCase()}${issue.mailbox ? ` · ${issue.mailbox}` : ""}${issue.error ? ` · ${truncate(issue.error, 40)}` : ""}`,
      }));
    }
    return TICKETS.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      customer: ticket.customer,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      updated: ticket.updated,
      sla: ticket.sla,
      meta: `${ticket.id} · ${ticket.assignee}`,
    }));
  }, [overview]);

  useEffect(() => {
    if (ticketRows.length > 0 && (!selectedTicket || !ticketRows.some((t) => t.id === selectedTicket))) {
      setSelectedTicket(ticketRows[0].id);
    }
  }, [ticketRows, selectedTicket]);

  const selectedTicketData = ticketRows.find((item) => item.id === selectedTicket) ?? ticketRows[0];

  const filteredTickets = useMemo(() => {
    return ticketRows.filter((ticket) => {
      const query = search.trim().toLowerCase();
      if (query) {
        const haystack = `${ticket.subject} ${ticket.customer} ${ticket.category} ${ticket.status}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (queueFilter !== "all" && ticket.category.toLowerCase() !== queueFilter.toLowerCase()) return false;
      if (priorityFilter !== "all" && ticket.priority.toLowerCase() !== priorityFilter.toLowerCase()) return false;
      return true;
    });
  }, [search, queueFilter, priorityFilter, ticketRows]);

  const customerRows = useMemo(() => {
    if (overview && overview.members.length > 0) {
      return overview.members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        tenant: tenantName,
        role: member.role,
        mailboxes: member.mailboxes.length > 0 ? member.mailboxes.join(", ") : "—",
        mfa: userStatusLabel(member.userStatus),
        lastLogin: member.lastLoginAt ? timeAgo(member.lastLoginAt) : "Never",
      }));
    }
    return CUSTOMERS.map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      tenant: customer.tenant,
      role: customer.role,
      mailboxes: customer.mailboxes.join(", "),
      mfa: customer.mfa,
      lastLogin: customer.lastLogin,
    }));
  }, [overview, tenantName]);

  const auditRows = useMemo(() => {
    if (overview && overview.audit.length > 0) {
      return overview.audit.map((event) => ({
        id: event.id,
        time: new Date(event.createdAt).toLocaleString(),
        actor: event.actor ? event.actor.displayName : "System",
        tenant: tenantName,
        action: event.eventType,
        resource: event.targetId ? `${event.targetType ?? "resource"} ${event.targetId.slice(0, 8)}` : (event.targetType ?? "—"),
        result: "Recorded",
      }));
    }
    return AUDIT.map((item) => ({
      id: `${item.t}-${item.resource}`,
      time: item.t,
      actor: item.actor,
      tenant: item.tenant,
      action: item.action,
      resource: item.resource,
      result: item.result,
    }));
  }, [overview, tenantName]);

  const teamRows = useMemo(() => {
    if (overview && overview.team.length > 0) {
      return overview.team.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        status: member.status,
      }));
    }
    return AGENTS.map((agent) => ({
      id: agent.name,
      name: agent.name,
      email: `${agent.name.toLowerCase().replace(/\s+/g, ".")}@zoiko.internal`,
      status: agent.status,
    }));
  }, [overview]);

  const changeRole = (nextRole: Role) => {
    setRole(nextRole);
    setOpenDrop(null);
  };

  const go = (nextPage: Page) => {
    setPage(nextPage);
    setOpenDrop(null);
  };

  const submitSearch = () => {
    go("customers");
  };

  const renderMain = () => {
    if (page === "tickets") {
      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Tickets</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Tickets</h1>
              <p>Work queue for mailbox, delivery, and identity issues.</p>
            </div>
            <div className="sp">
              <button className="btn">Export</button>
              <button className="btn pri">New ticket</button>
            </div>
          </div>
          <div className="filterbar">
            <select className="fselect" value={queueFilter} onChange={(e) => setQueueFilter(e.target.value)}>
              <option value="all">All queues</option>
              <option value="sync">Sync</option>
              <option value="delivery">Delivery</option>
            </select>
            <select className="fselect" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="all">Any priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <div className="searchin">
              <span>🔎</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tickets" />
            </div>
            <button className="chip on">Open</button>
            <button className="chip">Waiting</button>
            <button className="chip">Resolved</button>
          </div>
          <div className="card">
            <div className="hd">
              <h2>Queue</h2>
              <div className="sp">
                <span className="pill accent">{filteredTickets.length} visible</span>
              </div>
            </div>
            <div className="bd">
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Customer</th>
                    <th>Category</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id} className="clickable" onClick={() => setSelectedTicket(ticket.id)}>
                      <td>
                        <div className="nm">{ticket.subject}</div>
                        <div className="muted">{ticket.meta}</div>
                      </td>
                      <td>{ticket.customer}</td>
                      <td>{ticket.category}</td>
                      <td>{priorityPill(ticket.priority)}</td>
                      <td>{statusPill(ticket.status)}</td>
                      <td>{ticket.updated}</td>
                      <td>{slaPill(ticket.sla)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="split">
            <div className="card">
              <div className="hd">
                <h2>Ticket conversation</h2>
                <div className="sp">
                  <span className="pill accent">{selectedTicketData.id}</span>
                </div>
              </div>
              <div className="thread">
                <div className="msg">
                  <div className="av">CU</div>
                  <div className="bub">
                    <div className="hd2">
                      <b>{selectedTicketData.customer}</b>
                      <span>Detected {selectedTicketData.updated}</span>
                    </div>
                    <div className="txt">{selectedTicketData.subject}</div>
                  </div>
                </div>
                <div className="msg support">
                  <div className="av">SA</div>
                  <div className="bub">
                    <div className="hd2">
                      <b>Support Agent</b>
                      <span>{selectedTicketData.status}</span>
                    </div>
                    <div className="txt">{selectedTicketData.meta}</div>
                  </div>
                </div>
              </div>
              <div className="composer">
                <textarea placeholder="Add an internal update" />
                <div className="bar">
                  <div className="visitoggle">
                    <button className="on">Internal</button>
                    <button>Customer</button>
                  </div>
                  <button className="btn pri">Send</button>
                </div>
              </div>
            </div>
            <div className="card sidepane">
              <div className="block">
                <h3>Case details</h3>
                {kv("Tenant", tenantName)}
                {kv("Status", selectedTicketData.status)}
                {kv("Priority", selectedTicketData.priority)}
                {kv("Updated", selectedTicketData.updated)}
              </div>
              <div className="block">
                <h3>Account</h3>
                {kv("Customer", selectedTicketData.customer)}
                {kv("Category", selectedTicketData.category)}
                {kv("Reference", selectedTicketData.meta)}
              </div>
            </div>
          </div>
        </>
      );
    }

    if (page === "customers") {
      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Customers</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Customers</h1>
              <p>Review tenant accounts, mailboxes, security posture, and recent access.</p>
            </div>
            <div className="sp">
              <button className="btn">Bulk action</button>
            </div>
          </div>
          <div className="card">
            <div className="hd">
              <h2>Customer accounts</h2>
            </div>
            <div className="bd">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Tenant</th>
                    <th>Role</th>
                    <th>Mailboxes</th>
                    <th>MFA</th>
                    <th>Last login</th>
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <div className="nm">{customer.name}</div>
                        <div className="muted">{customer.email}</div>
                      </td>
                      <td>{customer.tenant}</td>
                      <td>{customer.role}</td>
                      <td>{customer.mailboxes}</td>
                      <td>{customer.mfa}</td>
                      <td>{customer.lastLogin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      );
    }

    if (page === "diagnostics") {
      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Mail Diagnostics</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Mail Diagnostics</h1>
              <p>Provider health, MX records, retry queues, and tenant access grants.</p>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="hd">
              <h2>Support access grants</h2>
              <div className="sp">
                <span className="pill accent">{(overview?.grants ?? []).length} active</span>
              </div>
            </div>
            <div className="bd">
              {(overview?.grants ?? []).length > 0 ? (
                (overview?.grants ?? []).map((grant) => (
                  <div className="row" key={grant.id}>
                    <div className="tx">
                      <b>{grant.supportMembership?.user?.displayName || "Support member"} · {grant.supportMembership?.user?.email || "—"}</b>
                      <span>{grant.reason}</span>
                    </div>
                    <div className="sp">
                      <span className="pill accent">{grant.scopes.join(", ")}</span>
                      <span className={`pill ${new Date(grant.expiresAt) > new Date() ? "ok" : "crit"}`}>exp {new Date(grant.expiresAt).toLocaleDateString()}</span>
                      <button className="btn sm" onClick={() => loadDiagnostics(grant.id)}>Load</button>
                      {membershipRole === "OWNER" ? (
                        <button className="btn sm" onClick={() => revokeGrant(grant.id)}>Revoke</button>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="row">
                  <div className="tx">
                    <b>No active grants</b>
                    <span>An OWNER can create a support access grant to enable live diagnostics.</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {membershipRole === "OWNER" ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="hd">
                <h2>Create support access grant</h2>
                <div className="sp">
                  <button className="btn sm" onClick={() => setGrantFormOpen(!grantFormOpen)}>{grantFormOpen ? "Hide form" : "New grant"}</button>
                </div>
              </div>
              {grantFormOpen ? (
                <div className="bd pad">
                  {grantFormError ? (
                    <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)", color: "var(--crit)" }}>
                      <span>⚠️</span>
                      <div><b>Grant error:</b> {grantFormError}</div>
                    </div>
                  ) : null}
                  <form onSubmit={submitGrant} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="field">
                      <label>Support member</label>
                      <select value={grantSupportMemberId} onChange={(e) => setGrantSupportMemberId(e.target.value)}>
                        <option value="">Select a support member…</option>
                        {(overview?.team ?? []).map((member) => (
                          <option key={member.id} value={member.id}>{member.name} · {member.email}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Expires in minutes (5–240)</label>
                      <input type="number" min={5} max={240} value={grantExpiry} onChange={(e) => setGrantExpiry(Number(e.target.value))} />
                    </div>
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label>Reason (min 10 characters)</label>
                      <input type="text" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="e.g. Investigating delivery failures" />
                    </div>
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label>Scopes</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                        {(["TENANT_DIAGNOSTICS", "DNS_DIAGNOSTICS", "DELIVERY_DIAGNOSTICS", "AUDIT_READ"] as SupportScope[]).map((scope) => (
                          <label key={scope} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input type="checkbox" checked={grantScopes.includes(scope)} onChange={() => toggleScope(scope)} />
                            {scope}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
                      <button className="btn pri" type="submit" disabled={creatingGrant}>{creatingGrant ? "Creating…" : "Create grant"}</button>
                    </div>
                  </form>
                </div>
              ) : null}
            </div>
          ) : null}

          {liveDiagnostics ? (
            <div className="notice" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-ink)", marginBottom: 16 }}>
              <span>🔐</span>
              <div>
                <b>Live Support Grant Active: {liveDiagnostics.grant.id}</b>
                <div>
                  Scopes Granted: {liveDiagnostics.grant.scopes.join(", ")} | Expires: {new Date(liveDiagnostics.grant.expiresAt).toLocaleString()}
                </div>
              </div>
            </div>
          ) : null}

          {liveDiagnostics?.tenant ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="hd">
                <h2>Tenant Metadata (Live API)</h2>
                <div className="sp">
                  <span className="pill ok">{liveDiagnostics.tenant.status}</span>
                </div>
              </div>
              <div className="bd pad">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  {kv("Tenant ID", liveDiagnostics.tenant.id)}
                  {kv("Tenant Name", liveDiagnostics.tenant.name)}
                  {kv("Plan", liveDiagnostics.tenant.planCode)}
                  {kv("Active Members", String(liveDiagnostics.tenant.activeMembers))}
                  {kv("Mailboxes", String(liveDiagnostics.tenant.mailboxes))}
                  {kv("Created At", new Date(liveDiagnostics.tenant.createdAt).toLocaleDateString())}
                </div>
              </div>
            </div>
          ) : null}

          {liveDiagnostics?.domains ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="hd">
                <h2>Mail Domain Health (Live API)</h2>
              </div>
              <div className="bd">
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Verification</th>
                      <th>MX Status</th>
                      <th>SPF Status</th>
                      <th>DKIM Status</th>
                      <th>DMARC Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveDiagnostics.domains.map((dom) => (
                      <tr key={dom.id}>
                        <td><b>{dom.domainName}</b></td>
                        <td><span className={`pill ${dom.verificationStatus === 'VERIFIED' ? 'ok' : 'warn'}`}>{dom.verificationStatus}</span></td>
                        <td><span className={`pill ${dom.mxStatus === 'VALID' ? 'ok' : 'crit'}`}>{dom.mxStatus}</span></td>
                        <td><span className={`pill ${dom.spfStatus === 'VALID' ? 'ok' : 'crit'}`}>{dom.spfStatus}</span></td>
                        <td><span className={`pill ${dom.dkimStatus === 'VALID' ? 'ok' : 'crit'}`}>{dom.dkimStatus}</span></td>
                        <td><span className={`pill ${dom.dmarcStatus === 'VALID' ? 'ok' : 'crit'}`}>{dom.dmarcStatus}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="stats">
            <div className="stat ok">
              <div className="lbl">Provider health</div>
              <div className="val">{liveDiagnostics ? "100%" : overview ? "Ready" : "97%"}</div>
              <div className="sub">{liveDiagnostics ? "Live connection OK" : overview ? `${overview.stats.mailboxes} mailboxes configured` : "No active incidents"}</div>
            </div>
            <div className="stat warn">
              <div className="lbl">Queue depth</div>
              <div className="val">{overview ? overview.stats.deliveryEvents24h : liveDiagnostics?.delivery?.length ?? 18}</div>
              <div className="sub">Delivery events (24h)</div>
            </div>
            <div className="stat ai">
              <div className="lbl">Auto-retry</div>
              <div className="val">{overview ? overview.stats.retryJobs : "92%"}</div>
              <div className="sub">{overview ? "Retrying / queued jobs" : "Successful recoveries"}</div>
            </div>
            <div className="stat crit">
              <div className="lbl">Blocked sends</div>
              <div className="val">{overview ? overview.stats.failedDeliveries24h : 4}</div>
              <div className="sub">Needs review</div>
            </div>
          </div>

          <div className="card">
            <div className="hd">
              <h2>{liveDiagnostics ? "Live Diagnostics Summary" : "Recent diagnostics (Demo)"}</h2>
            </div>
            <div className="bd">
              {liveDiagnostics?.delivery && liveDiagnostics.delivery.length > 0 ? (
                liveDiagnostics.delivery.map((event) => row(`Delivery Event: ${event.type}`, "Tracked past 24h", `${event._count} occurrences`, "accent"))
              ) : (
                [
                  { title: "MX lookup for acme.com", meta: "Healthy", tone: "ok" },
                  { title: "TLS handshake for outbound relay", meta: "Warning", tone: "warn" },
                  { title: "Inbound queue retry", meta: "Recovered", tone: "ok" },
                ].map((item) => row(item.title, "Verified 4 minutes ago", item.meta, item.tone))
              )}
            </div>
          </div>
        </>
      );
    }

    if (page === "kb") {
      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Knowledge Base</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Knowledge Base</h1>
              <p>Reference articles for common support scenarios.</p>
            </div>
          </div>
          <div className="kbcat">
            {KB.map((category) => (
              <div className="kbcatcard" key={category.cat}>
                <div className="n">{category.n}</div>
                <b>{category.cat}</b>
                <span>{category.count} articles</span>
              </div>
            ))}
          </div>
        </>
      );
    }

    if (page === "audit") {
      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Audit Logs</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Audit Logs</h1>
              <p>Review support actions and automated system events.</p>
            </div>
          </div>
          <div className="card">
            <div className="hd">
              <h2>{auditRows.length > 0 && overview && overview.audit.length > 0 ? "Live Backend Audit Events" : "Recent events"}</h2>
              <div className="sp">
                <span className="pill accent">{auditRows.length} events</span>
              </div>
            </div>
            <div className="bd">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor / Target</th>
                    <th>Tenant</th>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map((item) => (
                    <tr key={item.id}>
                      <td>{item.time}</td>
                      <td>{item.actor}</td>
                      <td>{item.tenant}</td>
                      <td>{item.action}</td>
                      <td className="mo">{item.resource}</td>
                      <td><span className={`pill ${item.result === "Failure" ? "crit" : "ok"}`}>{item.result}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      );
    }

    if (page === "team") {
      if (role !== "lead") {
        return (
          <div className="deniedwrap">
            <div className="ic">🔒</div>
            <b>Support Lead access required</b>
            <p>Switch to the lead role to review team ownership, workload distribution, and escalation coverage.</p>
          </div>
        );
      }

      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Support Team</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Support Team</h1>
              <p>Monitor agent availability, workload, and SLA posture.</p>
            </div>
          </div>
          <div className="card">
            <div className="hd">
              <h2>Team roster</h2>
              <div className="sp">
                <span className="pill accent">{teamRows.length} members</span>
              </div>
            </div>
            <div className="bd">
              {teamRows.map((agent) => (
                <div className="row" key={agent.id}>
                  <div className="tx">
                    <b>{agent.name}</b>
                    <span>{agent.email}</span>
                  </div>
                  <div className="sp">
                    <span className={`pill ${agent.status === "ACTIVE" ? "ok" : agent.status === "INVITED" ? "warn" : "nu"}`}>{userStatusLabel(agent.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      );
    }

    if (page === "settings") {
      return (
        <>
          <div className="crumbs">
            <a href="#" onClick={(event) => { event.preventDefault(); go("dashboard"); }}>Dashboard</a>
            <span>/</span>
            <span className="cur">Settings</span>
          </div>
          <div className="pagehd">
            <div>
              <h1>Settings</h1>
              <p>Notification preferences and workspace configuration.</p>
            </div>
          </div>
          <div className="card">
            <div className="hd">
              <h2>Workspace preferences</h2>
            </div>
            <div className="bd pad">
              <div className="field">
                <label>Default queue</label>
                <select defaultValue="urgent">
                  <option value="urgent">Urgent first</option>
                  <option value="all">All tickets</option>
                </select>
              </div>
              <div className="field">
                <label>Notification cadence</label>
                <input defaultValue="Every 15 minutes" />
              </div>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="notice">
          <span>ℹ</span>
          <div>
            <b>{overview ? "Live backend data connected." : loadingOverview ? "Loading live workspace data…" : "Support workspace ready."}</b>
            <div>Review requests, customer account health, and mailflow diagnostics from a single view.</div>
          </div>
        </div>
        {overviewError ? (
          <div className="notice" style={{ background: "var(--crit-soft)", borderColor: "var(--crit)", color: "var(--crit)" }}>
            <span>⚠️</span>
            <div>
              <b>Backend API Error:</b> {overviewError}
            </div>
          </div>
        ) : null}
        <div className="stats">
          <div className="stat ok">
            <div className="lbl">Open tickets</div>
            <div className="val">{overview ? overview.stats.issues : 14}</div>
            <div className="sub">{overview ? "Delivery & job issues" : "Across active tenants"}</div>
          </div>
          <div className="stat warn">
            <div className="lbl">Retrying jobs</div>
            <div className="val">{overview ? overview.stats.retryJobs : 3}</div>
            <div className="sub">Needs attention</div>
          </div>
          <div className="stat ai">
            <div className="lbl">Members</div>
            <div className="val">{overview ? overview.stats.members : 8}</div>
            <div className="sub">{overview ? `${overview.stats.mailboxes} mailboxes · ${overview.stats.domains} domains` : "Active in workspace"}</div>
          </div>
          <div className="stat crit">
            <div className="lbl">Failed sends (24h)</div>
            <div className="val">{overview ? overview.stats.failedMessages24h + overview.stats.failedDeliveries24h : 1}</div>
            <div className="sub">Needs review</div>
          </div>
        </div>
        <div className="card">
          <div className="hd">
            <h2>Priority queue</h2>
            <div className="sp">
              <span className="pill accent">{ticketRows.length} open</span>
              <button className="btn sm" onClick={loadOverview} disabled={loadingOverview}>{loadingOverview ? "Loading…" : "Refresh"}</button>
            </div>
          </div>
          <div className="bd">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {ticketRows.slice(0, 5).map((ticket) => (
                  <tr key={ticket.id} className="clickable" onClick={() => { setSelectedTicket(ticket.id); go("tickets"); }}>
                    <td>
                      <div className="nm">{ticket.subject}</div>
                      <div className="muted">{ticket.id}</div>
                    </td>
                    <td>{ticket.customer}</td>
                    <td>{priorityPill(ticket.priority)}</td>
                    <td>{statusPill(ticket.status)}</td>
                    <td>{ticket.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="hd">
            <h2>Latest customer activity</h2>
          </div>
          <div className="bd">
            {customerRows.slice(0, 3).map((customer) => row(`${customer.name} · ${customer.tenant}`, customer.email, customer.lastLogin, "accent"))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="support-workspace">
      <style jsx global>{supportStyles}</style>
      <div className="topbar">
        <div className="brand">
          <img src="/ZoikoMail_Logo_DarkBG_PNG.png" alt="Zoiko Mail" style={{ height: 28, width: "auto" }} />
        </div>
        <div className="gsearch" style={{ flex: 1, maxWidth: 420, marginLeft: 16 }}>
          <span>🔎</span>
          <input
            id="globalSearch"
            placeholder="Search tickets, customers, tenants, mailboxes…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitSearch();
              }
            }}
          />
        </div>
        <div className="sp" />
        <div className="demoswitch">
          <span className="lbl">Viewing as</span>
          <button id="rb-agent" className={role === "agent" ? "on" : ""} onClick={() => changeRole("agent")}>
            Support Agent
          </button>
          <button id="rb-lead" className={role === "lead" ? "on" : ""} onClick={() => changeRole("lead")}>
            Support Lead
          </button>
        </div>
        <button className="iconbtn" onClick={() => setOpenDrop(openDrop === "notif" ? null : "notif")}>🔔<span className="badge-dot" /></button>
        <ThemeToggle />
        <div className="who" style={{ position: "relative" }}>
          <button style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={() => setOpenDrop(openDrop === "profile" ? null : "profile")}>
            <div className="avatar">{userInitials}</div>
            <div style={{ textAlign: "left" }}>
              <b>{userName}</b>
              <span>{roleLabel}</span>
            </div>
          </button>
          {openDrop === "profile" ? (
            <div className="dropdown" style={{ right: 0, top: "calc(100% + 8px)" }}>
              <div className="ditem">
                <span>👤</span>
                <div>
                  <b>{userName}</b>
                  <span>{roleLabel} · {userEmail}</span>
                </div>
              </div>
              <button className="ditem" onClick={() => go("settings")}>
                <span>⚙</span>
                <div>
                  <b>Settings</b>
                  <span>Notification &amp; profile preferences</span>
                </div>
              </button>
              <button className="ditem" onClick={() => { setOpenDrop(null); logout.mutate(); }} disabled={logout.isPending}>
                <span>↪</span>
                <div>
                  <b>{logout.isPending ? "Signing out…" : "Sign out"}</b>
                </div>
              </button>
            </div>
          ) : null}
        </div>
        {openDrop === "notif" ? (
          <div className="dropdown" style={{ right: 210, top: 52 }}>
            <div className="dhd">Notifications</div>
            <div className="ditem"><span>⚠</span><div><b>SLA breached</b><span>TCK-1041 has exceeded its response SLA</span></div></div>
            <div className="ditem"><span>🎫</span><div><b>New ticket assigned</b><span>TCK-1042 assigned to you</span></div></div>
            <div className="ditem"><span>🔄</span><div><b>Sync retry completed</b><span>priya@acme.com — success</span></div></div>
          </div>
        ) : null}
      </div>

      <div className="grantbar" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 20px", background: activeGrantId ? "var(--accent-soft)" : "var(--s3)", borderBottom: "1px solid var(--border)", fontSize: "12px" }}>
        <span style={{ fontWeight: 600, color: "var(--ink2)" }}>🔐 Support Access Grant Token:</span>
        <input
          type="text"
          placeholder="Enter Support Access Grant ID (UUID)"
          value={grantIdInput}
          onChange={(e) => setGrantIdInput(e.target.value)}
          style={{ flex: 1, padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--border)", fontFamily: "var(--mo)", fontSize: "12px" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              loadDiagnostics(grantIdInput);
            }
          }}
        />
        <button
          className="btn pri sm"
          onClick={() => loadDiagnostics(grantIdInput)}
          disabled={loadingDiagnostics || !grantIdInput.trim()}
          style={{ padding: "5px 12px", fontSize: "12px" }}
        >
          {loadingDiagnostics ? "Connecting..." : "Load Live Diagnostics"}
        </button>
        {activeGrantId ? (
          <button className="btn sm" onClick={clearGrant} style={{ padding: "5px 12px", fontSize: "12px" }}>
            Clear Grant
          </button>
        ) : null}
        <span style={{ fontSize: "11px", fontWeight: 600, color: activeGrantId ? "var(--ok)" : "var(--ink3)" }}>
          {activeGrantId ? "🟢 Live API Connected" : "⚪ Demo Mode"}
        </span>
      </div>
      {diagnosticsError ? (
        <div className="notice" style={{ margin: "10px 20px 0 20px", background: "var(--crit-soft)", borderColor: "var(--crit)", color: "var(--crit)" }}>
          <span>⚠️</span>
          <div>
            <b>Backend API Error:</b> {diagnosticsError}
          </div>
        </div>
      ) : null}

      <div className="shell">
        <nav className="rail">
          {NAV.map((item) => {
            const locked = item.leadOnly && role !== "lead";
            return (
              <button key={item.id} className={`railitem ${page === item.id ? "on" : ""} ${locked ? "locked" : ""}`} onClick={() => go(item.id as Page)}>
                <span className="ico">{item.ico}</span>
                <span>{item.label}</span>
                {item.cnt ? <span className="cnt">{item.cnt}</span> : null}
                {locked ? <span className="lk">🔒</span> : null}
              </button>
            );
          })}
        </nav>
        <main>{renderMain()}</main>
      </div>
    </div>
  );
}

function priorityPill(priority: string) {
  const tone = priority === "Urgent" || priority === "urgent" || priority === "URGENT" ? "crit" : priority === "High" || priority === "high" || priority === "HIGH" ? "warn" : priority === "Medium" || priority === "medium" || priority === "MEDIUM" ? "accent" : "nu";
  return <span className={`pill ${tone} dot-b`}>{priority}</span>;
}

function statusPill(status: string) {
  const tone =
    status === "Resolved" || status === "Closed" ? "ok"
    : status === "New" ? "accent"
    : status === "Waiting for Customer" ? "nu"
    : ["FAILED", "BOUNCED", "REJECTED", "BLOCKED"].includes(status) ? "crit"
    : ["RETRY", "PENDING", "RUNNING", "In Progress", "Open"].includes(status) ? "warn"
    : "nu";
  return <span className={`pill ${tone}`}>{status}</span>;
}

function slaFor(status: string): string {
  if (["FAILED", "BOUNCED", "REJECTED", "BLOCKED"].includes(status)) return "Breached";
  if (["RETRY", "PENDING", "RUNNING"].includes(status)) return "At risk";
  return "OK";
}

function timeAgo(value: string | number | Date): string {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : value;
  if (isNaN(date.getTime())) return "—";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function userStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE": return "Active";
    case "INVITED": return "Invited";
    case "PENDING_VERIFICATION": return "Pending";
    case "SUSPENDED": return "Suspended";
    case "DISABLED": return "Disabled";
    default: return status;
  }
}

function slaPill(sla: string) {
  const tone = sla === "Breached" ? "crit" : sla === "At risk" ? "warn" : "ok";
  return <span className={`pill ${tone}`}>{sla}</span>;
}

function row(title: string, sub: string, meta: string, tone = "nu") {
  return (
    <div className="row">
      <div className="tx">
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      <div className="sp">
        <span className={`pill ${tone}`}>{meta}</span>
      </div>
    </div>
  );
}

function kv(label: string, value: string, masked = false) {
  return (
    <div className="kv">
      <span>{label}</span>
      <span className={masked ? "masked" : ""}>{value}</span>
    </div>
  );
}

export const supportStyles = `
:root {
  --ground:#EEF2F5;--surface:#FFFFFF;--s2:#F6F9FB;--s3:#EAF0F4;
  --border:#DBE3EA;--bstrong:#C2CED8;
  --ink:#0A141D;--ink2:#33465A;--ink3:#6C8092;
  --accent:#0A7EA4;--accent-ink:#075D7A;--accent-soft:#DFF0F6;
  --ai:#5B54E8;--ai-soft:#EAE9FD;
  --ok:#12855B;--ok-soft:#E0F2E9;
  --warn:#A57400;--warn-soft:#F8EFD9;
  --crit:#CE3226;--crit-soft:#FBE7E5;
  --violet:#7B3FA0;--violet-soft:#F1E5F7;
  --sh1: 0 1px 2px rgba(10, 20, 29, 0.05);
  --sh3: 0 2px 4px rgba(10, 20, 29, 0.08), 0 24px 56px -12px rgba(10, 20, 29, 0.30);
  --ui:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mo:ui-monospace,"SF Mono",SFMono-Regular,"Cascadia Mono","Segoe UI Mono",Menlo,Consolas,monospace;
  --ed:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
}

:root[data-theme="dark"], .dark {
  --ground:#05090D;--surface:#0F1821;--s2:#141E28;--s3:#1A2530;
  --border:#202D39;--bstrong:#324351;
  --ink:#E6EDF3;--ink2:#A4B5C3;--ink3:#6F8397;
  --accent:#289AC6;--accent-ink:#7FCDE8;--accent-soft:#0B2A38;
  --ai:#7A72F2;--ai-soft:#191838;
  --ok:#25A878;--ok-soft:#0C2A1F;
  --warn:#BC8A2A;--warn-soft:#2B2110;
  --crit:#E2564A;--crit-soft:#31150F;
  --violet:#B18CD9;--violet-soft:#2A1B38;
  --sh1: 0 1px 2px rgba(0, 0, 0, 0.35);
  --sh3: 0 2px 4px rgba(0, 0, 0, 0.45), 0 24px 56px -12px rgba(0, 0, 0, 0.60);
}

.support-workspace * { box-sizing: border-box; }
.support-workspace { min-height: 100vh; background: var(--ground); color: var(--ink); font-family: var(--ui); font-size: 13.3px; line-height: 1.5; }
.support-workspace button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.support-workspace input, .support-workspace select, .support-workspace textarea { font: inherit; color: inherit; }
.support-workspace a { color: var(--accent); text-decoration: none; }
.support-workspace .mo { font-family: var(--mo); font-variant-numeric: tabular-nums; }
.support-workspace .topbar { display: flex; align-items: center; gap: 14px; padding: 10px 20px; background: var(--s2); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 40; }
.support-workspace .brand { display: flex; align-items: center; gap: 9px; }
.support-workspace .bmark { width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: white; display: grid; place-items: center; font-size: 13px; font-weight: 700; flex: none; font-family: var(--ed); }
.support-workspace .bname { font-size: 13.5px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.1; }
.support-workspace .bsub { font-family: var(--mo); font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); }
.support-workspace .gsearch { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 7px 12px; width: 340px; color: var(--ink3); margin-left: 10px; }
.support-workspace .gsearch input { border: 0; outline: 0; background: none; flex: 1; font-size: 12.5px; color: var(--ink); }
.support-workspace .topbar .sp { margin-left: auto; }
.support-workspace .iconbtn { position: relative; width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; color: var(--ink2); border: 1px solid transparent; }
.support-workspace .iconbtn:hover { background: var(--s3); border-color: var(--border); }
.support-workspace .badge-dot { position: absolute; top: 5px; right: 6px; width: 7px; height: 7px; border-radius: 50%; background: var(--crit); border: 1.5px solid var(--s2); }
.support-workspace .demoswitch { display: flex; gap: 3px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
.support-workspace .demoswitch button { padding: 5px 10px; border-radius: 6px; font-size: 10.8px; font-weight: 650; color: var(--ink3); }
.support-workspace .demoswitch button.on { background: var(--ink); color: var(--surface); }
.support-workspace .demoswitch .lbl { font-family: var(--mo); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); padding: 0 6px; align-self: center; }
.support-workspace .who { display: flex; align-items: center; gap: 8px; position: relative; }
.support-workspace .avatar { width: 27px; height: 27px; border-radius: 50%; background: var(--violet-soft); color: var(--violet); display: grid; place-items: center; font-size: 11px; font-weight: 700; flex: none; }
.support-workspace .who b { font-size: 12px; display: block; }
.support-workspace .who span { font-size: 10px; color: var(--ink3); }
.support-workspace .dropdown { position: absolute; top: calc(100% + 8px); right: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--sh3); min-width: 230px; z-index: 60; overflow: hidden; }
.support-workspace .dropdown .dhd { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 11.5px; color: var(--ink3); }
.support-workspace .dropdown .ditem { display: flex; gap: 9px; align-items: flex-start; padding: 10px 14px; border-bottom: 1px solid var(--border); }
.support-workspace .dropdown .ditem:last-child { border-bottom: 0; }
.support-workspace .dropdown .ditem:hover { background: var(--s2); }
.support-workspace .dropdown .ditem b { font-size: 12px; display: block; }
.support-workspace .dropdown .ditem span { font-size: 10.8px; color: var(--ink3); }
.support-workspace .dropdown button.ditem { width: 100%; text-align: left; }
.support-workspace .shell { display: grid; grid-template-columns: 216px 1fr; min-height: calc(100vh - 54px); }
.support-workspace .rail { background: var(--s2); border-right: 1px solid var(--border); padding: 14px 0; display: flex; flex-direction: column; position: sticky; top: 54px; height: calc(100vh - 54px); overflow-y: auto; }
.support-workspace .railitem { display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 18px; font-size: 12.6px; font-weight: 560; color: var(--ink2); border-left: 2px solid transparent; text-align: left; }
.support-workspace .railitem .ico { width: 17px; text-align: center; flex: none; font-size: 13px; }
.support-workspace .railitem:hover { background: var(--s3); }
.support-workspace .railitem.on { background: var(--surface); color: var(--ink); border-left: 2px solid var(--accent); font-weight: 650; }
.support-workspace .railitem .cnt { margin-left: auto; font-family: var(--mo); font-size: 9.5px; color: var(--ink3); background: var(--s3); border-radius: 9px; padding: 1px 6px; }
.support-workspace .railitem.locked { opacity: 0.5; }
.support-workspace .railitem .lk { margin-left: auto; font-size: 11px; }
.support-workspace main { padding: 22px 26px 60px; max-width: 1320px; }
.support-workspace .crumbs { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink3); margin-bottom: 10px; }
.support-workspace .crumbs a { color: var(--ink3); }
.support-workspace .crumbs .cur { color: var(--ink); }
.support-workspace .pagehd { margin-bottom: 18px; display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.support-workspace .pagehd h1 { font-family: var(--ed); font-weight: 400; font-size: 23px; letter-spacing: -0.015em; margin: 0 0 3px; }
.support-workspace .pagehd p { margin: 0; color: var(--ink3); font-size: 12.4px; }
.support-workspace .pagehd .sp { margin-left: auto; display: flex; gap: 8px; }
.support-workspace .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 11px; margin-bottom: 20px; }
.support-workspace .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 13px 15px; box-shadow: var(--sh1); }
.support-workspace .stat .lbl { font-family: var(--mo); font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink3); }
.support-workspace .stat .val { font-size: 22px; font-weight: 650; margin-top: 5px; letter-spacing: -0.01em; }
.support-workspace .stat .sub { font-size: 10.8px; color: var(--ink3); margin-top: 2px; }
.support-workspace .stat.ok .val { color: var(--ok); }
.support-workspace .stat.warn .val { color: var(--warn); }
.support-workspace .stat.crit .val { color: var(--crit); }
.support-workspace .stat.ai .val { color: var(--ai); }
.support-workspace .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--sh1); margin-bottom: 16px; overflow: hidden; }
.support-workspace .card .hd { display: flex; align-items: center; gap: 10px; padding: 13px 17px; border-bottom: 1px solid var(--border); }
.support-workspace .card .hd h2 { font-size: 13.6px; font-weight: 650; margin: 0; }
.support-workspace .card .hd .sp { margin-left: auto; display: flex; gap: 8px; }
.support-workspace .card .bd { padding: 4px 0; }
.support-workspace .card .bd.pad { padding: 15px 17px; }
.support-workspace table { width: 100%; border-collapse: collapse; }
.support-workspace th { text-align: left; font-family: var(--mo); font-size: 9.6px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); padding: 9px 17px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.support-workspace td { padding: 10px 17px; border-bottom: 1px solid var(--border); font-size: 12.4px; vertical-align: middle; }
.support-workspace tr:last-child td { border-bottom: 0; }
.support-workspace tr.clickable:hover td { background: var(--s2); cursor: pointer; }
.support-workspace .nm { font-weight: 650; }
.support-workspace .muted { color: var(--ink3); }
.support-workspace .row { display: flex; align-items: center; gap: 12px; padding: 12px 17px; border-bottom: 1px solid var(--border); }
.support-workspace .row:last-child { border-bottom: 0; }
.support-workspace .row .tx { flex: 1; min-width: 0; }
.support-workspace .row .tx b { font-size: 12.4px; display: block; }
.support-workspace .row .tx span { font-size: 10.8px; color: var(--ink3); }
.support-workspace .row .sp { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.support-workspace .btn { border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 6px 12px; font-size: 11.3px; font-weight: 600; color: var(--ink2); }
.support-workspace .btn:hover { border-color: var(--bstrong); }
.support-workspace .btn.pri { background: var(--accent); border-color: var(--accent); color: white; }
.support-workspace .btn.sm { padding: 4px 9px; font-size: 10.6px; }
.support-workspace .pill { display: inline-flex; align-items: center; gap: 5px; font-size: 10.4px; font-weight: 650; padding: 3px 9px; border-radius: 20px; letter-spacing: 0.01em; white-space: nowrap; }
.support-workspace .pill.ok { background: var(--ok-soft); color: var(--ok); }
.support-workspace .pill.warn { background: var(--warn-soft); color: var(--warn); }
.support-workspace .pill.crit { background: var(--crit-soft); color: var(--crit); }
.support-workspace .pill.ai { background: var(--ai-soft); color: var(--ai); }
.support-workspace .pill.nu { background: var(--s3); color: var(--ink3); }
.support-workspace .pill.accent { background: var(--accent-soft); color: var(--accent-ink); }
.support-workspace .pill.violet { background: var(--violet-soft); color: var(--violet); }
.support-workspace .dot-b::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; display: inline-block; }
.support-workspace .filterbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.support-workspace .fselect { border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 6px 10px; font-size: 11.5px; color: var(--ink2); }
.support-workspace .searchin { display: flex; align-items: center; gap: 7px; border: 1px solid var(--border); background: var(--surface); border-radius: 7px; padding: 6px 11px; min-width: 220px; }
.support-workspace .searchin input { border: 0; outline: 0; background: none; flex: 1; font-size: 12px; }
.support-workspace .chip { border: 1px solid var(--border); background: var(--surface); border-radius: 20px; padding: 5px 12px; font-size: 11px; font-weight: 600; color: var(--ink2); }
.support-workspace .chip.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.support-workspace .notice { display: flex; gap: 10px; align-items: flex-start; background: var(--ai-soft); border: 1px solid var(--ai); border-radius: 10px; padding: 11px 14px; margin-bottom: 15px; font-size: 11.8px; color: var(--ink2); }
.support-workspace .notice b { color: var(--ai); }
.support-workspace .split { display: grid; grid-template-columns: 1fr 320px; gap: 16px; }
.support-workspace .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); padding: 0 17px; }
.support-workspace .tab { padding: 10px 13px; font-size: 12px; font-weight: 650; color: var(--ink3); border-bottom: 2px solid transparent; }
.support-workspace .tab.on { color: var(--ink); border-bottom-color: var(--accent); }
.support-workspace .thread { padding: 14px 17px; }
.support-workspace .msg { display: flex; gap: 10px; margin-bottom: 14px; }
.support-workspace .msg .av { width: 26px; height: 26px; border-radius: 50%; background: var(--s3); color: var(--ink2); display: grid; place-items: center; font-size: 10px; font-weight: 700; flex: none; }
.support-workspace .msg .bub { flex: 1; }
.support-workspace .msg .bub .hd2 { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.support-workspace .msg .bub .hd2 b { font-size: 12.2px; }
.support-workspace .msg .bub .hd2 span { font-size: 10.5px; color: var(--ink3); }
.support-workspace .msg .bub .txt { background: var(--s2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 13px; font-size: 12.3px; color: var(--ink2); }
.support-workspace .msg.support .bub .txt { background: var(--accent-soft); border-color: var(--accent-soft); }
.support-workspace .composer { border-top: 1px solid var(--border); padding: 14px 17px; }
.support-workspace .composer textarea { width: 100%; min-height: 76px; border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; font-size: 12.4px; resize: vertical; }
.support-workspace .composer .bar { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.support-workspace .visitoggle { display: flex; gap: 2px; background: var(--s3); border-radius: 7px; padding: 2px; }
.support-workspace .visitoggle button { padding: 5px 10px; border-radius: 5px; font-size: 10.8px; font-weight: 650; color: var(--ink3); }
.support-workspace .visitoggle button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh1); }
.support-workspace .sidepane .block { border-bottom: 1px solid var(--border); padding: 13px 17px; }
.support-workspace .sidepane .block:last-child { border-bottom: 0; }
.support-workspace .sidepane .block h3 { font-size: 10.8px; text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--mo); color: var(--ink3); margin: 0 0 9px; }
.support-workspace .kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 6px; }
.support-workspace .kv span:first-child { color: var(--ink3); }
.support-workspace .kv span:last-child { font-weight: 600; text-align: right; }
.support-workspace .masked { font-family: var(--mo); letter-spacing: 0.02em; }
.support-workspace .kbcat { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
.support-workspace .kbcatcard { background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 15px; cursor: pointer; }
.support-workspace .kbcatcard:hover { border-color: var(--bstrong); }
.support-workspace .kbcatcard .n { font-size: 20px; margin-bottom: 6px; }
.support-workspace .kbcatcard b { font-size: 12.6px; display: block; margin-bottom: 2px; }
.support-workspace .kbcatcard span { font-size: 10.8px; color: var(--ink3); }
.support-workspace .deniedwrap { padding: 60px 20px; text-align: center; }
.support-workspace .deniedwrap .ic { font-size: 34px; margin-bottom: 12px; }
.support-workspace .deniedwrap b { display: block; font-size: 15px; margin-bottom: 6px; }
.support-workspace .deniedwrap p { color: var(--ink3); font-size: 12.4px; max-width: 380px; margin: 0 auto; }
.support-workspace .field { margin-bottom: 13px; }
.support-workspace .field label { display: block; font-size: 11px; color: var(--ink3); margin-bottom: 5px; font-weight: 600; }
.support-workspace .field input, .support-workspace .field select, .support-workspace .field textarea { width: 100%; border: 1px solid var(--border); border-radius: 7px; padding: 8px 11px; font-size: 12.6px; background: var(--surface); color: var(--ink); }
.support-workspace .field textarea { min-height: 70px; resize: vertical; }
@media (max-width: 980px) {
  .support-workspace .shell { grid-template-columns: 64px 1fr; }
  .support-workspace .railitem span:not(.ico):not(.cnt) { display: none; }
}
@media (max-width: 1050px) {
  .support-workspace .split { grid-template-columns: 1fr; }
}
`;
