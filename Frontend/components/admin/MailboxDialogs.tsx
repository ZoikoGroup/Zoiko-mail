"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useCreateMailbox,
  useDelegateMailbox,
  useDomains,
  useDeleteMailbox,
  useMailboxDelegates,
  useRevokeMailboxDelegate,
  useSetMailboxSending,
  useWorkspacePeople,
} from "@/lib/admin-hooks";
import { StepUpDialog, useStepUp } from "@/components/admin/StepUpDialog";
import type { MailboxDto } from "@/lib/admin-api";

/**
 * Provision a mailbox for a member who has none.
 *
 * The address is not typed. The server names a mailbox after the member's own
 * account email, so an admin cannot create dana@acme.com for somebody who is
 * not Dana, and the two cannot drift apart later. That makes this a picker
 * rather than a form.
 */
export function CreateMailboxDialog({
  existing,
  onClose,
}: {
  existing: MailboxDto[];
  onClose: () => void;
}) {
  const { data: people, isLoading, error } = useWorkspacePeople();
  const { data: domains } = useDomains();
  const create = useCreateMailbox();
  const [membershipId, setMembershipId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [localPart, setLocalPart] = useState("");

  /**
   * Only verified domains are offered.
   *
   * The server refuses the rest, and naming them here without saying why
   * would be an invitation to pick one and read a 409. Verified means
   * ownership is proven and MX points at us, so mail can arrive; sending is
   * a separate switch on the Domains screen and deliberately later.
   */
  const usable = (domains ?? []).filter((d) => d.verificationStatus === "VERIFIED");
  const pending = (domains ?? []).filter((d) => d.verificationStatus !== "VERIFIED");

  // A member already holding a mailbox is not a candidate — the server
  // refuses a second one with a 409, so offering them would be inviting it.
  const taken = new Set(existing.map((mailbox) => mailbox.membershipId).filter(Boolean));
  const candidates = (people ?? []).filter((person) => !taken.has(person.id));

  const chosen = candidates.find((person) => person.id === membershipId);
  // What they already use, which is what somebody expects when they invite
  // dana@old-company.com and then pick acme.com.
  const suggested = chosen?.user.email.split("@")[0] ?? "";
  const effectiveLocal = (localPart || suggested).trim().toLowerCase();
  const chosenDomain = usable.find((d) => d.id === domainId);
  const preview = chosenDomain ? `${effectiveLocal}@${chosenDomain.domainName}` : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Create a mailbox"
      size="sm"
      footer={
        <>
          <button className="zoiko-btn" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button
            className="zoiko-btn pri"
            disabled={create.isPending || !membershipId || (usable.length > 0 && !domainId)}
            onClick={() =>
              create.mutate(
                {
                  membershipId,
                  // Absent when the workspace has no verified domain yet, and
                  // the server falls back to the member's signup address —
                  // the old behaviour, kept so a workspace mid-setup is not
                  // blocked from provisioning anything at all.
                  ...(domainId ? { domainId, localPart: effectiveLocal } : {}),
                },
                { onSuccess: onClose }
              )
            }
          >
            {create.isPending ? "Creating…" : "Create mailbox"}
          </button>
        </>
      }
    >
      {error ? (
        <p className="text-[12.5px] text-[var(--crit)]">
          Could not load the member list. {error.message}
        </p>
      ) : isLoading ? (
        <p className="text-[12.5px] text-[var(--ink3)]">Loading members…</p>
      ) : candidates.length === 0 ? (
        <p className="text-[12.5px] text-[var(--ink2)]">
          Every active member already has a mailbox. Invite someone from the Users screen
          first, then come back here.
        </p>
      ) : (
        <div>
          <label
            htmlFor="mailbox-member"
            className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
          >
            Member
          </label>
          <select
            id="mailbox-member"
            value={membershipId}
            disabled={create.isPending}
            onChange={(event) => setMembershipId(event.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
          >
            <option value="">Choose a member…</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.user.displayName} — {person.user.email}
              </option>
            ))}
          </select>
          {usable.length > 0 ? (
            <>
              <label
                htmlFor="mailbox-domain"
                className="font-mono-num mb-1 mt-4 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
              >
                Domain
              </label>
              <select
                id="mailbox-domain"
                value={domainId}
                disabled={create.isPending}
                onChange={(event) => setDomainId(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
              >
                <option value="">Choose a domain…</option>
                {usable.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.domainName}
                  </option>
                ))}
              </select>

              <label
                htmlFor="mailbox-local"
                className="font-mono-num mb-1 mt-4 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
              >
                Mailbox name
              </label>
              <input
                id="mailbox-local"
                value={localPart}
                placeholder={suggested}
                disabled={create.isPending}
                onChange={(event) => setLocalPart(event.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)]"
              />

              {preview && (
                <p className="mt-2 font-mono-num text-[12px] text-[var(--ink)]">{preview}</p>
              )}
              <p className="mt-1 text-[11.5px] text-[var(--ink3)]">
                Receiving works as soon as the mailbox exists. Sending stays off until the
                domain is activated on the Domains screen.
              </p>

              {pending.length > 0 && (
                // Named rather than hidden: an admin who just added a domain
                // and cannot find it here needs to know it is waiting on DNS,
                // not wonder whether the screen is broken.
                <p className="mt-2 text-[11.5px] text-[var(--ink3)]">
                  {pending.map((d) => d.domainName).join(", ")}{" "}
                  {pending.length === 1 ? "is" : "are"} not verified yet, so not offered here.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[11.5px] text-[var(--ink3)]">
              {pending.length > 0
                ? "No domain has passed its DNS checks yet, so this mailbox will take the address on the member's account. Verify a domain on the Domains screen to create addresses on it."
                : "This workspace has no domains yet, so the mailbox takes the address on the member's account. Add one on the Domains screen to create addresses on your own domain."}
            </p>
          )}
          {create.error && (
            <p className="mt-2 text-[11.5px] text-[var(--crit)]">{create.error.message}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Stop or resume sending from one mailbox.
 *
 * This is the lever an admin pulls during an abuse or compromise incident —
 * the audit spec's response to that signal is "suspend sending, revoke
 * sessions, require MFA reset". The reason is required by the server, because
 * an unexplained suspension is little use to whoever picks the incident up
 * next; receiving is deliberately unaffected, so a suspended account still
 * collects the replies that explain what happened.
 */
export function SendingDialog({
  mailbox,
  onClose,
}: {
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  const setSending = useSetMailboxSending();
  const suspended = mailbox.status === "SUSPENDED";
  const [reason, setReason] = useState("");

  const submit = () =>
    setSending.mutate(
      {
        mailboxId: mailbox.id,
        suspended: !suspended,
        reason: suspended ? undefined : reason.trim(),
      },
      { onSuccess: onClose }
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={suspended ? "Resume sending" : "Stop sending"}
      size="sm"
      footer={
        <>
          <button className="zoiko-btn" onClick={onClose} disabled={setSending.isPending}>
            Cancel
          </button>
          <button
            className={`zoiko-btn ${suspended ? "pri" : "crit"}`}
            disabled={setSending.isPending || (!suspended && reason.trim().length === 0)}
            onClick={submit}
          >
            {setSending.isPending
              ? "Working…"
              : suspended
                ? "Resume sending"
                : "Stop sending"}
          </button>
        </>
      }
    >
      <p className="text-[12.6px] text-[var(--ink)]">{mailbox.address}</p>

      {suspended ? (
        <p className="mt-2 text-[12px] text-[var(--ink3)]">
          {mailbox.sendSuspensionReason
            ? `Suspended: ${mailbox.sendSuspensionReason}`
            : "Sending is currently suspended."}{" "}
          Resuming returns it to its normal warm-up schedule.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[12px] text-[var(--ink3)]">
            Outbound mail stops immediately. Incoming mail is unaffected, so replies still
            arrive while this is investigated.
          </p>
          <label
            htmlFor="suspend-reason"
            className="font-mono-num mb-1 mt-3 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
          >
            Reason
          </label>
          <input
            id="suspend-reason"
            value={reason}
            placeholder="Compromised account reported by the user"
            disabled={setSending.isPending}
            onChange={(event) => setReason(event.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)]"
          />
          <p className="mt-1.5 text-[11.5px] text-[var(--ink3)]">
            Recorded on the mailbox and in the audit log.
          </p>
        </>
      )}

      {setSending.error && (
        <p className="mt-2 text-[11.5px] text-[var(--crit)]">{setSending.error.message}</p>
      )}
    </Modal>
  );
}

/**
 * Delete a mailbox.
 *
 * RBAC §2 marks this step-up and says "suspend-first, offer export". The
 * suspend half is the dialog above; this one refuses to proceed while the
 * mailbox is still sending, so the sequence the matrix describes is the one
 * the screen makes easy rather than merely the one it documents.
 */
export function DeleteMailboxDialog({
  mailbox,
  onClose,
}: {
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  const remove = useDeleteMailbox();
  const stepUp = useStepUp();
  const stillSending = mailbox.status !== "SUSPENDED";

  return (
    <>
      <StepUpDialog {...stepUp.dialog} />

      <ConfirmDialog
        open={!stepUp.dialog.open}
        onClose={onClose}
        onConfirm={() => {
          onClose();
          void stepUp.attempt(`Deleting ${mailbox.address}`, (stepUpToken) =>
            remove.mutateAsync({ mailboxId: mailbox.id, stepUpToken })
          );
        }}
        title={`Delete ${mailbox.address}?`}
        message={
          stillSending
            ? "This mailbox is still able to send. Stop sending first, and offer the owner an export — deleting removes the mail as well as the address."
            : "The mailbox and its mail are removed. Offer the owner an export first if they may need the contents; this cannot be undone."
        }
        confirmLabel="Delete mailbox"
        loading={remove.isPending}
      />
    </>
  );
}

/**
 * Give somebody else access to one person's mailbox — RBAC §2 "Delegate
 * mailbox access", §3, §9.1.
 *
 * Cover for leave, a shared responsibility, an assistant. Distinct from a
 * shared mailbox, which belongs to the workspace: this mailbox stays Sam's,
 * and the delegation is a named, revocable exception recorded against it.
 *
 * Two refusals from this screen mean different things and are shown as such.
 * "Forbidden" alone would send an Admin to ask for a permission they already
 * hold — what they are actually missing is a workspace policy an Owner has
 * never activated, which §2 expresses as Admin "If policy" against the Owner's
 * unconditional Yes.
 */
export function DelegateMailboxDialog({
  mailbox,
  onClose,
}: {
  mailbox: MailboxDto;
  onClose: () => void;
}) {
  const { data: people } = useWorkspacePeople();
  const { data: delegates, isLoading } = useMailboxDelegates(mailbox.id);
  const grant = useDelegateMailbox(mailbox.id);
  const revoke = useRevokeMailboxDelegate(mailbox.id);

  const [membershipId, setMembershipId] = useState("");
  const [canSend, setCanSend] = useState(false);

  // Not the owner of this mailbox — delegating it to them grants nothing, and
  // the server refuses with a 409 rather than writing a no-op grant.
  const held = new Set((delegates ?? []).map((d) => d.membershipId));
  const candidates = (people ?? []).filter(
    (person) => person.id !== mailbox.membershipId && !held.has(person.id)
  );

  const error = grant.error ?? revoke.error;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delegate ${mailbox.address}`}
      size="sm"
      footer={
        <button className="zoiko-btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="text-[12.5px] text-[var(--ink2)]">
        The mailbox stays with its owner. A delegate reads it — and sends from it only
        if you say so. Every grant and removal is written to the audit log.
      </p>

      {error ? (
        <p className="mt-3 text-[12.5px] text-[var(--crit)]">{error.message}</p>
      ) : null}

      <div className="mt-4">
        <label
          htmlFor="delegate-member"
          className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
        >
          Give access to
        </label>
        <select
          id="delegate-member"
          value={membershipId}
          disabled={grant.isPending}
          onChange={(event) => setMembershipId(event.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)]"
        >
          <option value="">Choose a member…</option>
          {candidates.map((person) => (
            <option key={person.id} value={person.id}>
              {person.user.displayName} — {person.user.email}
            </option>
          ))}
        </select>

        <label className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--ink)]">
          <input
            type="checkbox"
            checked={canSend}
            disabled={grant.isPending}
            onChange={(event) => setCanSend(event.target.checked)}
          />
          Also let them send as this address
        </label>

        <button
          className="zoiko-btn pri mt-3"
          disabled={grant.isPending || !membershipId}
          onClick={() =>
            grant.mutate(
              { membershipId, canSend },
              {
                onSuccess: () => {
                  setMembershipId("");
                  setCanSend(false);
                },
              }
            )
          }
        >
          {grant.isPending ? "Granting…" : "Grant access"}
        </button>
      </div>

      <div className="mt-5">
        <p className="font-mono-num mb-2 text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]">
          Current delegates
        </p>
        {isLoading ? (
          <p className="text-[12.5px] text-[var(--ink3)]">Loading…</p>
        ) : !delegates || delegates.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ink2)]">
            Nobody else can reach this mailbox.
          </p>
        ) : (
          delegates.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between border-b border-[var(--border)] py-2 last:border-0"
            >
              <span className="text-[12.5px] text-[var(--ink)]">
                {d.name}
                <span className="ml-2 text-[11.5px] text-[var(--ink3)]">
                  {d.canSend ? "read and send" : "read only"}
                </span>
              </span>
              <button
                className="zoiko-btn sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(d.membershipId)}
              >
                {revoke.isPending && revoke.variables === d.membershipId
                  ? "Removing…"
                  : "Remove"}
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
