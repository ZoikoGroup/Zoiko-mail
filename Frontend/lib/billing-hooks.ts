"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPlans,
  getSubscription,
  createCheckout,
  getPortalUrl,
  cancelSubscription,
  reactivateSubscription,
  getInvoices,
} from "./billing-api";

// ─── Queries ───────────────────────────────────────────────────────────────────

export function usePlans() {
  return useQuery({
    queryKey: ["billing", "plans"],
    queryFn: getPlans,
    staleTime: 5 * 60_000,
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: ["billing", "subscription"],
    queryFn: getSubscription,
    staleTime: 30_000,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: getInvoices,
    staleTime: 30_000,
  });
}

// ─── Mutations ─────────────────────────────────────────────────────────────────

export function useCheckout() {
  return useMutation({
    mutationFn: (planCode: string) => createCheckout(planCode),
  });
}

export function useBillingPortal() {
  return useMutation({
    mutationFn: getPortalUrl,
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "subscription"] });
    },
  });
}

export function useReactivateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: reactivateSubscription,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing", "subscription"] });
    },
  });
}
