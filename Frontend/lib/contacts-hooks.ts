"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listContacts,
  getContact,
  getContactSummary,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  listDirectory,
  listOtherContacts,
  getContactActivity,
  listDuplicates,
  mergeContacts,
  listContactTags,
  suggestContacts,
  type ListContactsParams,
  type CreateContactInput,
  type UpdateContactInput,
  type ImportRow,
} from "./contacts-api";

// Every contact query starts with "contacts", so one invalidation after a
// change refreshes the lists, counts, directory marks and duplicates alike.

export function useContacts(params: ListContactsParams = {}) {
  return useQuery({
    queryKey: ["contacts", "list", params],
    queryFn: () => listContacts(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** A list loaded 100 at a time, for the Contacts page's "Show more". */
export function useContactPages(params: Omit<ListContactsParams, "page" | "limit">, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["contacts", "pages", params],
    queryFn: ({ pageParam }) => listContacts({ ...params, page: pageParam, limit: 100 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    staleTime: 30_000,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useContactSummary() {
  return useQuery({
    queryKey: ["contacts", "summary"],
    queryFn: getContactSummary,
    staleTime: 30_000,
  });
}

export function useContact(id: string | null) {
  return useQuery({
    queryKey: ["contacts", "one", id],
    queryFn: () => getContact(id!),
    enabled: !!id,
  });
}

export function useDirectory(q: string, enabled = true) {
  return useQuery({
    queryKey: ["contacts", "directory", q],
    queryFn: () => listDirectory(q),
    staleTime: 60_000,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useOtherContacts(q: string, enabled = true) {
  return useQuery({
    queryKey: ["contacts", "other", q],
    queryFn: () => listOtherContacts(q),
    staleTime: 60_000,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useContactActivity(email: string | null) {
  return useQuery({
    queryKey: ["contacts", "activity", email],
    queryFn: () => getContactActivity(email!),
    enabled: !!email,
    staleTime: 60_000,
  });
}

export function useDuplicates(enabled = true) {
  return useQuery({
    queryKey: ["contacts", "duplicates"],
    queryFn: listDuplicates,
    enabled,
  });
}

function useInvalidateContacts() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["contacts"] });
}

export function useCreateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (input: CreateContactInput) => createContact(input),
    onSuccess: invalidate,
  });
}

export function useUpdateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContactInput }) => updateContact(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onSuccess: invalidate,
  });
}

export function useImportContacts() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (rows: ImportRow[]) => importContacts(rows),
    onSuccess: invalidate,
  });
}

export function useMergeContacts() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({ keepId, mergeIds }: { keepId: string; mergeIds: string[] }) => mergeContacts(keepId, mergeIds),
    onSuccess: invalidate,
  });
}

export function useContactTags() {
  return useQuery({
    queryKey: ["contacts", "tags"],
    queryFn: listContactTags,
    staleTime: 60_000,
  });
}

export function useContactSuggestions(q: string) {
  return useQuery({
    queryKey: ["contacts", "suggest", q],
    queryFn: () => suggestContacts(q),
    enabled: q.length >= 2,
    staleTime: 10_000,
  });
}
