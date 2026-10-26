import { API_BASE } from "./config";
import { ApiError, apiRequest, newIdempotencyKey, refreshAccessToken } from "./api-client";
import { getAccessToken } from "./auth-storage";

/**
 * The AI assistant (Alet). Every call goes to the Zoiko API, which holds the
 * model credentials; nothing here talks to an AI provider directly.
 */

/** A file attached to a question. Documents are read for their text; images are looked at. */
export interface AssistantAttachment {
  id: string;
  kind: "DOCUMENT" | "IMAGE";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pageCount: number | null;
  /** The document was longer than Alet reads; the answer covers the start. */
  truncated: boolean;
}

export interface AssistantMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  attachments: AssistantAttachment[];
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface AssistantConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage[];
}

export interface AssistantReply {
  conversation: { id: string; title: string; createdAt: string; updatedAt: string };
  /** The question as saved, then the answer. */
  messages: [AssistantMessage, AssistantMessage];
}

/** Matches the server's limit (assistant.schema.ts). */
export const ASSISTANT_MAX_QUESTION_CHARS = 4000;

/** What can be attached, as the server checks it (assistant.files.ts). */
export const ASSISTANT_FILE_EXTENSIONS = ["pdf", "doc", "docx", "png", "jpg", "jpeg", "webp", "gif"];
export const ASSISTANT_FILE_ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif";
export const ASSISTANT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ASSISTANT_MAX_FILES = 4;

/** Why a file cannot be attached, before it is sent anywhere; null if it can. */
export function assistantFileProblem(file: File): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  if (!ASSISTANT_FILE_EXTENSIONS.includes(ext)) return "Alet can read PDF, Word (.doc, .docx) and image (PNG, JPEG, WebP, GIF) files.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > ASSISTANT_MAX_FILE_BYTES) return "Files can be up to 10 MB.";
  return null;
}

export function listAssistantConversations(): Promise<AssistantConversationSummary[]> {
  return apiRequest<AssistantConversationSummary[]>("/assistant/conversations");
}

export function getAssistantConversation(id: string): Promise<AssistantConversation> {
  return apiRequest<AssistantConversation>(`/assistant/conversations/${id}`);
}

export function askAssistant(content: string, conversationId?: string, attachmentIds: string[] = []): Promise<AssistantReply> {
  return apiRequest<AssistantReply>("/assistant/messages", {
    method: "POST",
    body: {
      ...(content ? { content } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
    },
  });
}

const authHeader = (): Record<string, string> => {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Upload a file for a question. The server checks it and reads it now, so a
 * file Alet cannot read is refused at once with the reason. One key per file,
 * kept for retries, so a retried upload is stored once.
 */
export async function uploadAssistantFile(file: File, idempotencyKey: string = newIdempotencyKey()): Promise<AssistantAttachment> {
  const attempt = async () => {
    const form = new FormData();
    form.append("file", file, file.name);
    try {
      return await fetch(`${API_BASE}/assistant/attachments`, {
        method: "POST",
        headers: { ...authHeader(), "Idempotency-Key": idempotencyKey },
        body: form,
      });
    } catch {
      throw new ApiError(0, "The connection dropped while uploading. Try again.", "NETWORK_ERROR");
    }
  };
  let res = await attempt();
  if (res.status === 401 && (await refreshAccessToken())) res = await attempt();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error?.message || `Upload failed (${res.status})`, body.error?.code);
  }
  return (await res.json()).data;
}

export async function removeAssistantUpload(id: string): Promise<void> {
  await apiRequest(`/assistant/attachments/${id}`, { method: "DELETE" });
}

/** An attached image, for its thumbnail and preview. */
export async function loadAssistantImage(id: string): Promise<Blob> {
  let res = await fetch(`${API_BASE}/assistant/attachments/${id}/content`, { headers: authHeader() });
  if (res.status === 401 && (await refreshAccessToken())) res = await fetch(`${API_BASE}/assistant/attachments/${id}/content`, { headers: authHeader() });
  if (!res.ok) throw new ApiError(res.status, "Couldn't load this image", undefined);
  return res.blob();
}

export function renameAssistantConversation(id: string, title: string) {
  return apiRequest<{ id: string; title: string }>(`/assistant/conversations/${id}`, { method: "PATCH", body: { title } });
}

export async function deleteAssistantConversation(id: string): Promise<void> {
  await apiRequest(`/assistant/conversations/${id}`, { method: "DELETE" });
}
