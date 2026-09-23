"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { useCan } from "@/lib/admin-capabilities";
import {
  useSupportGrants,
  useCreateSupportGrant,
  useRevokeSupportGrant,
  useMembers,
  useSupportAccessRequests,
  useApproveSupportAccess,
  useDenySupportAccess,
} from "@/lib/owner-hooks";
import type { SupportGrant, SupportAccessRequest } from "@/lib/owner-api";
import {
  Plus,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

/**
 * Deciding who from Zoiko support may read this workspace — Runbook §7.
 *
 * Two routes to a grant, and this screen carries both because they are the
 * same decision arrived at from opposite ends.
 *
 * A support member asks, and the Owner answers. That is the common case: the
 * agent is already on a ticket, knows what they need and for how long, and
 * the request arrives with its own attribution. It also means an Owner is
 * never asked to invent a reason for access somebody else needs.
 *
 * Or the Owner opens access unprompted — handing a case to support before
 * anyone has asked, which is what the "Grant support access" button is for.
 *
 * Both produce the same audited, expiring grant, and both are listed
 * together below, because "who can read my workspace right now" is one
 * question regardless of how it came to be true.
 */

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExpiry(expiresAt: string) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function getGrantStatus(grant: SupportGrant): "active" | "expired" | "revoked" {
  if (grant.revokedAt) return "revoked";
  if (new Date(grant.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

const scopeLabels: Record<string, string> = {
  TENANT_DIAGNOSTICS: "Tenant Diagnostics",
  DNS_DIAGNOSTICS: "DNS Diagnostics",
  DELIVERY_DIAGNOSTICS: "Delivery Diagnostics",
  AUDIT_READ: "Audit Read",
  MAILBOX_ADMIN: "Reset a mailbox setting",
  MAIL_CONTENT: "Read inside a mailbox",
};

/**
 * The one scope that is not routine.
 *
 * RBAC §2 gives Support "Read private user mailbox" only through a grant and
 * Security §4 calls it "blocked by default; exceptional security-approved
 * path only". An owner skimming a row of identical grey chips would approve
 * it without noticing, which is the outcome those two lines exist to
 * prevent.
 */
const EXCEPTIONAL_SCOPES = new Set(["MAIL_CONTENT"]);

export default function SupportAccessPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    supportMembershipId: "",
    reason: "",
    ticketId: "",
    expiresInMinutes: 60,
    scopes: ["TENANT_DIAGNOSTICS"] as string[],
  });

  const { data: grants = [], isLoading: grantsLoading } = useSupportGrants();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: requestData, isLoading: requestsLoading } = useSupportAccessRequests();
  const createGrant = useCreateSupportGrant();
  const revokeGrant = useRevokeSupportGrant();
  const approve = useApproveSupportAccess();
  const deny = useDenySupportAccess();
  const stepUp = useStepUp();
  const can = useCan();

  // RBAC §2: "Approve support access" is Owner Yes, Admin No — so an Admin
  // reaching this screen sees everything and can decline or revoke, but is
  // not offered a button the server will refuse. Declining is not the same
  // decision as opening access, and making the Owner the only person who can
  // say no would leave requests sitting unanswered.
  const canGrant = can("support.grant.create");
  const canEnd = can("support.grant.end");

  const supportMembers = members.filter((m) => m.role === "SUPPORT" && m.status === "ACTIVE");
  const requests = requestData?.requests ?? [];
  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  const handleScopeToggle = (scope: string) => {
    setFormData((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const handleSubmit = () => {
    if (!formData.supportMembershipId || !formData.reason || formData.scopes.length === 0) return;
    createGrant.mutate({
      supportMembershipId: formData.supportMembershipId,
      reason: formData.reason,
      ticketId: formData.ticketId || undefined,
      expiresInMinutes: formData.expiresInMinutes,
      scopes: formData.scopes as SupportGrant["scopes"],
    });
    setCreateOpen(false);
    setFormData({
      supportMembershipId: "",
      reason: "",
      ticketId: "",
      expiresInMinutes: 60,
      scopes: ["TENANT_DIAGNOSTICS"],
    });
  };

  const handleRevoke = (grantId: string) => {
    revokeGrant.mutate(grantId);
    setRevokeTarget(null);
  };

  const onApprove = (r: SupportAccessRequest) => {
    setFailed(null);
    void stepUp.attempt(
      `Approving support access for ${r.supportMembership.user.email}`,
      (token) =>
        approve
          .mutateAsync({ requestId: r.id, stepUpToken: token, minutes: minutes[r.id] })
          .catch((e: unknown) => {
            setFailed(e instanceof Error ? e.message : "Could not approve that request.");
            throw e;
          })
    );
  };

  const onDeny = (r: SupportAccessRequest) => {
    setFailed(null);
    deny.mutate(
      { requestId: r.id },
      {
        onError: (e) =>
          setFailed(e instanceof Error ? e.message : "Could not decline that request."),
      }
    );
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <StepUpDialog {...stepUp.dialog} />

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Support Access"
          description="Zoiko Support has no standing access to this workspace. Each grant is time-bound, tied to a case, and every read it allows is recorded in your audit log."
        />

        {failed && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {failed}
          </div>
        )}

        {/* ── Requests waiting on a decision ───────────────────────────── */}
        <div className="zoiko-card">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Waiting for your decision
              {pending.length > 0 && (
                <span className="ml-2 rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--warn)]">
                  {pending.length}
                </span>
              )}
            </h3>
          </div>

          {!canGrant && pending.length > 0 && (
            <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] text-[var(--ink3)]">
              Only a workspace owner can approve support access. You can decline a request.
            </div>
          )}

          <div className="divide-y divide-[var(--border)]">
            {requestsLoading ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">Loading…</div>
            ) : pending.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">
                Nothing waiting. Support will appear here when they ask for access, and you will
                get a notification.
              </div>
            ) : (
              pending.map((r) => (
                <div key={r.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--ink)]">
                        {r.supportMembership.user.displayName}{" "}
                        <span className="font-normal text-[var(--ink3)]">
                          ({r.supportMembership.user.email})
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink2)]">{r.reason}</p>

                      {r.scopes.some((sc) => EXCEPTIONAL_SCOPES.has(sc)) && (
                        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          This request includes reading inside a member&apos;s mailbox. Support
                          would see message senders, recipients, subjects and delivery status —
                          not message bodies. Approve it only if the case needs it.
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--ink3)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden />
                          asked {formatDate(r.createdAt)}
                        </span>
                        {r.ticket && (
                          <span className="zoiko-pill nu text-[10px]">
                            #{r.ticket.ticketNumber} {r.ticket.subject}
                          </span>
                        )}
                        {r.scopes.map((sc) => (
                          <span
                            key={sc}
                            className={
                              EXCEPTIONAL_SCOPES.has(sc)
                                ? "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
                                : "zoiko-pill nu text-[10px]"
                            }
                          >
                            {scopeLabels[sc] ?? sc}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/*
                        The approver may shorten the window but not lengthen
                        it — the server caps at what was asked for, so the
                        request stays the thing being approved.
                      */}
                      <label className="sr-only" htmlFor={`minutes-${r.id}`}>
                        Minutes of access to grant
                      </label>
                      <input
                        id={`minutes-${r.id}`}
                        type="number"
                        min={5}
                        max={r.requestedMinutes}
                        defaultValue={r.requestedMinutes}
                        onChange={(e) =>
                          setMinutes((m) => ({ ...m, [r.id]: Number(e.target.value) }))
                        }
                        className="h-8 w-20 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
                      />
                      <span className="text-[11px] text-[var(--ink3)]">min</span>

                      {canGrant && (
                        <button
                          type="button"
                          onClick={() => onApprove(r)}
                          disabled={approve.isPending}
                          className="zoiko-btn pri sm"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Approve
                        </button>
                      )}
                      {canEnd && (
                        <button
                          type="button"
                          onClick={() => onDeny(r)}
                          disabled={deny.isPending}
                          className="zoiko-btn sm"
                        >
                          <ShieldOff className="h-3.5 w-3.5" aria-hidden /> Decline
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Opening access unprompted ────────────────────────────────── */}
        {canGrant && (
          <div className="zoiko-card p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)]">Open access yourself</h3>
                <p className="mt-1 text-[11px] text-[var(--ink3)]">
                  For handing a case to support before anyone has asked.
                </p>
              </div>
              <button
                onClick={() => setCreateOpen(true)}
                disabled={supportMembers.length === 0}
                className="zoiko-btn pri"
              >
                <Plus className="h-3.5 w-3.5" /> Grant Support Access
              </button>
            </div>

            {supportMembers.length === 0 && !membersLoading && (
              <div className="rounded-lg bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">
                No active SUPPORT members in this workspace. Invite a SUPPORT member from{" "}
                <a href="/owner/users" className="underline">
                  Users &amp; Roles
                </a>{" "}
                first.
              </div>
            )}
          </div>
        )}

        {/* ── Every grant, however it came to exist ────────────────────── */}
        <div className="zoiko-card">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Support Access Grants
              <span className="ml-2 text-[11px] text-[var(--ink3)]">({grants.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {grantsLoading ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">Loading…</div>
            ) : grants.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ink3)]">
                No support access grants yet. Nobody outside this workspace can read it.
              </div>
            ) : (
              grants.map((grant) => {
                const status = getGrantStatus(grant);
                const statusConfig = {
                  active: { variant: "ok" as const, icon: CheckCircle2, bg: "bg-[var(--ok-soft)]", color: "text-[var(--ok)]" },
                  expired: { variant: "warn" as const, icon: Clock, bg: "bg-[var(--warn-soft)]", color: "text-[var(--warn)]" },
                  revoked: { variant: "nu" as const, icon: XCircle, bg: "bg-[var(--crit-soft)]", color: "text-[var(--crit)]" },
                }[status];

                return (
                  <div key={grant.id} className="px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${statusConfig.bg}`}>
                          <statusConfig.icon className={`h-4 w-4 ${statusConfig.color}`} />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--ink)]">
                              {grant.supportUser.displayName || grant.supportUser.email}
                            </span>
                            <StatusBadge variant={statusConfig.variant} dot>{status}</StatusBadge>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--ink3)]">
                            <span>Reason: <code className="rounded bg-[var(--s2)] px-1 py-0.5">{grant.reason || "—"}</code></span>
                            {grant.ticketId && <span>Ticket: <code className="rounded bg-[var(--s2)] px-1 py-0.5">{grant.ticketId.slice(0, 8)}</code></span>}
                            <span>Approved by: {grant.approver?.displayName || grant.approvedByUserId || "—"}</span>
                            <span>Expires: {formatDate(grant.expiresAt)} ({formatExpiry(grant.expiresAt)})</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {grant.scopes.map((scope: string) => (
                              <span
                                key={scope}
                                className={
                                  EXCEPTIONAL_SCOPES.has(scope)
                                    ? "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"
                                    : "zoiko-pill nu text-[10px]"
                                }
                              >
                                {scopeLabels[scope] || scope}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:ml-4">
                        {status === "active" && canEnd && (
                          <button onClick={() => setRevokeTarget(grant.id)} className="zoiko-btn sm crit">
                            <Trash2 className="h-3 w-3" /> Revoke
                          </button>
                        )}
                        <a
                          href={`/owner/audit-logs?grantId=${grant.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="zoiko-btn sm"
                        >
                          <FileText className="h-3 w-3" /> Audit
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Requests already answered ────────────────────────────────── */}
        {decided.length > 0 && (
          <div className="zoiko-card">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--ink)]">Already decided</h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {decided.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 truncate text-[var(--ink2)]">
                    {r.supportMembership.user.email} — {r.reason}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--ink3)]">
                    {r.status.toLowerCase()}
                    {r.decidedBy ? ` by ${r.decidedBy.displayName}` : ""}
                    {r.decidedAt ? ` · ${formatDate(r.decidedAt)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create Grant Modal */}
        <Modal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Grant Support Access"
          size="lg"
          footer={
            <>
              <button onClick={() => setCreateOpen(false)} className="zoiko-btn" disabled={createGrant.isPending}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="zoiko-btn pri"
                disabled={
                  createGrant.isPending ||
                  !formData.supportMembershipId ||
                  !formData.reason ||
                  formData.scopes.length === 0
                }
              >
                {createGrant.isPending ? "Creating…" : "Create Grant"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {supportMembers.length === 0 && (
              <div className="rounded-lg bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">
                No active SUPPORT members in this workspace. Invite a SUPPORT member from{" "}
                <a href="/owner/users" className="underline">Users &amp; Roles</a> first.
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Support Member</label>
              <select
                value={formData.supportMembershipId}
                onChange={(e) => setFormData({ ...formData, supportMembershipId: e.target.value })}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="">Select a SUPPORT member</option>
                {supportMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName} ({m.email})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Reason (required)</label>
              <textarea
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                rows={3}
                placeholder="Explain why support access is needed. Reference a ticket or name the incident."
                className="h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Ticket ID (optional)</label>
              <input
                type="text"
                value={formData.ticketId}
                onChange={(e) => setFormData({ ...formData, ticketId: e.target.value })}
                placeholder="e.g. TKT-00123"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Expires In (minutes)</label>
              <input
                type="number"
                value={formData.expiresInMinutes}
                onChange={(e) => setFormData({ ...formData, expiresInMinutes: parseInt(e.target.value) || 60 })}
                min={5}
                max={240}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Scopes</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(scopeLabels).map(([key, label]) => (
                  <label
                    key={key}
                    className={
                      EXCEPTIONAL_SCOPES.has(key)
                        ? "flex cursor-pointer items-center gap-2 rounded-lg border border-amber-300 px-3 py-2 transition dark:border-amber-800"
                        : "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition"
                    }
                    title={
                      EXCEPTIONAL_SCOPES.has(key)
                        ? "Exceptional: lets support see senders, recipients and subjects inside a member's mailbox. Not message bodies."
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={formData.scopes.includes(key)}
                      onChange={() => handleScopeToggle(key)}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span className="text-sm text-[var(--ink)]">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Modal>

        {/* Revoke Confirm Dialog */}
        <ConfirmDialog
          open={!!revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onConfirm={() => handleRevoke(revokeTarget!)}
          title="Revoke Support Access"
          message="This will immediately revoke the support access grant. The support user will lose access to this workspace. This action cannot be undone."
          confirmLabel="Revoke"
          variant="danger"
          loading={revokeGrant.isPending}
        />
      </div>
    </ProtectedRoute>
  );
}
