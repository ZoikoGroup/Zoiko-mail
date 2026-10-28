"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage, recalculateStorage } from "./storage-api";

const KEY = ["mail", "storage"] as const;

export function useStorage() {
  return useQuery({ queryKey: KEY, queryFn: getStorage, staleTime: 15_000 });
}

/** Recounts what the mailbox holds; the rail's meter follows. */
export function useRecalculateStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recalculateStorage,
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      qc.invalidateQueries({ queryKey: ["mail", "mailbox"] });
    },
  });
}
