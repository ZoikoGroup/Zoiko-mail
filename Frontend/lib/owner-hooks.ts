"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMembers,
  inviteMember,
  updateMember,
  removeMember,
  cancelInvitation,
  getDomains,
  addDomain,
  runDiagnostics,
  getDomainChecks,
  activateDomain,
  deleteDomain,
  getAuditEvents,
  getPolicies,
  createPolicy,
  activatePolicy,
  deactivatePolicy,
  getCurrentTenant,
  updateTenant,
  getGeneralSettings,
  updateGeneralSettings,
  getSuppressions,
  addSuppression,
  deactivateSuppression,
  getDeliveryEvents,
  getProviderEvents,
  replayDeadLetter,
  getOnboardingStatus,
  getUsage,
  getConnectors,
  deleteConnector,
  getConnectorHealth,
  getAdminMailboxes,
  createAdminMailbox,
  deleteAdminMailbox,
  updateMailboxSendingStatus,
  getLifecycleRequests,
  requestDataExport,
  requestDeletion,
  cancelLifecycleRequest,
  approveDeletion,
  confirmDeletion,
  type InviteMemberInput,
  type UpdateMemberInput,
  type AddDomainInput,
  type AuditEventQuery,
  type CreatePolicyInput,
  type UpdateTenantInput,
  type UpdateGeneralSettingsInput,
  type DeliveryEventType,
  type ProviderEventStatus,
  type ConnectorProvider,
  type RequestExportInput,
  type RequestDeletionInput,
  fetchSupportAccessRequests,
  approveSupportAccessRequest,
  denySupportAccessRequest,
  type SupportRequestStatus,
  getSecurityAlerts,
  reviewSecurityAlert,
  type AlertReviewAction,
} from "./owner-api";
import {
  getSupportGrants,
  createSupportGrant,
  revokeSupportGrant,
  type CreateSupportGrantInput,
  type SupportGrant,
} from "./owner-api";

// ─── Members ──────────────────────────────────────────────────────────────────

export function useMembers() {
  return useQuery({
    queryKey: ["owner", "members"],
    queryFn: getMembers,
    staleTime: 30_000,
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteMemberInput) => inviteMember(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "members"] }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMemberInput }) => updateMember(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "members"] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "members"] }),
  });
}

export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "members"] }),
  });
}

// ─── Domains ──────────────────────────────────────────────────────────────────

export function useDomains() {
  return useQuery({
    queryKey: ["owner", "domains"],
    queryFn: getDomains,
    staleTime: 30_000,
  });
}

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDomainInput) => addDomain(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "domains"] }),
  });
}

export function useRunDiagnostics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => runDiagnostics(domainId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "domains"] }),
  });
}

export function useDomainChecks(domainId: string | null) {
  return useQuery({
    queryKey: ["owner", "domain-checks", domainId],
    queryFn: () => getDomainChecks(domainId!),
    enabled: !!domainId,
    staleTime: 15_000,
  });
}

export function useActivateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => activateDomain(domainId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "domains"] }),
  });
}

export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domainId: string) => deleteDomain(domainId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "domains"] });
      qc.invalidateQueries({ queryKey: ["owner", "domain-checks"] });
    },
  });
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export function useAuditEvents(query: AuditEventQuery = {}) {
  return useQuery({
    queryKey: ["owner", "audit", query],
    queryFn: () => getAuditEvents(query),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export function usePolicies() {
  return useQuery({
    queryKey: ["owner", "policies"],
    queryFn: getPolicies,
    staleTime: 30_000,
  });
}

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePolicyInput) => createPolicy(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "policies"] }),
  });
}

export function useActivatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policyId: string) => activatePolicy(policyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "policies"] }),
  });
}

export function useDeactivatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policyId: string) => deactivatePolicy(policyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "policies"] }),
  });
}

// ─── Tenant ───────────────────────────────────────────────────────────────────

export function useTenant() {
  return useQuery({
    queryKey: ["owner", "tenant"],
    queryFn: getCurrentTenant,
    staleTime: 60_000,
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTenantInput) => updateTenant(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "tenant"] });
      qc.invalidateQueries({ queryKey: ["owner", "general-settings"] });
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
    },
  });
}

export function useGeneralSettings() {
  return useQuery({
    queryKey: ["owner", "general-settings"],
    queryFn: getGeneralSettings,
    staleTime: 30_000,
  });
}

export function useUpdateGeneralSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGeneralSettingsInput) => updateGeneralSettings(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "general-settings"] }),
  });
}

export function useSuppressions() {
  return useQuery({
    queryKey: ["owner", "suppressions"],
    queryFn: getSuppressions,
    staleTime: 30_000,
  });
}

export function useAddSuppression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => addSuppression(email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "suppressions"] }),
  });
}

export function useDeactivateSuppression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suppressionId: string) => deactivateSuppression(suppressionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "suppressions"] }),
  });
}

export function useDeliveryEvents(params: { type?: DeliveryEventType; limit?: number } = {}) {
  return useQuery({
    queryKey: ["owner", "delivery-events", params],
    queryFn: () => getDeliveryEvents(params),
    staleTime: 15_000,
  });
}

export function useProviderEvents(
  params: { status?: ProviderEventStatus; provider?: ConnectorProvider; limit?: number } = {}
) {
  return useQuery({
    queryKey: ["owner", "provider-events", params],
    queryFn: () => getProviderEvents(params),
    staleTime: 15_000,
  });
}

export function useReplayProviderEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => replayDeadLetter(eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "provider-events"] }),
  });
}

// ─── Onboarding ────────────────────────────────────────────────────────────

export function useOnboardingStatus() {
  return useQuery({
    queryKey: ["owner", "onboarding"],
    queryFn: getOnboardingStatus,
    staleTime: 30_000,
  });
}

// ─── Usage ────────────────────────────────────────────────────────────────

export function useUsage(days: number = 30) {
  return useQuery({
    queryKey: ["owner", "usage", days],
    queryFn: () => getUsage(days),
    staleTime: 60_000,
  });
}

// ─── Connectors ───────────────────────────────────────────────────────────────

export function useConnectors() {
  return useQuery({
    queryKey: ["owner", "connectors"],
    queryFn: getConnectors,
    staleTime: 30_000,
  });
}

export function useDeleteConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => deleteConnector(accountId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "connectors"] }),
  });
}

export function useConnectorHealth() {
  return useQuery({
    queryKey: ["owner", "connector-health"],
    queryFn: getConnectorHealth,
    staleTime: 30_000,
  });
}

// ─── Admin Mailboxes ────────────────────────────────────────────────────────

export function useAdminMailboxes() {
  return useQuery({
    queryKey: ["owner", "admin-mailboxes"],
    queryFn: getAdminMailboxes,
    staleTime: 30_000,
  });
}

export function useCreateAdminMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => createAdminMailbox(membershipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "admin-mailboxes"] }),
  });
}

export function useDeleteAdminMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mailboxId: string) => deleteAdminMailbox(mailboxId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "admin-mailboxes"] }),
  });
}

export function useUpdateMailboxSendingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, data }: { mailboxId: string; data: { suspended: boolean; reason?: string } }) =>
      updateMailboxSendingStatus(mailboxId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "admin-mailboxes"] }),
  });
}

// ─── Lifecycle (exports & deletions) ────────────────────────────────────────

export function useLifecycleRequests() {
  return useQuery({
    queryKey: ["owner", "lifecycle"],
    queryFn: getLifecycleRequests,
    staleTime: 15_000,
  });
}

export function useRequestDataExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, stepUpToken }: { input: RequestExportInput; stepUpToken?: string }) =>
      requestDataExport(input, stepUpToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "lifecycle"] }),
  });
}

export function useRequestDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, stepUpToken }: { input: RequestDeletionInput; stepUpToken?: string }) =>
      requestDeletion(input, stepUpToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "lifecycle"] }),
  });
}

export function useCancelLifecycleRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => cancelLifecycleRequest(requestId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "lifecycle"] }),
  });
}

export function useApproveDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => approveDeletion(requestId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "lifecycle"] }),
  });
}

export function useConfirmDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, data }: { requestId: string; data: { confirmation: string; tenantName: string } }) =>
      confirmDeletion(requestId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "lifecycle"] }),
  });
}

/* ─── Support access requests — Runbook §7 ──────────────────────────────── */

/**
 * Polled, because a request arrives while nobody is looking at this screen
 * and a support member is blocked until it is answered.
 */
export function useSupportAccessRequests(status?: SupportRequestStatus) {
  return useQuery({
    queryKey: ["support-access-requests", status ?? "all"],
    queryFn: () => fetchSupportAccessRequests(status),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useApproveSupportAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { requestId: string; stepUpToken?: string; minutes?: number }) =>
      approveSupportAccessRequest(v.requestId, v.stepUpToken, v.minutes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["support-access-requests"] });
      // Approving writes a grant, so the grants list is stale too. The key
      // is main's ["owner", "support-grants"], not the bare one this branch
      // guessed at while that list did not exist yet — an approval that
      // left the grants table showing the old rows would look like it had
      // silently failed.
      void qc.invalidateQueries({ queryKey: ["owner", "support-grants"] });
    },
  });
}

export function useDenySupportAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { requestId: string; note?: string }) =>
      denySupportAccessRequest(v.requestId, v.note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["support-access-requests"] });
    },
  });
}

// ─── Security alerts ─────────────────────────────────────────────────────────

export function useSecurityAlerts() {
  return useQuery({
    queryKey: ["owner", "security-alerts"],
    queryFn: getSecurityAlerts,
    staleTime: 15_000,
  });
}

/**
 * Deciding on an alert. Invalidating on success is what keeps the filter
 * tallies and the open count honest without a reload — they come down with
 * the rows rather than being counted in the browser.
 */
export function useReviewSecurityAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: AlertReviewAction; note?: string }) =>
      reviewSecurityAlert(id, action, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "security-alerts"] }),
  });
}

// ─── Support Access Grants ───────────────────────────────────────────────────

export function useSupportGrants() {
  return useQuery({
    queryKey: ["owner", "support-grants"],
    queryFn: getSupportGrants,
    staleTime: 30_000,
  });
}

export function useCreateSupportGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupportGrantInput) => createSupportGrant(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "support-grants"] }),
  });
}

export function useRevokeSupportGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => revokeSupportGrant(grantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["owner", "support-grants"] });
      // Ending a grant also settles the request it came from.
      void qc.invalidateQueries({ queryKey: ["support-access-requests"] });
    }
  });
}
