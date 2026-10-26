"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  askAssistant,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  renameAssistantConversation,
  type AssistantConversation,
} from "./assistant-api";

const LIST = ["assistant", "conversations"] as const;
const one = (id: string) => ["assistant", "conversation", id] as const;

export function useAssistantConversations() {
  return useQuery({ queryKey: LIST, queryFn: listAssistantConversations, staleTime: 30_000 });
}

export function useAssistantConversation(id: string | null) {
  return useQuery({
    queryKey: one(id ?? "none"),
    queryFn: () => getAssistantConversation(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** Ask a question. The answer is written into the conversation's cache, so it shows at once. */
export function useAskAssistant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, conversationId, attachmentIds }: { content: string; conversationId?: string; attachmentIds?: string[] }) =>
      askAssistant(content, conversationId, attachmentIds),
    onSuccess: (reply) => {
      qc.setQueryData<AssistantConversation>(one(reply.conversation.id), (current) => ({
        ...reply.conversation,
        messages: [...(current?.messages ?? []), ...reply.messages],
      }));
      qc.invalidateQueries({ queryKey: LIST });
    },
  });
}

export function useRenameAssistantConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameAssistantConversation(id, title),
    onSuccess: (saved) => {
      qc.setQueryData<AssistantConversation>(one(saved.id), (current) => (current ? { ...current, title: saved.title } : current));
      qc.invalidateQueries({ queryKey: LIST });
    },
  });
}

export function useDeleteAssistantConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAssistantConversation(id),
    onSettled: (_data, _error, id) => {
      qc.removeQueries({ queryKey: one(id) });
      qc.invalidateQueries({ queryKey: LIST });
    },
  });
}
