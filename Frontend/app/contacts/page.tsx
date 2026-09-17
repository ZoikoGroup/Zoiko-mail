"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import {
  Search, Plus, Trash2, Pencil, X, Loader2, Tag, User, Building2,
  Phone, Mail, StickyNote, ChevronLeft, ChevronRight, BookUser,
} from "lucide-react";
import {
  useContacts, useCreateContact, useUpdateContact, useDeleteContact, useContactTags,
} from "@/lib/contacts-hooks";
import type { Contact, CreateContactInput, UpdateContactInput } from "@/lib/contacts-api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function displayName(c: Contact) {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : c.email;
}

function initials(c: Contact) {
  const f = c.firstName?.[0] ?? "";
  const l = c.lastName?.[0] ?? "";
  if (f || l) return (f + l).toUpperCase();
  return c.email[0]?.toUpperCase() ?? "?";
}

// ── Contact Form Modal ──────────────────────────────────────────────────────

function ContactModal({
  contact,
  onClose,
}: {
  contact: Contact | null; // null = create mode
  onClose: () => void;
}) {
  const create = useCreateContact();
  const update = useUpdateContact();
  const isEdit = !!contact;

  const [form, setForm] = useState({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    company: contact?.company ?? "",
    jobTitle: contact?.jobTitle ?? "",
    notes: contact?.notes ?? "",
    tagsRaw: contact?.tags?.join(", ") ?? "",
  });
  const [error, setError] = useState("");

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    setError("");
    if (!form.email.trim()) {
      setError("Email is required.");
      return;
    }
    const tags = form.tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const input = {
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      email: form.email.trim(),
      phone: form.phone || undefined,
      company: form.company || undefined,
      jobTitle: form.jobTitle || undefined,
      notes: form.notes || undefined,
      tags,
    };

    const opts = {
      onSuccess: () => onClose(),
      onError: (err: Error) => setError(err.message),
    };

    if (isEdit) {
      update.mutate({ id: contact!.id, input }, opts);
    } else {
      create.mutate(input, opts);
    }
  };

  const pending = create.isPending || update.isPending;

  const field =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] placeholder:text-[var(--ink3)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-[var(--surface)] shadow-[var(--sh3)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="font-editorial text-lg text-[var(--ink)]">
            {isEdit ? "Edit Contact" : "New Contact"}
          </h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <input className={field} placeholder="First name" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
            <input className={field} placeholder="Last name" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </div>
          <input className={field} placeholder="Email *" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input className={field} placeholder="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <input className={field} placeholder="Company" value={form.company} onChange={(e) => set("company", e.target.value)} />
            <input className={field} placeholder="Job title" value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
          </div>
          <textarea className={`${field} min-h-[80px] resize-y`} placeholder="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          <input className={field} placeholder="Tags (comma-separated, e.g. client, vip)" value={form.tagsRaw} onChange={(e) => set("tagsRaw", e.target.value)} />

          {error && (
            <div className="rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-sm text-[var(--crit)]">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button onClick={onClose} className="zoiko-btn">Cancel</button>
          <button onClick={save} disabled={pending} className="zoiko-btn pri disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Contact Detail Panel ────────────────────────────────────────────────────

function DetailPanel({
  contact,
  onEdit,
  onDelete,
  onClose,
}: {
  contact: Contact;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const del = useDeleteContact();

  const handleDelete = () => {
    if (!confirm(`Delete ${displayName(contact)}?`)) return;
    del.mutate(contact.id, { onSuccess: () => { onDelete(); onClose(); } });
  };

  const info = [
    { icon: Mail, label: "Email", value: contact.email },
    { icon: Phone, label: "Phone", value: contact.phone },
    { icon: Building2, label: "Company", value: contact.company },
    { icon: User, label: "Title", value: contact.jobTitle },
  ].filter((i) => i.value);

  return (
    <div className="flex h-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--ink)]">Contact details</span>
        <button onClick={onClose} className="rounded-md p-1 text-[var(--ink3)] hover:bg-[var(--s2)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Avatar + name */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-xl font-bold text-white">
            {initials(contact)}
          </div>
          <h3 className="mt-3 text-lg font-semibold text-[var(--ink)]">{displayName(contact)}</h3>
          {contact.company && (
            <p className="text-xs text-[var(--ink3)]">
              {contact.jobTitle ? `${contact.jobTitle} at ` : ""}{contact.company}
            </p>
          )}
        </div>

        {/* Info rows */}
        <div className="mt-6 space-y-3">
          {info.map((i) => (
            <div key={i.label} className="flex items-start gap-3">
              <i.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink3)]" />
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{i.label}</div>
                <div className="text-sm text-[var(--ink)]">{i.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tags */}
        {contact.tags.length > 0 && (
          <div className="mt-6">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((t) => (
                <span key={t} className="zoiko-pill nu text-xs">{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {contact.notes && (
          <div className="mt-6">
            <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
              <StickyNote className="h-3 w-3" /> Notes
            </div>
            <p className="whitespace-pre-wrap text-sm text-[var(--ink2)]">{contact.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-[var(--border)] px-4 py-3">
        <button onClick={onEdit} className="zoiko-btn sm flex-1">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
        <button onClick={handleDelete} disabled={del.isPending} className="zoiko-btn crit sm flex-1 disabled:opacity-50">
          {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ open: boolean; contact: Contact | null }>({ open: false, contact: null });

  const { data, isLoading } = useContacts({ q, tag: tagFilter || undefined, page, limit: 50 });
  const { data: tags = [] } = useContactTags();

  const items = data?.items ?? [];
  const pagination = data?.pagination;
  const selected = items.find((c) => c.id === selectedId) ?? null;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [tagFilter]);

  return (
    <AppShell>
      <div className="flex h-full">
        {/* List panel */}
        <div className={`flex min-w-0 flex-1 flex-col ${selectedId ? "hidden md:flex md:w-96" : "flex"}`}>
          {/* Header */}
          <div className="border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center justify-between">
              <h1 className="flex items-center gap-2 font-editorial text-xl text-[var(--ink)]">
                <BookUser className="h-5 w-5" /> Contacts
              </h1>
              <button onClick={() => setModal({ open: true, contact: null })} className="zoiko-btn pri sm">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            {/* Search + tag filter */}
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contacts…"
                  className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-3 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink3)]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {tags.length > 0 && (
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--ink)]"
                >
                  <option value="">All tags</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-[var(--ink3)]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--ink3)]">
                <BookUser className="h-10 w-10" />
                <p className="mt-2 text-sm">{q || tagFilter ? "No contacts match your search." : "No contacts yet."}</p>
                {!q && !tagFilter && (
                  <button onClick={() => setModal({ open: true, contact: null })} className="zoiko-btn pri sm mt-3">
                    <Plus className="h-4 w-4" /> Add your first contact
                  </button>
                )}
              </div>
            ) : (
              items.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition hover:bg-[var(--s2)] ${
                    selectedId === c.id ? "bg-[var(--s2)]" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-xs font-bold text-[var(--accent)]">
                    {initials(c)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--ink)]">{displayName(c)}</div>
                    <div className="truncate text-xs text-[var(--ink3)]">
                      {c.email}
                      {c.company && ` · ${c.company}`}
                    </div>
                  </div>
                  {c.tags.length > 0 && (
                    <div className="hidden shrink-0 sm:flex sm:gap-1">
                      {c.tags.slice(0, 2).map((t) => (
                        <span key={t} className="zoiko-pill nu text-[10px]">{t}</span>
                      ))}
                      {c.tags.length > 2 && (
                        <span className="text-[10px] text-[var(--ink3)]">+{c.tags.length - 2}</span>
                      )}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--ink3)]">
              <span>{pagination.total} contacts</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="zoiko-btn sm disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-2">
                  {page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="zoiko-btn sm disabled:opacity-30"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-full md:w-80 lg:w-96">
            <DetailPanel
              contact={selected}
              onEdit={() => setModal({ open: true, contact: selected })}
              onDelete={() => setSelectedId(null)}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal.open && (
        <ContactModal
          contact={modal.contact}
          onClose={() => setModal({ open: false, contact: null })}
        />
      )}
    </AppShell>
  );
}