import { apiRequest } from "./api-client";

// ---- Types (mirror the real GET /actions response) ----
export type ActionPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type ActionStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "SNOOZED"
  | "COMPLETED"
  | "DISMISSED";

export interface ActionItem {
  id: string;
  tenantId: string;
  messageId: string | null;
  threadId: string | null;
  ownerUserId: string | null;
  createdByUserId: string | null;
  text: string;
  dueAt: string | null;
  priority: ActionPriority;
  status: ActionStatus;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

// The list lives at data.actions
interface ListActionsResponse {
  actions: ActionItem[];
}

export interface CreateActionInput {
  text: string;
  priority?: ActionPriority;
  dueAt?: string;
  ownerUserId?: string;
  messageId?: string;
  threadId?: string;
}

// updateActionSchema: status + (snoozedUntil required when SNOOZED)
export interface UpdateActionInput {
  status: ActionStatus;
  snoozedUntil?: string | null;
}

export interface ListActionsParams {
  status?: ActionStatus;
  since?: string;      // ISO datetime, filters createdAt >= since
  until?: string;      // ISO datetime, filters createdAt <= until
  dueBefore?: string;  // ISO datetime, filters dueAt <= dueBefore
  dueAfter?: string;   // ISO datetime, filters dueAt >= dueAfter
}

// export async function listActions(): Promise<ActionItem[]> {
//   const data = await apiRequest<ListActionsResponse>("/actions");
//   return data.actions ?? [];
// }

export async function listActions(params?: ListActionsParams): Promise<ActionItem[]> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.since) query.set("since", params.since);
  if (params?.until) query.set("until", params.until);
  if (params?.dueBefore) query.set("dueBefore", params.dueBefore);
  if (params?.dueAfter) query.set("dueAfter", params.dueAfter);
  const qs = query.toString();
  const path = qs ? `/actions?${qs}` : "/actions";
  const data = await apiRequest<ListActionsResponse>(path);
  return data.actions ?? [];
}

export async function createAction(input: CreateActionInput): Promise<ActionItem> {
  return apiRequest<ActionItem>("/actions", { method: "POST", body: input });
}

export async function updateAction(
  id: string,
  input: UpdateActionInput
): Promise<ActionItem> {
  return apiRequest<ActionItem>(`/actions/${id}`, { method: "PATCH", body: input });
}