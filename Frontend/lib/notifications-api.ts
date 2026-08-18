import { apiRequest } from "./api-client";

export type NotificationType = string;

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(unreadOnly = false): Promise<AppNotification[]> {
  const q = unreadOnly ? "?unreadOnly=true" : "";
  const data = await apiRequest<{ notifications: AppNotification[] }>(`/notifications${q}`);
  return data.notifications ?? [];
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  return apiRequest<AppNotification>(`/notifications/${id}/read`, { method: "PATCH" });
}

// Enqueues a digest job. idempotencyKey must be 8–120 chars.
export async function sendDigestNow(): Promise<unknown> {
  const idempotencyKey = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return apiRequest(`/notifications/digests`, { method: "POST", body: { idempotencyKey } });
}