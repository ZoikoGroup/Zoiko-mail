"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEvidence,
  confirmSuggestion,
  createCommitment,
  createDecision,
  createDependency,
  createStream,
  decide,
  deleteCommitment,
  deleteDecision,
  deleteDependency,
  deleteStream,
  dismissSuggestion,
  getOverview,
  listCommitments,
  listDecisions,
  listDependencies,
  listStreams,
  listSuggestions,
  removeEvidence,
  searchPeople,
  updateCommitment,
  updateDecision,
  updateDependency,
  updateStream,
  type CommitmentFilters,
  type DecisionFilters,
  type OverviewFilters,
} from "./workgraph-api";

/**
 * Everything the Work Graph shows lives under one query key, so any change
 * (including one a colleague makes, announced over the live connection) refreshes
 * every page that could be affected: a decision's approval moves deliverables,
 * a recorded commitment unblocks one, and the overview draws all of it.
 */
export const WORKGRAPH_ROOT = ["workgraph"] as const;

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: WORKGRAPH_ROOT });
}

export function useCommitments(filters: CommitmentFilters) {
  return useQuery({
    queryKey: [...WORKGRAPH_ROOT, "commitments", filters],
    queryFn: () => listCommitments(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useDecisions(filters: DecisionFilters) {
  return useQuery({
    queryKey: [...WORKGRAPH_ROOT, "decisions", filters],
    queryFn: () => listDecisions(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useDependencies(state: "open" | "all" = "all", q = "") {
  return useQuery({
    queryKey: [...WORKGRAPH_ROOT, "dependencies", state, q],
    queryFn: () => listDependencies(state, q),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useStreams() {
  return useQuery({ queryKey: [...WORKGRAPH_ROOT, "streams"], queryFn: listStreams, staleTime: 30_000 });
}

export function useOverview(filters: OverviewFilters) {
  return useQuery({
    queryKey: [...WORKGRAPH_ROOT, "overview", filters],
    queryFn: () => getOverview(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

export function useSuggestions(kind?: "COMMITMENT" | "DECISION", enabled = true) {
  return useQuery({ queryKey: [...WORKGRAPH_ROOT, "suggestions", kind ?? "all"], queryFn: () => listSuggestions(kind), staleTime: 15_000, enabled });
}

export function usePeople(q: string) {
  return useQuery({
    queryKey: [...WORKGRAPH_ROOT, "people", q],
    queryFn: () => searchPeople(q),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCreateCommitment() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: createCommitment, onSuccess: invalidate });
}
export function useUpdateCommitment() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateCommitment>[1] }) => updateCommitment(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteCommitment() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => deleteCommitment(id), onSuccess: invalidate });
}

export function useCreateDecision() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: createDecision, onSuccess: invalidate });
}
export function useUpdateDecision() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateDecision>[1] }) => updateDecision(id, input),
    onSuccess: invalidate,
  });
}
export function useDecide() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof decide>[1] }) => decide(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteDecision() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => deleteDecision(id), onSuccess: invalidate });
}

export function useCreateDependency() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: createDependency, onSuccess: invalidate });
}
export function useUpdateDependency() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateDependency>[1] }) => updateDependency(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteDependency() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => deleteDependency(id), onSuccess: invalidate });
}

export function useCreateStream() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: createStream, onSuccess: invalidate });
}
export function useUpdateStream() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateStream>[1] }) => updateStream(id, input),
    onSuccess: invalidate,
  });
}
export function useDeleteStream() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => deleteStream(id), onSuccess: invalidate });
}

export function useAddEvidence() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: addEvidence, onSuccess: invalidate });
}
export function useRemoveEvidence() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => removeEvidence(id), onSuccess: invalidate });
}

export function useConfirmSuggestion() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: Parameters<typeof confirmSuggestion>[1] }) => confirmSuggestion(id, input),
    onSuccess: invalidate,
  });
}
export function useDismissSuggestion() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => dismissSuggestion(id), onSuccess: invalidate });
}
