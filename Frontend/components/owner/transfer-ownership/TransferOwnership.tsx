"use client";

import { useMemo, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useMembers, useOwnershipTransfers, useInitiateOwnershipTransfer, useApproveOwnershipTransfer, useCancelOwnershipTransfer } from "@/lib/owner-hooks";
import { useMe } from "@/lib/auth-hooks";
import type { OwnershipTransfer } from "@/lib/owner-api";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function TransferOwnershipCard() {
  const me = useMe();
  const meData = me.data as { id: string; membership: { role: string }; tenant: { name: string } } | undefined;
  const { data: members = [], isLoading: membersLoading } = useMembers();
  const { data: transfers = [], isLoading: transfersLoading } = useOwnershipTransfers();
  const initiate = useInitiateOwnershipTransfer();
  const approve = useApproveOwnershipTransfer();
  const cancel = useCancelOwnershipTransfer();

  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isOwner = meData?.membership.role === "OWNER";
  const pending = transfers.find((t: OwnershipTransfer) => t.status === "PENDING");
  const history = transfers.filter((t: OwnershipTransfer) => t.status === "COMPLETED");

  const targetOptions = useMemo(
    () =>
      members.filter(
        (m) =>
          m.role !== "OWNER" &&
          m.status === "ACTIVE" &&
          m.userId !== meData?.id
      ),
    [members, meData?.id]
  );

  if (!isOwner || membersLoading || transfersLoading) {
    return null;
  }

  const canApprove = Boolean(
    pending &&
    meData &&
    pending.initiatorUserId !== meData.id &&
    pending.targetMembership.user.id !== meData.id
  );
  const canCancel = Boolean(pending && meData && pending.initiatorUserId === meData.id);

  const handleInitiate = () => {
    setError(null);
    if (!targetId || typedName !== meData?.tenant.name) return;
    initiate.mutate(targetId, {
      onSuccess: () => {
        setOpen(false);
        setTargetId("");
        setTypedName("");
      },
      onError: (err: any) => setError(err?.message ?? "Failed to start the transfer. Please try again."),
    });
  };

  const handleApprove = () => {
    if (!pending) return;
    setError(null);
    approve.mutate(pending.id, {
      onError: (err: any) => setError(err?.message ?? "Failed to approve the transfer. Please try again."),
    });
  };

  return (
    <div className="zoiko-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--warn-soft)] text-[var(--warn)]">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Ownership</h3>
          <p className="text-[11px] text-[var(--ink3)]">
            Transferring ownership requires a second Owner to approve.
          </p>
        </div>
      </div>

      {pending && (
        <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-soft)] p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warn)]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--ink)]">
                Pending transfer to {pending.targetMembership.user.displayName}
              </p>
              <p className="mt-0.5 text-xs text-[var(--ink3)]">
                Requested by {pending.initiator.displayName} on {formatDate(pending.createdAt)}.{" "}
                {canApprove
                  ? "A second Owner is required to approve it."
                  : canCancel
                    ? "Waiting for a second Owner to approve."
                    : "This transfer is awaiting a second Owner."}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {canApprove && (
              <button
                className="zoiko-btn pri"
                onClick={handleApprove}
                disabled={approve.isPending}
              >
                {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {approve.isPending ? "Approving…" : "Approve transfer"}
              </button>
            )}
            {canCancel && (
              <button
                className="zoiko-btn"
                onClick={() => cancel.mutate(pending.id)}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel request"}
              </button>
            )}
          </div>
        </div>
      )}

      {!pending && (
        <button className="zoiko-btn pri" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" />
          Transfer ownership
        </button>
      )}

      {error && <p className="mt-3 text-xs text-[var(--crit)]">{error}</p>}

      {history.length > 0 && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-[var(--ink3)] uppercase">
            Transfer history
          </p>
          <ul className="space-y-2">
            {history.map((t: OwnershipTransfer) => (
              <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-[var(--ink2)]">
                  Ownership transferred to {t.targetMembership.user.displayName}
                </span>
                <span className="shrink-0 text-xs text-[var(--ink3)]">
                  {formatDate(t.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Transfer ownership"
        footer={
          <div className="flex items-center gap-2">
            <button className="zoiko-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="zoiko-btn crit"
              onClick={handleInitiate}
              disabled={initiate.isPending || !targetId || typedName !== meData?.tenant.name}
            >
              {initiate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {initiate.isPending ? "Requesting…" : "Request transfer"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">
              New owner
            </label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">Select a member…</option>
              {targetOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.email})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">
              Type <span className="font-semibold text-[var(--ink)]">{meData?.tenant.name}</span> to confirm
            </label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <p className="text-xs leading-relaxed text-[var(--ink3)]">
            A second Owner must approve this request before it takes effect. On approval you will
            become an Admin and the selected member becomes the Owner of this workspace.
          </p>
        </div>
      </Modal>
    </div>
  );
}