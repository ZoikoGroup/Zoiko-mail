"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commentTenantTicket, createTenantTicket, getTenantTicket, listTenantTickets, type CreateTicketInput } from "./support-api";

const LIST = ["help", "requests"] as const;

/** The signed-in member's own support requests, newest first. */
export function useMyRequests() {
  return useQuery({ queryKey: LIST, queryFn: () => listTenantTickets({ limit: 50 }), staleTime: 15_000 });
}

export function useRequest(ticketId: string) {
  return useQuery({ queryKey: [...LIST, ticketId], queryFn: () => getTenantTicket(ticketId) });
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) => createTenantTicket(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}

export function useReplyToRequest(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => commentTenantTicket(ticketId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST }),
  });
}
