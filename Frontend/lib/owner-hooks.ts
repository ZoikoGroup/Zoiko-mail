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
  getAuditEvents,
  getPolicies,
  createPolicy,
  activatePolicy,
  getCurrentTenant,
  updateTenant,
  getConnectors,
  deleteConnector,
  getConnectorHealth,
  getAdminMailboxes,
  createAdminMailbox,
  deleteAdminMailbox,
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
  type RequestExportInput,
  type RequestDeletionInput,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "tenant"] }),
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
    mutationFn: (input: RequestExportInput) => requestDataExport(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner", "lifecycle"] }),
  });
}

export function useRequestDeletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestDeletionInput) => requestDeletion(input),
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
