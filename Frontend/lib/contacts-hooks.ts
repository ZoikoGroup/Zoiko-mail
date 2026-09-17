"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  listContactTags,
  suggestContacts,
  type ListContactsParams,
  type CreateContactInput,
  type UpdateContactInput,
} from "./contacts-api";

export function useContacts(params: ListContactsParams = {}) {
  return useQuery({
    queryKey: ["contacts", params],
    queryFn: () => listContacts(params),
    staleTime: 30_000,
  });
}

export function useContact(id: string | null) {
  return useQuery({
    queryKey: ["contacts", id],
    queryFn: () => getContact(id!),
    enabled: !!id,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactInput) => createContact(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContactInput }) => updateContact(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteContact(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
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