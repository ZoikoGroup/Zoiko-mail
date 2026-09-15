import { apiRequest } from "./api-client";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  notes: string | null;
  tags: string[];
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListResponse {
  items: Contact[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ContactSuggestion {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

export interface CreateContactInput {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  notes?: string;
  tags?: string[];
}

export type UpdateContactInput = Partial<CreateContactInput>;

export interface ListContactsParams {
  q?: string;
  tag?: string;
  page?: number;
  limit?: number;
}

// ── API Functions ───────────────────────────────────────────────────────────

export async function listContacts(params: ListContactsParams = {}): Promise<ContactListResponse> {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.tag) q.set("tag", params.tag);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 50));
  return apiRequest<ContactListResponse>(`/contacts?${q}`);
}

export async function getContact(id: string): Promise<Contact> {
  return apiRequest<Contact>(`/contacts/${id}`);
}

export async function createContact(input: CreateContactInput): Promise<Contact> {
  return apiRequest<Contact>("/contacts", { method: "POST", body: input });
}

export async function updateContact(id: string, input: UpdateContactInput): Promise<Contact> {
  return apiRequest<Contact>(`/contacts/${id}`, { method: "PATCH", body: input });
}

export async function deleteContact(id: string): Promise<void> {
  await apiRequest(`/contacts/${id}`, { method: "DELETE" });
}

export async function listContactTags(): Promise<string[]> {
  return apiRequest<string[]>("/contacts/tags");
}

export async function suggestContacts(q: string): Promise<ContactSuggestion[]> {
  if (q.length < 2) return [];
  return apiRequest<ContactSuggestion[]>(`/contacts/suggest?q=${encodeURIComponent(q)}`);
}