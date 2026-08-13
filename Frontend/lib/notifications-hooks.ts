"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  markNotificationRead,
  sendDigestNow,
  type AppNotification,
} from "./notifications-api";

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ["notifications", unreadOnly],
    queryFn: () => listNotifications(unreadOnly),
    staleTime: 20_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useSendDigest() {
  return useMutation({ mutationFn: () => sendDigestNow() });
}

export type { AppNotification };