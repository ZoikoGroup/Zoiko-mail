"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateDomain,
  addDomain,
  connectDnsProvider,
  deactivateDomain,
  isSettling,
  listDnsProviders,
  listDomainChecks,
  listDomains,
  publishDomain,
  recheckDomain,
  removeDnsProvider,
  removeDomain,
  rotateDkim,
  updateDomain,
  verifyDnsProvider,
  type ConnectProviderInput,
  type DomainConfigInput,
} from "./domains-api";

/**
 * Query keys the older screens already use are invalidated too, so the
 * sidebar counts, the onboarding checklist and the dashboard all move when a
 * domain does.
 */
const LEGACY_KEYS = [["domains"], ["owner", "domains"], ["admin-dashboard"], ["owner", "onboarding"]];
const DOMAINS = ["domain-detail-list"] as const;
const PROVIDERS = ["dns-providers"] as const;

/**
 * The domain list, live.
 *
 * The server re-checks on its own schedule, so the screen polls rather than
 * waiting for a click: every 10 seconds while any domain is still settling —
 * that is when an owner is at their DNS host publishing records and watching
 * this page — and every minute once everything is steady.
 */
export function useDomainList() {
  return useQuery({
    queryKey: DOMAINS,
    queryFn: listDomains,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data?.some(isSettling) ? 10_000 : 60_000),
  });
}

export function useDomainChecks(domainId: string | null) {
  return useQuery({
    queryKey: ["domain-detail-checks", domainId],
    queryFn: () => listDomainChecks(domainId!),
    enabled: Boolean(domainId),
    staleTime: 10_000,
  });
}

export function useDnsProviders() {
  return useQuery({ queryKey: PROVIDERS, queryFn: listDnsProviders, staleTime: 30_000 });
}

function useInvalidating<TInput, TResult>(fn: (input: TInput) => Promise<TResult>, extra: ReadonlyArray<readonly unknown[]> = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: async () => {
      await Promise.all([DOMAINS, ...extra, ...LEGACY_KEYS, ["domain-detail-checks"]].map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

export const useAddDomainDetail = () => useInvalidating((input: { domainName: string } & DomainConfigInput) => addDomain(input));
export const useUpdateDomain = () => useInvalidating(({ domainId, input }: { domainId: string; input: DomainConfigInput }) => updateDomain(domainId, input));
export const useRecheckDomainDetail = () => useInvalidating((domainId: string) => recheckDomain(domainId));
export const usePublishDomain = () => useInvalidating((domainId: string) => publishDomain(domainId));
export const useRotateDkim = () => useInvalidating((domainId: string) => rotateDkim(domainId));
export const useActivateDomainDetail = () => useInvalidating((domainId: string) => activateDomain(domainId));
export const useDeactivateDomain = () => useInvalidating((domainId: string) => deactivateDomain(domainId));
export const useRemoveDomainDetail = () =>
  useInvalidating(({ domainId, stepUpToken }: { domainId: string; stepUpToken?: string }) => removeDomain(domainId, stepUpToken));

export const useConnectDnsProvider = () =>
  useInvalidating(({ input, stepUpToken }: { input: ConnectProviderInput; stepUpToken?: string }) => connectDnsProvider(input, stepUpToken), [PROVIDERS]);
export const useVerifyDnsProvider = () => useInvalidating((credentialId: string) => verifyDnsProvider(credentialId), [PROVIDERS]);
export const useRemoveDnsProvider = () =>
  useInvalidating(({ credentialId, stepUpToken }: { credentialId: string; stepUpToken?: string }) => removeDnsProvider(credentialId, stepUpToken), [PROVIDERS]);
