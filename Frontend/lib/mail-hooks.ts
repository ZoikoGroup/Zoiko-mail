"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listMail,
  getMessage,
  listLabels,
  updateMailItem,
  bulkMailAction,
  type ListMailParams,
  type ListMailResponse,
  type MailItem,
  type BulkAction,
} from "./mail-api";

const listKey = (params: ListMailParams) =>
  ["mail", "list", params.folder ?? "INBOX", params.starredOnly ?? false, params.labelId ?? null, params.page ?? 1] as const;

export function useMailList(params: ListMailParams) {
  return useQuery({
    queryKey: listKey(params),
    queryFn: () => listMail(params),
    staleTime: 15_000,
  });
}

export function useMessage(messageId: string | null) {
  return useQuery({
    queryKey: ["mail", "message", messageId],
    queryFn: () => getMessage(messageId as string),
    enabled: Boolean(messageId),
    staleTime: 15_000,
  });
}

export function useMailLabels() {
  return useQuery({ queryKey: ["mail", "labels"], queryFn: listLabels, staleTime: 60_000 });
}

// Triage a single item (read / star / move). Optimistically patches every
// cached list page so the UI reacts instantly, then refetches to reconcile.
export function useUpdateMailItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      messageId: string;
      isRead?: boolean;
      isStarred?: boolean;
      folder?: "INBOX" | "ARCHIVE" | "TRASH";
    }) => updateMailItem(v.messageId, { isRead: v.isRead, isStarred: v.isStarred, folder: v.folder }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["mail", "list"] });
      const snapshots = qc.getQueriesData<ListMailResponse>({ queryKey: ["mail", "list"] });
      snapshots.forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData<ListMailResponse>(key, {
          ...data,
          items: data.items.map((it) =>
            it.messageId === v.messageId
              ? {
                  ...it,
                  isRead: v.isRead ?? it.isRead,
                  isStarred: v.isStarred ?? it.isStarred,
                }
              : it
          ),
        });
      });
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["mail", "list"] }),
  });
}

export function useBulkMailAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { messageIds: string[]; action: BulkAction }) =>
      bulkMailAction(v.messageIds, v.action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail", "list"] }),
  });
}

export type { MailItem };