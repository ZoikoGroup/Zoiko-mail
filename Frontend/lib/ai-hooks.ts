"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAiActions,
  createAiAction,
  reviewAiAction,
  type AIAction,
  type AIActionType,
} from "./ai-api";

export function useAiActions() {
  return useQuery({
    queryKey: ["ai", "actions"],
    queryFn: listAiActions,
    staleTime: 15_000,
  });
}

export function useCreateAiAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionType: AIActionType; messageId?: string; threadId?: string }) =>
      createAiAction(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai", "actions"] }),
  });
}

export function useReviewAiAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: "CONFIRMED" | "DISMISSED" }) =>
      reviewAiAction(v.id, v.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai", "actions"] }),
  });
}

export type { AIAction };