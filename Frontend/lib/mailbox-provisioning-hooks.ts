"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProvisioningOptions,
  provisionMailbox,
  resendMailboxInvitation,
  retryMailboxProvisioning,
  type ProvisionMailboxInput,
} from "./mailbox-provisioning-api";

/**
 * Both dashboards list mailboxes under their own query keys. A change made
 * from either has to refresh both, or the other screen shows a stale status.
 */
function useInvalidateMailboxLists() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["mailboxes"] }),
      qc.invalidateQueries({ queryKey: ["owner", "admin-mailboxes"] }),
      qc.invalidateQueries({ queryKey: ["admin-dashboard"] }),
      qc.invalidateQueries({ queryKey: ["mailbox-provisioning-options"] }),
    ]);
}

export function useProvisioningOptions(enabled = true) {
  return useQuery({
    queryKey: ["mailbox-provisioning-options"],
    queryFn: fetchProvisioningOptions,
    enabled,
    staleTime: 15_000,
  });
}

export function useProvisionMailbox() {
  const invalidate = useInvalidateMailboxLists();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ProvisionMailboxInput; idempotencyKey: string }) =>
      provisionMailbox(input, idempotencyKey),
    // Settled rather than success: a failed provisioning still leaves a row
    // the list should show.
    onSettled: invalidate,
  });
}

export function useRetryMailboxProvisioning() {
  const invalidate = useInvalidateMailboxLists();
  return useMutation({ mutationFn: retryMailboxProvisioning, onSettled: invalidate });
}

export function useResendMailboxInvitation() {
  const invalidate = useInvalidateMailboxLists();
  return useMutation({ mutationFn: resendMailboxInvitation, onSettled: invalidate });
}
