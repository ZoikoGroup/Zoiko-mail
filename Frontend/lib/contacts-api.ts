import { apiRequest } from "./api-client";

// ── Types ───────────────────────────────────────────────────────────────────

export type ContactVisibility = "PERSONAL" | "SHARED";
export type ContactSource = "MANUAL" | "IMPORT" | "MAIL";

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
  /** The caller's own star; always false on someone else's shared contact. */
  isFavorite: boolean;
  visibility: ContactVisibility;
  source: ContactSource;
  /** Whether the caller may change or delete it. */
  owned: boolean;
  /** Who shared it, when it is not the caller's. */
  ownerName: string | null;
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

export interface ContactSummary {
  all: number;
  mine: number;
  personal: number;
  shared: number;
  favorites: number;
  directory: number;
  groups: { name: string; count: number }[];
}

export interface DirectoryPerson {
  membershipId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  savedContactId: string | null;
}

export interface OtherContact {
  email: string;
  name: string | null;
  messageCount: number;
  lastAt: string;
}

export interface ContactActivity {
  messages: { messageId: string; subject: string; folder: string; at: string }[];
  events: { eventId: string; title: string; startsAt: string; allDay: boolean }[];
}

export interface DuplicateGroup {
  reason: "NAME" | "PHONE";
  key: string;
  contacts: Contact[];
}

export interface ImportRow {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  notes?: string;
  tags?: string[];
}

export interface ImportResult {
  created: number;
  skipped: { row: number; email: string; reason: string }[];
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
  isFavorite?: boolean;
  visibility?: ContactVisibility;
  source?: "MANUAL" | "MAIL";
}

/** Fields set to null are cleared. */
export type UpdateContactInput = {
  [K in keyof Omit<CreateContactInput, "source">]?: CreateContactInput[K] | null;
};

export type ContactScope = "all" | "mine" | "personal" | "shared" | "favorites";
export type ContactSort = "name" | "company" | "recent";

export interface ListContactsParams {
  q?: string;
  tag?: string;
  scope?: ContactScope;
  sort?: ContactSort;
  page?: number;
  limit?: number;
}

// ── API Functions ───────────────────────────────────────────────────────────

export async function listContacts(params: ListContactsParams = {}): Promise<ContactListResponse> {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.tag) q.set("tag", params.tag);
  if (params.scope) q.set("scope", params.scope);
  if (params.sort) q.set("sort", params.sort);
  q.set("page", String(params.page ?? 1));
  q.set("limit", String(params.limit ?? 50));
  return apiRequest<ContactListResponse>(`/contacts?${q}`);
}

/** Every page of a list, for export. */
export async function listAllContacts(params: Omit<ListContactsParams, "page" | "limit">): Promise<Contact[]> {
  const all: Contact[] = [];
  for (let page = 1; ; page++) {
    const res = await listContacts({ ...params, page, limit: 100 });
    all.push(...res.items);
    if (page >= res.pagination.totalPages) return all;
  }
}

export async function getContactSummary(): Promise<ContactSummary> {
  return apiRequest<ContactSummary>("/contacts/summary");
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

export async function importContacts(contacts: ImportRow[]): Promise<ImportResult> {
  return apiRequest<ImportResult>("/contacts/import", { method: "POST", body: { contacts } });
}

export async function listDirectory(q = ""): Promise<DirectoryPerson[]> {
  return apiRequest<DirectoryPerson[]>(`/contacts/directory?q=${encodeURIComponent(q)}`);
}

export async function listOtherContacts(q = ""): Promise<OtherContact[]> {
  return apiRequest<OtherContact[]>(`/contacts/other?q=${encodeURIComponent(q)}`);
}

export async function getContactActivity(email: string): Promise<ContactActivity> {
  return apiRequest<ContactActivity>(`/contacts/activity?email=${encodeURIComponent(email)}`);
}

export async function listDuplicates(): Promise<DuplicateGroup[]> {
  return apiRequest<DuplicateGroup[]>("/contacts/duplicates");
}

export async function mergeContacts(keepId: string, mergeIds: string[]): Promise<Contact> {
  return apiRequest<Contact>("/contacts/merge", { method: "POST", body: { keepId, mergeIds } });
}

export async function listContactTags(): Promise<string[]> {
  return apiRequest<string[]>("/contacts/tags");
}

export async function suggestContacts(q: string): Promise<ContactSuggestion[]> {
  if (q.length < 2) return [];
  return apiRequest<ContactSuggestion[]>(`/contacts/suggest?q=${encodeURIComponent(q)}`);
}
