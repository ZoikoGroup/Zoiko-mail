"use client";

import { useState } from "react";
import { Users, KeyRound, AlertCircle, CheckCircle, XCircle, Clock, ArrowRight, Loader2, Shield } from "lucide-react";
import { useMe } from "@/lib/auth-hooks";
import { useMembers, useOwnershipTransfers, useInitiateOwnershipTransfer, useApproveOwnershipTransfer, useCancelOwnershipTransfer } from "@/lib/owner-hooks";
import type { Member } from "@/lib/owner-api";
import type { MeResponse } from "@/lib/auth-api";
import {
  Card,
  InlineEmpty,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  StaticNote,
  Table,
  TableWrap,
  Td,
  Th,
  type Tone,
} from "@/components/admin/ui";

const ROLE_TONE: Record<Member["role"], Tone> = {
  OWNER: "accent",
  ADMIN: "ai",
  MEMBER: "nu",
  SUPPORT: "warn",
};

const STATUS_TONE: Record<string, Tone> = {
  PENDING: "warn",
  COMPLETED: "ok",
  CANCELLED: "crit",
};

export default function OwnershipTransferPage() {
  const { data: me } = useMe();
  const currentUserId = (me as MeResponse | undefined)?.id;
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: transfers = [], isLoading: transfersLoading, refetch } = useOwnershipTransfers();
  const initiateTransfer = useInitiateOwnershipTransfer();
  const approveTransfer = useApproveOwnershipTransfer();
  const cancelTransfer = useCancelOwnershipTransfer();

  const [showInitiateDialog, setShowInitiateDialog] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState(false);

  const eligibleTargets = members.filter(
    (m) => m.status === "ACTIVE" && m.role !== "OWNER"
  );

  const pendingTransfer = transfers.find((t) => t.status === "PENDING");

  const handleInitiate = async () => {
    if (!selectedTargetId) return;
    setIsActionPending(true);
    try {
      await initiateTransfer.mutateAsync(selectedTargetId);
      setShowInitiateDialog(false);
      setSelectedTargetId(null);
      await refetch();
    } catch {
      // Error handled by mutation
    } finally {
      setIsActionPending(false);
    }
  };

  const handleApprove = async (transferId: string) => {
    setIsActionPending(true);
    try {
      await approveTransfer.mutateAsync(transferId);
      await refetch();
    } finally {
      setIsActionPending(false);
    }
  };

  const handleCancel = async (transferId: string) => {
    if (!window.confirm("Cancel this ownership transfer request?")) return;
    setIsActionPending(true);
    try {
      await cancelTransfer.mutateAsync(transferId);
      await refetch();
    } finally {
      setIsActionPending(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Ownership Transfer"
        subtitle="Transfer workspace ownership to another Owner (requires two-person approval)"
      />

      <StaticNote>
        Ownership changes hands through a two-step process: an Owner initiates the transfer, and a <b>different</b> Owner must approve it. The initiator is demoted to Admin and the target is promoted to Owner in a single atomic transaction.
      </StaticNote>

      {/* Warning if there's a pending transfer */}
      {pendingTransfer && (
        <Notice tone="warn">
          <b className="text-[var(--warn)]">A transfer is pending approval.</b>{" "}
          <span className="font-mono-num ml-2">{pendingTransfer.initiator.displayName}</span> initiated transfer to{" "}
          <span className="font-mono-num ml-2">{pendingTransfer.targetMembership.user.displayName}</span>.
        </Notice>
      )}

      {/* Initiate Transfer Dialog */}
      {showInitiateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <h2 className="mb-4 font-semibold text-[var(--ink)]">Initiate Ownership Transfer</h2>
            <p className="mb-4 text-sm text-[var(--ink3)]">
              Select a member to become the new Owner. They must accept the transfer, and a
              <b>different Owner</b> must approve it.
            </p>

            {eligibleTargets.length === 0 ? (
              <div className="mb-4 rounded-lg bg-[var(--warn-soft)] p-3 text-sm text-[var(--warn)]">
                No eligible members. Only active non-Owner members can be transferred to.
              </div>
            ) : (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-[var(--ink2)]">Select Member</label>
                <select
                  value={selectedTargetId ?? ""}
                  onChange={(e) => setSelectedTargetId(e.target.value || null)}
                  className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  disabled={isActionPending}
                >
                  <option value="">Choose a member…</option>
                  {eligibleTargets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.email}) — {m.role}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowInitiateDialog(false)}
                disabled={isActionPending}
                className="flex-1 zoiko-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitiate}
                disabled={isActionPending || !selectedTargetId || eligibleTargets.length === 0}
                className="flex-1 zoiko-btn pri"
              >
                {isActionPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Initiate Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Current/Pending Transfers */}
      <Card title={transfers.length > 0 ? "Transfers" : "No Transfers"} badge={transfers.length === 0 ? null : undefined}>
        {transfersLoading ? (
          <LoadingRows rows={3} />
        ) : transfers.length === 0 ? (
          <InlineEmpty title="No transfers yet" hint="Initiate a transfer to change workspace ownership." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Initiator</Th>
                  <Th>Target</Th>
                  <Th>Status</Th>
                  <Th>Approved By</Th>
                  <Th>Created</Th>
                  <Th>Completed</Th>
                  <Th srOnly>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <Td>
                      <div className="font-medium text-[var(--ink)]">{transfer.initiator.displayName}</div>
                      <div className="font-mono-num text-[10.5px] text-[var(--ink3)]">{transfer.initiator.email}</div>
                    </Td>
                    <Td>
                      <div className="font-medium text-[var(--ink)]">{transfer.targetMembership.user.displayName}</div>
                      <div className="font-mono-num text-[10.5px] text-[var(--ink3)]">{transfer.targetMembership.user.email}</div>
                    </Td>
                    <Td>
                      <Pill tone={STATUS_TONE[transfer.status] ?? "nu"}>{transfer.status}</Pill>
                    </Td>
                    <Td mono muted>
                      {transfer.approvedBy ? (
                        <>
                          <div className="font-medium text-[var(--ink)]">{transfer.approvedBy.displayName}</div>
                          <div className="font-mono-num text-[10.5px] text-[var(--ink3)]">{transfer.approvedBy.email}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td mono muted nowrap>{new Date(transfer.createdAt).toLocaleDateString()}</Td>
                    <Td mono muted nowrap>{transfer.completedAt ? new Date(transfer.completedAt).toLocaleDateString() : "—"}</Td>
                    <Td nowrap>
                      {transfer.status === "PENDING" && (
                        <div className="flex items-center gap-2">
                          {currentUserId && transfer.initiatorUserId !== currentUserId && transfer.targetMembership.id !== currentUserId && (
                            <button
                              type="button"
                              onClick={() => handleApprove(transfer.id)}
                              disabled={isActionPending}
                              className="zoiko-btn pri sm"
                              title="Approve this transfer (requires a different Owner)"
                            >
                              <CheckCircle className="h-3.5 w-3.5" /> Approve
                            </button>
                          )}
                          {currentUserId && transfer.initiatorUserId === currentUserId && (
                            <button
                              type="button"
                              onClick={() => handleCancel(transfer.id)}
                              disabled={isActionPending}
                              className="zoiko-btn sm"
                              style={{ color: "var(--crit)" }}
                            >
                              <XCircle className="h-3.5 w-3.5" /> Cancel
                            </button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {/* Initiate Button */}
      {!pendingTransfer && eligibleTargets.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowInitiateDialog(true)}
            className="zoiko-btn pri"
          >
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Initiate Transfer
          </button>
        </div>
      )}

      {!pendingTransfer && eligibleTargets.length === 0 && (
        <Notice tone="info">
          No eligible members for transfer. Only active non-Owner members can become the new Owner.
        </Notice>
      )}

      {/* How it works */}
      <Card title="How Ownership Transfer Works" badge={<Pill tone="accent">Security</Pill>} padded>
        <ol className="space-y-3 text-sm text-[var(--ink2)]">
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold">1</span>
            <div>
              <b className="text-[var(--ink)]">Initiate:</b> An Owner selects an active non-Owner member and initiates the transfer.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold">2</span>
            <div>
              <b className="text-[var(--ink)]">Pending:</b> The transfer enters PENDING status. A different Owner must approve it.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold">3</span>
            <div>
              <b className="text-[var(--ink)]">Approve:</b> A second Owner (not the initiator, not the target) approves the transfer.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold">4</span>
            <div>
              <b className="text-[var(--ink)]">Execute:</b> The initiator is demoted to Admin, the target is promoted to Owner — atomically.
            </div>
          </li>
          <li className="flex gap-3">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold">5</span>
            <div>
              <b className="text-[var(--ink)]">Audit:</b> Every step is recorded in the audit log with full metadata.
            </div>
          </li>
        </ol>
      </Card>
    </>
  );
}