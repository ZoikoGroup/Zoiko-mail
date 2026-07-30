"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listActions,
  createAction,
  updateAction,
  type ActionItem,
  type CreateActionInput,
  type UpdateActionInput,
} from "./actions-api";

const KEY = ["actions"] as const;

export function useActions() {
  return useQuery({ queryKey: KEY, queryFn: listActions, staleTime: 15_000 });
}

export function useCreateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActionInput) => createAction(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string } & UpdateActionInput) =>
      updateAction(v.id, { status: v.status, snoozedUntil: v.snoozedUntil }),
    // Optimistic: patch the cache immediately, roll back on error.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<ActionItem[]>(KEY);
      qc.setQueryData<ActionItem[]>(KEY, (old) =>
        (old ?? []).map((a) =>
          a.id === v.id
            ? { ...a, status: v.status, snoozedUntil: v.snoozedUntil ?? a.snoozedUntil }
            : a
        )
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}