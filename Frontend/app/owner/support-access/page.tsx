"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useSupportGrants, useCreateSupportGrant, useRevokeSupportGrant, useMembers } from "@/lib/owner-hooks";
import type { SupportGrant } from "@/lib/owner-api";
import { ShieldCheck, Plus, Trash2, Clock, AlertCircle, CheckCircle2, XCircle, FileText, ExternalLink } from "lucide-react";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
};

export default function SupportAccessPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    supportMembershipId: "",
    reason: "",
    ticketId: "",
    expiresInMinutes: 60,
    scopes: ["TENANT_DIAGNOSTICS"] as string[],
  });

  const { data: grants = [], isLoading: grantsLoading } = useSupportGrants();
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const createGrant = useCreateSupportGrant();
  const revokeGrant = useRevokeSupportGrant();

  const supportMembers = members.filter((m) => m.role === "SUPPORT" && m.status === "ACTIVE");

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
      scopes: formData.scopes as any[],
    });
    setCreateOpen(false);
    setFormData({ supportMembershipId: "", reason: "", ticketId: "", expiresInMinutes: 60, scopes: ["TENANT_DIAGNOSTICS"] });
  };

  const handleRevoke = (grantId: string) => {
    revokeGrant.mutate(grantId);
    setRevokeTarget(null);
  };

  return (
    <ProtectedRoute allowedRoles={["OWNER"]}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Support Access"
          description="Manage Zoiko Support access grants for this workspace. Grants are time-bound, require a reason, and are fully audited."
        />

        {/* Create Grant Button */}
        <div className="zoiko-card p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-[var(--ink)]">Create New Grant</h3>
            <button
              onClick={() => setCreateOpen(true)}
              disabled={supportMembers.length === 0}
              className="zoiko-btn pri"
            >
              <Plus className="h-3.5 w-3.5" /> Grant Support Access
            </button>
          </div>

          {supportMembers.length === 0 && (
            <div className="rounded-lg bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">
              No active SUPPORT members in this workspace. Invite a SUPPORT member from{" "}
              <a href="/owner/users" className="underline">Users & Roles</a> first.
            </div>
          )}
        </div>

        {/* Grants List */}
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
                No support access grants yet. Create one to allow Zoiko Support to access this workspace.
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
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${statusConfig.bg}`}>
                          <statusConfig.icon className={`h-4 w-4 ${statusConfig.color}`} />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--ink)]">{grant.supportUser.displayName || grant.supportUser.email}</span>
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
                              <span key={scope} className="zoiko-pill nu text-[10px]">{scopeLabels[scope] || scope}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:ml-4">
                        {status === "active" && (
                          <button
                            onClick={() => setRevokeTarget(grant.id)}
                            className="zoiko-btn sm crit"
                          >
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
                disabled={createGrant.isPending || !formData.supportMembershipId || !formData.reason || formData.scopes.length === 0}
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
                <a href="/owner/users" className="underline">Users & Roles</a> first.
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
                min={15}
                max={10080}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Scopes</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(scopeLabels).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition">
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