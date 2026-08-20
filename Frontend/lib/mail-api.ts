import { apiRequest, ApiError } from "./api-client";
import { API_BASE } from "./config";
import { getAccessToken } from "./auth-storage";

// ---- Types (mirror the backend mail module) --------------------------------
export type MailFolder = "INBOX" | "SENT" | "DRAFTS" | "ARCHIVE" | "TRASH" | "QUARANTINE";
export type RecipientType = "TO" | "CC" | "BCC";
export type MessageStatus =
  | "DRAFT" | "QUEUED" | "SCHEDULED" | "SENT" | "FAILED" | "RECEIVED" | string;

export interface MailRecipient {
  id: string;
  email: string;
  type: RecipientType;
  deliveryStatus: string;
}

export interface MailAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface MailLabel {
  id: string;
  name: string;
  color: string;
}

export interface EmailMessage {
  id: string;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  status: MessageStatus;
  sentAt: string | null;
  scheduledAt: string | null;
  threadId: string | null;
  authorUserId: string;
  fromAddress: string | null;
  fromName: string | null;
  createdAt: string;
  recipients: MailRecipient[];
  attachments: MailAttachment[];
  author: { id: string; email: string; displayName: string };
}

// A row in a folder = mailbox item + its message + labels.
export interface MailItem {
  id: string;
  messageId: string;
  folder: MailFolder;
  isRead: boolean;
  isStarred: boolean;
  createdAt: string;
  updatedAt: string;
  labels: MailLabel[];
  message: EmailMessage;
}

export interface MailPagination {
  folder: MailFolder;
  starredOnly: boolean;
  labelId?: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListMailResponse {
  items: MailItem[];
  pagination: MailPagination;
}

export interface ListMailParams {
  folder?: MailFolder;
  starredOnly?: boolean;
  labelId?: string;
  page?: number;
  limit?: number;
}

export interface Recipients {
  to: string[];
  cc?: string[];
  bcc?: string[];
}

export interface CreateDraftInput {
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  recipients: Recipients;
}

export type BulkAction =
  | "MARK_READ" | "MARK_UNREAD" | "STAR" | "UNSTAR" | "ARCHIVE" | "TRASH" | "RESTORE";

// ---- Read ------------------------------------------------------------------
export async function listMail(params: ListMailParams = {}): Promise<ListMailResponse> {
  const q = new URLSearchParams();
  q.set("folder", params.folder ?? "INBOX");
  if (params.starredOnly) q.set("starredOnly", "true");
  if (params.labelId) q.set("labelId", params.labelId);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 25));
  return apiRequest<ListMailResponse>(`/mail?${q.toString()}`);
}

export async function getMessage(messageId: string): Promise<MailItem> {
  return apiRequest<MailItem>(`/mail/${messageId}`);
}

export async function listLabels(): Promise<MailLabel[]> {
  const data = await apiRequest<{ labels: MailLabel[] }>("/mail/labels");
  return data.labels ?? [];
}

// ---- Triage ----------------------------------------------------------------
export async function updateMailItem(
  messageId: string,
  input: { isRead?: boolean; isStarred?: boolean; folder?: "INBOX" | "ARCHIVE" | "TRASH" }
): Promise<MailItem> {
  return apiRequest<MailItem>(`/mail/${messageId}`, { method: "PATCH", body: input });
}

export async function bulkMailAction(messageIds: string[], action: BulkAction) {
  return apiRequest(`/mail/bulk`, { method: "PATCH", body: { messageIds, action } });
}

// ---- Compose / send (Track B — gated at runtime by policy/mailbox status) --
export async function createDraft(input: CreateDraftInput): Promise<MailItem> {
  return apiRequest<MailItem>("/mail/drafts", { method: "POST", body: input });
}

export async function updateDraft(
  messageId: string,
  input: Partial<CreateDraftInput>
): Promise<MailItem> {
  return apiRequest<MailItem>(`/mail/drafts/${messageId}`, { method: "PATCH", body: input });
}

export async function deleteDraft(messageId: string) {
  return apiRequest(`/mail/drafts/${messageId}`, { method: "DELETE" });
}

export async function sendDraft(messageId: string) {
  return apiRequest(`/mail/drafts/${messageId}/send`, { method: "POST" });
}

export async function scheduleDraft(messageId: string, scheduledAt: string) {
  return apiRequest(`/mail/drafts/${messageId}/schedule`, {
    method: "POST",
    body: { scheduledAt },
  });
}

export async function reply(messageId: string, body: { textBody?: string; htmlBody?: string }) {
  return apiRequest<MailItem>(`/mail/${messageId}/reply`, { method: "POST", body });
}

export async function replyAll(messageId: string, body: { textBody?: string; htmlBody?: string }) {
  return apiRequest<MailItem>(`/mail/${messageId}/reply-all`, { method: "POST", body });
}

export async function forward(
  messageId: string,
  body: { recipients: Recipients; textBody?: string; htmlBody?: string }
) {
  return apiRequest<MailItem>(`/mail/${messageId}/forward`, { method: "POST", body });
}

// ---- Attachments -----------------------------------------------------------
// The download endpoint returns binary with an auth header, so we fetch it as a
// blob and trigger a browser download rather than using a plain <a href>.
export async function downloadAttachment(
  messageId: string,
  attachment: MailAttachment
): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/mail/${messageId}/attachments/${attachment.id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Couldn't download attachment");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = attachment.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- Threads --------------------------------------------------------------
// The backend groups related messages into threads (subject + participants).
// The list view returns one thread per row with only the most recent message
// preview inside; the detail view returns the full message list chronologically.

export interface MessageThread {
  id: string;
  subjectNormalized: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  // In list responses this contains only the most recent message (backend
  // does `take: 1`). In detail responses it contains all messages in
  // chronological order.
  messages: EmailMessage[];
}

export interface ThreadPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListThreadsResponse {
  threads: MessageThread[];
  pagination: ThreadPagination;
}

export interface ListThreadsParams {
  page?: number;
  limit?: number;
  q?: string;
}

export async function listThreads(params: ListThreadsParams = {}): Promise<ListThreadsResponse> {
  const q = new URLSearchParams();
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 25));
  if (params.q) q.set("q", params.q);
  return apiRequest<ListThreadsResponse>(`/threads?${q.toString()}`);
}

export async function getThread(threadId: string): Promise<MessageThread> {
  return apiRequest<MessageThread>(`/threads/${threadId}`);
}