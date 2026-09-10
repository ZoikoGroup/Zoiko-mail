"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listAiActions,
  createAiAction,
  reviewAiAction,
  type AIAction,
  type AIActionType,
} from "./ai-api";
import { listMail, type MailItem } from "./mail-api";

export function useAiActions() {
  return useQuery({
    queryKey: ["ai", "actions"],
    queryFn: listAiActions,
    staleTime: 15_000,
    // Light polling keeps new extractions appearing without a websocket layer.
    refetchInterval: 30_000,
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
    // Optimistic: the card flips to the reviewed status the moment the user
    // clicks, and reverts if the server disagrees.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["ai", "actions"] });
      const prev = qc.getQueryData<AIAction[]>(["ai", "actions"]);
      qc.setQueryData<AIAction[]>(["ai", "actions"], (old) =>
        (old ?? []).map((a) =>
          a.id === v.id ? { ...a, status: v.status } : a
        )
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["ai", "actions"], ctx.prev);
    },
    onSuccess: (_data, v) => {
      // A confirmed action materializes a commitment (ZM-BE-008) — make the
      // Commitments tab reflect it immediately.
      if (v.status === "CONFIRMED") qc.invalidateQueries({ queryKey: ["actions"] });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai", "actions"] }),
  });
}

// ---- Generated-draft polling ----------------------------------------------
// Confirming a REPLY_OWED/APPROVAL action enqueues an AI_DRAFT_GENERATION
// background job on the backend. There is no per-action status endpoint for
// members, so the UI polls the DRAFTS mailbox for a message created from this
// action (sourceAiActionId) until it arrives or we give up.

export type AiDraftPollState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "ready"; draft: MailItem }
  | { phase: "failed"; message: string };

export function useAiDraftPoll(
  actionId: string | null,
  opts?: { intervalMs?: number; timeoutMs?: number }
): { state: AiDraftPollState; retry: () => void } {
  const intervalMs = opts?.intervalMs ?? 2_500;
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const [state, setState] = useState<AiDraftPollState>({ phase: "idle" });
  const [nonce, setNonce] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!actionId) {
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "generating" });
    startedAtRef.current = Date.now();
    let stopped = false;

    const tick = () => {
      void (async () => {
        if (stopped) return;
        try {
          const data = await listMail({ folder: "DRAFTS", page: 1, limit: 50 });
          const found = data.items.find(
            (item) => item.message.sourceAiActionId === actionId
          );
          if (found) {
            setState({ phase: "ready", draft: found });
            return;
          }
        } catch {
          // Transient failure (session refresh, backend restart) — keep going.
        }
        if (Date.now() - (startedAtRef.current ?? 0) > timeoutMs) {
          setState({
            phase: "failed",
            message:
              "The draft is taking longer than expected. The background job may have failed — check your drafts in Webmail, or try again.",
          });
        }
      })();
    };

    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [actionId, nonce, intervalMs, timeoutMs]);

  const retry = () => setNonce((n) => n + 1);
  return { state, retry };
}

export type { AIAction };