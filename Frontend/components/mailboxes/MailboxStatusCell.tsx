"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
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
 * mailbox whose provisioning did not finish; resend only for a provisioned
 * one whose invitation has not been accepted. Neither ever creates a second
 * mailbox — the server reconciles first and resends never touch the host.
 */
export function MailboxStatusCell({ row, canManage }: { row: MailboxStatusRow; canManage: boolean }) {
  const retry = useRetryMailboxProvisioning();
  const resend = useResendMailboxInvitation();

  const detail =
    row.status === "FAILED"
      ? describeProvisioningError(row.provisioningError)
      : row.status === "INVITATION_PENDING"
        ? describeInvitation(row.invitationStatus, row.invitationError, row.invitationRecipient)
        : undefined;

  const canRetry = canManage && row.provisioningStatus !== null && row.provisioningStatus !== "PROVISIONED";
  const canResend =
    canManage &&
    row.provisioningStatus === "PROVISIONED" &&
    row.membershipStatus === "INVITED" &&
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
      {row.status === "INVITATION_PENDING" && row.invitationStatus === "FAILED" && (
        <span className="text-[10.5px] text-[var(--crit)]">Invitation not delivered</span>
      )}
      {(canRetry || canResend) && (
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-60"
          disabled={retry.isPending || resend.isPending}
          onClick={(event) => {
            // Rows open a details drawer on click in the Owner list.
            event.stopPropagation();
            if (canRetry) retry.mutate(row.id);
            else resend.mutate(row.id);
          }}
          aria-label={`${canRetry ? "Retry provisioning" : "Resend invitation"} for ${row.address}`}
        >
          {canRetry
            ? retry.isPending ? "Retrying…" : "Retry"
            : resend.isPending ? "Sending…" : "Resend invitation"}
        </button>
      )}
      {error && <span className="max-w-[220px] text-[10.5px] text-[var(--crit)]">{error.message}</span>}
    </div>
  );
}
