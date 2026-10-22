"use client";

import { useState } from "react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { InvitationLinkBox } from "@/components/mailboxes/InvitationLinkBox";
import {
  describeInvitation,
  describeProvisioningError,
  STATUS_LABEL,
  STATUS_TONE,
  type MailboxStatusRow,
} from "@/lib/mailbox-provisioning-api";
import {
  useResendMailboxInvitation,
  useRetryMailboxProvisioning,
} from "@/lib/mailbox-provisioning-hooks";

/**
 * A mailbox's status, with the one action that moves it forward.
 *
 * Shared by the Owner and Admin lists. Retry appears only for a hosted
 * mailbox whose provisioning did not finish; a new setup link only for one
 * whose owner has not chosen a password yet. Neither ever creates a second
 * mailbox — the server reconciles first, and a new link never touches the host.
 */
export function MailboxStatusCell({ row, canManage }: { row: MailboxStatusRow; canManage: boolean }) {
  const retry = useRetryMailboxProvisioning();
  const resend = useResendMailboxInvitation();
  // Held in memory only, and dropped when the dialog closes.
  const [shownLink, setShownLink] = useState<string | null>(null);
  const [noLink, setNoLink] = useState(false);

  const detail =
    row.status === "FAILED"
      ? describeProvisioningError(row.provisioningError)
      : row.status === "INVITATION_PENDING"
        ? describeInvitation(row.invitationStatus, row.invitationRecipient)
        : undefined;

  const canRetry = canManage && row.provisioningStatus !== null && row.provisioningStatus !== "PROVISIONED";
  const canRegenerate =
    canManage &&
    (row.provisioningStatus === "PROVISIONED" || row.provisioningStatus === null) &&
    row.status === "INVITATION_PENDING" &&
    row.invitationStatus !== null &&
    row.invitationStatus !== "NOT_REQUIRED";
  const error = (retry.error ?? resend.error) as Error | null;

  return (
    <div className="flex flex-col items-start gap-1">
      <span title={detail}>
        <StatusBadge variant={STATUS_TONE[row.status]} dot>
          {STATUS_LABEL[row.status]}
        </StatusBadge>
      </span>
      {(canRetry || canRegenerate) && (
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-60"
          disabled={retry.isPending || resend.isPending}
          onClick={(event) => {
            // Rows open a details drawer on click in the Owner list.
            event.stopPropagation();
            setNoLink(false);
            if (canRetry) retry.mutate(row.id);
            else
              resend.mutate(row.id, {
                onSuccess: (issued) => {
                  // A replayed or refused answer carries no link; say so
                  // rather than doing nothing visible.
                  if (issued.invitationLink) setShownLink(issued.invitationLink);
                  else setNoLink(true);
                },
              });
          }}
          aria-label={`${canRetry ? "Retry provisioning" : "Generate new setup link"} for ${row.address}`}
        >
          {canRetry
            ? retry.isPending ? "Retrying…" : "Retry"
            : resend.isPending ? "Generating…" : "Generate new link"}
        </button>
      )}
      {error && <span className="max-w-[220px] text-[10.5px] text-[var(--crit)]">{error.message}</span>}
      {noLink && !error && (
        <span className="max-w-[220px] text-[10.5px] text-[var(--ink3)]">
          No new link was issued. Refresh the list and try again.
        </span>
      )}
      <Modal
        open={shownLink !== null}
        onClose={() => setShownLink(null)}
        title={`Setup link for ${row.address}`}
        size="sm"
        footer={
          <button type="button" className="zoiko-btn pri" onClick={() => setShownLink(null)}>
            Done
          </button>
        }
      >
        {shownLink && <InvitationLinkBox link={shownLink} recipient={row.invitationRecipient} />}
      </Modal>
    </div>
  );
}
