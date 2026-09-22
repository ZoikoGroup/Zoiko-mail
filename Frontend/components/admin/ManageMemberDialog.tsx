"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useRemoveMember, useResetMemberMfa, useUpdateMember } from "@/lib/admin-hooks";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import { useCan } from "@/lib/admin-capabilities";
import type { MemberDto, MembershipRole } from "@/lib/admin-api";

/**
 * Act on one membership: change its role, suspend it, or end it.
 *
 * Three verbs in one dialog because they are three answers to the same
 * question — what should this person still be able to do — and splitting them
 * across screens would hide the fact that suspending and removing differ.
 *
 * Suspension is reversible and keeps the mailbox; removal ends the membership
 * and is not undone by inviting the person again, because the new membership
 * is a different row with a different grant. The dialog says so rather than
 * leaving an admin to discover it.
 *
 * Every control here is capability-gated, and every one of those gates is also
 * applied by the server. The UI hides what it knows will be refused so an
 * admin is not invited to fail; it is not what makes the refusal happen.
 */
export function ManageMemberDialog({
  person,
  onClose,
}: {
  person: MemberDto;
  onClose: () => void;
}) {
  const can = useCan();
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const resetMfa = useResetMemberMfa();
  const stepUp = useStepUp();

  const [role, setRole] = useState<MembershipRole>(person.role);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [mfaReset, setMfaReset] = useState<string | null>(null);

  // Which roles this admin may hand out. The target's *current* role decides
  // whether they may be touched at all (the caller checks that before opening
  // this); this list decides what they may be changed into.
  const assignable = (
    [
      can("people.member.manage") && "MEMBER",
      can("people.admin.manage") && "ADMIN",
      can("people.owner.manage") && "OWNER",
    ].filter(Boolean) as MembershipRole[]
  );
  // A role already held stays selectable even if this admin could not grant
  // it, so the select never silently rewrites what it is showing.
  const roleOptions = assignable.includes(person.role)
    ? assignable
    : [person.role, ...assignable];

  const suspended = person.status === "SUSPENDED";
  const roleChanged = role !== person.role;
  const busy = update.isPending || remove.isPending || resetMfa.isPending;
  const error = update.error ?? remove.error ?? resetMfa.error;

  // RBAC §2 puts people.mfa.reset in the Owner row and no other, so an Admin
  // opening this dialog does not see the control at all. The server refuses
  // it either way; this stops an Admin being invited to fail.
  const canResetMfa = can("people.mfa.reset");

  const doResetMfa = () => {
    setMfaReset(null);
    void stepUp.attempt(`Clearing the authenticator for ${person.user.email}`, (token) =>
      resetMfa
        .mutateAsync({ membershipId: person.id, stepUpToken: token })
        .then((result) => setMfaReset(result.message))
    );
  };

  const applyRole = () =>
    update.mutate({ membershipId: person.id, patch: { role } }, { onSuccess: onClose });

  const toggleSuspended = () =>
    update.mutate(
      { membershipId: person.id, patch: { status: suspended ? "ACTIVE" : "SUSPENDED" } },
      { onSuccess: onClose }
    );

  return (
    <>
      <StepUpDialog {...stepUp.dialog} />

      <Modal
        open={!confirmRemove}
        onClose={onClose}
        title={`Manage ${person.user.displayName}`}
        size="sm"
        footer={
          <>
            <button className="zoiko-btn" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button
              className="zoiko-btn pri"
              onClick={applyRole}
              disabled={!roleChanged || busy}
            >
              {update.isPending && roleChanged ? "Saving…" : "Save role"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <p className="font-mono-num text-[11px] text-[var(--ink3)]">{person.user.email}</p>

          {error ? (
            <p className="rounded-lg bg-[var(--crit-soft)] px-3 py-2 text-[12px] text-[var(--crit)]">
              {error.message}
            </p>
          ) : null}

          <div>
            <label
              htmlFor="member-role"
              className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
            >
              Role
            </label>
            <select
              id="member-role"
              value={role}
              disabled={busy}
              onChange={(event) => setRole(event.target.value as MembershipRole)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-[var(--border)] pt-4">
            <div className="mb-1 text-[12.6px] font-semibold text-[var(--ink)]">
              {suspended ? "Restore access" : "Suspend access"}
            </div>
            <p className="mb-2.5 text-[11.5px] text-[var(--ink3)]">
              {suspended
                ? "Signing in works again. The mailbox kept receiving mail while they were suspended."
                : "They cannot sign in. The mailbox keeps receiving mail, and nothing is deleted."}
            </p>
            <button className="zoiko-btn sm" onClick={toggleSuspended} disabled={busy}>
              {update.isPending && !roleChanged
                ? "Working…"
                : suspended
                  ? "Restore access"
                  : "Suspend"}
            </button>
          </div>

          {canResetMfa ? (
            <div className="border-t border-[var(--border)] pt-4">
              <div className="mb-1 text-[12.6px] font-semibold text-[var(--ink)]">
                Reset authenticator
              </div>
              <p className="mb-2.5 text-[11.5px] text-[var(--ink3)]">
                For someone who has lost their phone and their recovery codes. This does
                not switch two-factor off — it clears what they had, ends their sessions,
                and asks them to set up a new authenticator the next time they sign in.
              </p>
              {mfaReset ? (
                <p className="mb-2.5 rounded-lg bg-[var(--ok-soft)] px-3 py-2 text-[11.5px] text-[var(--ok)]">
                  {mfaReset}
                </p>
              ) : null}
              <button className="zoiko-btn sm" onClick={doResetMfa} disabled={busy}>
                {resetMfa.isPending ? "Clearing…" : "Reset authenticator"}
              </button>
            </div>
          ) : null}

          <div className="border-t border-[var(--border)] pt-4">
            <div className="mb-1 text-[12.6px] font-semibold text-[var(--crit)]">
              Remove from workspace
            </div>
            <p className="mb-2.5 text-[11.5px] text-[var(--ink3)]">
              Ends the membership. Their Zoiko account survives, but re-inviting them
              creates a new membership rather than restoring this one.
            </p>
            <button
              className="zoiko-btn crit sm"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => remove.mutate(person.id, { onSuccess: onClose })}
        title={`Remove ${person.user.displayName}?`}
        message={`${person.user.email} loses access to this workspace immediately. Suspend instead if you only need to stop them signing in for now.`}
        confirmLabel="Remove member"
        loading={remove.isPending}
      />
    </>
  );
}
