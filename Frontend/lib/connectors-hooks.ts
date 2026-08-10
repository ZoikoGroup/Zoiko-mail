"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listConnectors,
  createConnector,
  disconnectConnector,
  getConnectorHealth,
  listDeadLetter,
  replayDeadLetter,
  type Connector,
  type CreateConnectorInput,
} from "./connectors-api";

const KEY = ["connectors"] as const;
const HEALTH_KEY = ["connectors", "health"] as const;
const DEADLETTER_KEY = ["connectors", "dead-letter"] as const;

export function useConnectors() {
  return useQuery({ queryKey: KEY, queryFn: listConnectors, staleTime: 15_000 });
}

export function useCreateConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConnectorInput) => createConnector(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDisconnectConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => disconnectConnector(accountId),
    onMutate: async (accountId) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<Connector[]>(KEY);
      qc.setQueryData<Connector[]>(KEY, (old) => (old ?? []).filter((a) => a.id !== accountId));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// ---- admin ----------------------------------------------------------------
export function useConnectorHealth(enabled: boolean) {
  return useQuery({ queryKey: HEALTH_KEY, queryFn: getConnectorHealth, enabled, staleTime: 30_000 });
}

export function useDeadLetter(enabled: boolean) {
  return useQuery({ queryKey: DEADLETTER_KEY, queryFn: listDeadLetter, enabled, staleTime: 30_000 });
}

export function useReplayDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => replayDeadLetter(eventId),
    onSuccess: () => qc.invalidateQueries({ queryKey: DEADLETTER_KEY }),
  });
}