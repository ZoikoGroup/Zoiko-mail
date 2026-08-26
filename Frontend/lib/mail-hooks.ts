"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";
import {
  listMail,
  getMessage,
  listLabels,
  createLabel,
  deleteLabel,
  assignLabel,
  removeLabel,
  updateMailItem,
  bulkMailAction,
  permanentlyDeleteMessage,
  emptyTrash,
  createDraft,
  sendDraft,
  scheduleDraft,
  deleteDraft,
  reply as replyApi,
  replyAll as replyAllApi,
  forward as forwardApi,
  fetchUnreadCounts,
  type ListMailParams,
  type ListMailResponse,
  type MailItem,
  type BulkAction,
  type Recipients,
  listThreads,
  getThread,
  type ListThreadsParams,
} from "./mail-api";

// const listKey = (params: ListMailParams) =>
//   ["mail", "list", params.folder ?? "INBOX", params.starredOnly ?? false, params.labelId ?? null, params.page ?? 1] as const;

const listKey = (params: ListMailParams) =>
  ["mail", "list", params.folder ?? "INBOX", params.starredOnly ?? false, params.unreadOnly ?? false, params.labelId ?? null, params.page ?? 1] as const;

export function useMailList(params: ListMailParams) {
  return useQuery({
    queryKey: listKey(params),
    queryFn: () => listMail(params),
    staleTime: 15_000,
    // Light polling keeps the inbox fresh without a websocket layer.
    refetchInterval: 30_000,
  });
}

export function useUnreadCounts() {
  return useQuery({
    queryKey: ["mail", "unread-counts"],
    queryFn: fetchUnreadCounts,
    staleTime: 15_000,
    refetchInterval: 30_000,
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

export function useCreateLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string }) => createLabel(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail", "labels"] }),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => deleteLabel(labelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail", "labels"] });
      qc.invalidateQueries({ queryKey: ["mail", "list"] });
    },
  });
}

export function useAssignLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { messageId: string; labelId: string }) => assignLabel(v.messageId, v.labelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail", "list"] });
      qc.invalidateQueries({ queryKey: ["mail", "message"] });
    },
  });
}

export function useRemoveLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { messageId: string; labelId: string }) => removeLabel(v.messageId, v.labelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mail", "list"] });
      qc.invalidateQueries({ queryKey: ["mail", "message"] });
    },
  });
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

export function usePermanentlyDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => permanentlyDeleteMessage(messageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail"] }),
  });
}

export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: emptyTrash,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail"] }),
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteDraft(messageId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail"] }),
  });
}

export type ComposerMode = "new" | "reply" | "replyAll" | "forward";

export interface ComposerPayload {
  mode: ComposerMode;
  sourceId?: string; // required for reply/replyAll/forward
  subject?: string; // new only (reply/forward subject is derived server-side)
  recipients?: Recipients; // new + forward
  textBody: string;
  action: "send" | "draft" | "schedule";
  scheduledAt?: string; // ISO, required when action === "schedule"
}

export interface ComposerResult {
  draftId: string;
  action: "sent" | "draft" | "scheduled";
  gated: boolean; // true when a send was requested but blocked by policy/mailbox
  gateMessage?: string;
}

// Orchestrates the backend's create-then-send model. Because reply/forward and
// createDraft persist a draft *before* sending, a blocked send (Track B gate:
// 403 policy / 429 suspended or warm-up) degrades gracefully to "saved as
// draft" rather than losing the user's message.
export function useComposerSubmit() {
  const qc = useQueryClient();
  return useMutation<ComposerResult, Error, ComposerPayload>({
    mutationFn: async (p) => {
      // 1) create the draft according to mode
      let draft: MailItem;
      if (p.mode === "new") {
        draft = await createDraft({
          subject: p.subject ?? "",
          textBody: p.textBody,
          recipients: p.recipients ?? { to: [], cc: [], bcc: [] },
        });
      } else if (p.mode === "reply") {
        draft = await replyApi(p.sourceId as string, { textBody: p.textBody });
      } else if (p.mode === "replyAll") {
        draft = await replyAllApi(p.sourceId as string, { textBody: p.textBody });
      } else {
        draft = await forwardApi(p.sourceId as string, {
          recipients: p.recipients as Recipients,
          textBody: p.textBody,
        });
      }

      const draftId = draft.messageId ?? draft.id;

      // 2) act on it
      if (p.action === "draft") {
        return { draftId, action: "draft", gated: false };
      }
      if (p.action === "schedule") {
        await scheduleDraft(draftId, p.scheduledAt as string);
        return { draftId, action: "scheduled", gated: false };
      }
      // action === "send" — catch the runtime Track B gate specifically
      try {
        await sendDraft(draftId);
        return { draftId, action: "sent", gated: false };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 429)) {
          return {
            draftId,
            action: "draft",
            gated: true,
            gateMessage:
              err.status === 429
                ? "Your mailbox can't send right now (suspended or warming up). Saved as a draft."
                : "Sending isn't enabled for your mailbox yet. Saved as a draft.",
          };
        }
        throw err; // genuine failure
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mail", "list"] }),
  });
}

export type { MailItem };

// ---- Threads --------------------------------------------------------------
// staleTime: 15s matches useMailList — threads change at the same cadence
// as mail (new incoming messages create/update threads).

const threadsListKey = (params: ListThreadsParams) =>
  ["mail", "threads", "list", params.page ?? 1, params.limit ?? 25, params.q ?? ""] as const;

export function useThreads(params: ListThreadsParams) {
  return useQuery({
    queryKey: threadsListKey(params),
    queryFn: () => listThreads(params),
    staleTime: 15_000,
  });
}

export function useThread(threadId: string | null) {
  return useQuery({
    queryKey: ["mail", "threads", "detail", threadId],
    queryFn: () => getThread(threadId as string),
    enabled: Boolean(threadId),
    staleTime: 15_000,
  });
}