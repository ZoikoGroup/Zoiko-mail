import { apiRequest } from "./api-client";

export type AIActionType =
  | "DRAFT" | "SUMMARY" | "COMMITMENT_EXTRACTION" | "REPLY_OWED" | "DEADLINE" | "APPROVAL";

export type AIActionStatus = "PENDING" | "COMPLETED" | "CONFIRMED" | "DISMISSED" | "FAILED";

export interface AIAction {
  id: string;
  actionType: AIActionType;
  messageId: string | null;
  threadId: string | null;
  output: Record<string, unknown> | null;
  confidenceScore: number | null;
  sourceExcerpt: string | null;
  status: AIActionStatus;
  createdAt: string;
  updatedAt: string;
}

export async function listAiActions(): Promise<AIAction[]> {
  const data = await apiRequest<{ actions: AIAction[] }>("/ai/actions");
  return data.actions ?? [];
}

export async function createAiAction(input: {
  actionType: AIActionType;
  messageId?: string;
  threadId?: string;
}): Promise<AIAction> {
  return apiRequest<AIAction>("/ai/actions", { method: "POST", body: input });
}

export async function reviewAiAction(
  id: string,
  status: "CONFIRMED" | "DISMISSED"
): Promise<AIAction> {
  return apiRequest<AIAction>(`/ai/actions/${id}/review`, { method: "PATCH", body: { status } });
}