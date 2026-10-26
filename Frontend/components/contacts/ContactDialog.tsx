"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api-client";
import { useCreateContact, useUpdateContact } from "@/lib/contacts-hooks";
import type { Contact, ContactVisibility, CreateContactInput } from "@/lib/contacts-api";

/** What a new contact starts with (e.g. Save to contacts from the directory or Other Contacts). */
export interface ContactSeed {
  firstName?: string;
  lastName?: string;
  email?: string;
  source?: "MANUAL" | "MAIL";
}

type Fields = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  notes: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9 ().\-/x]+$/i;

function problems(f: Fields): Partial<Record<keyof Fields, string>> {
  const out: Partial<Record<keyof Fields, string>> = {};
  const email = f.email.trim();
  if (!email) out.email = "Enter an email address.";
  else if (!EMAIL.test(email) || email.length > 254) out.email = "Enter a valid email address.";
  const phone = f.phone.trim();
  if (phone && (!PHONE.test(phone) || (phone.match(/\d/g)?.length ?? 0) < 5 || phone.length > 30)) {
    out.phone = "Enter a valid phone number.";
  }
  if (f.firstName.trim().length > 120) out.firstName = "Keep it to 120 characters.";
  if (f.lastName.trim().length > 120) out.lastName = "Keep it to 120 characters.";
  if (f.company.trim().length > 200) out.company = "Keep it to 200 characters.";
  if (f.jobTitle.trim().length > 200) out.jobTitle = "Keep it to 200 characters.";
  if (f.notes.trim().length > 2000) out.notes = "Keep notes to 2,000 characters.";
  return out;
}

/** The server's reason, made readable: a field message for a 400, the message otherwise. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (Array.isArray(error.details) && error.details[0]?.message) return error.details[0].message;
    if (error.code === "NETWORK_ERROR") return error.message;
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** New contact, or edit one of one's own. */
export function ContactDialog({
  contact,
  seed,
  groups,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  seed?: ContactSeed;
  /** Existing groups, offered as suggestions. */
  groups: string[];
  onClose: () => void;
  onSaved: (contact: Contact, created: boolean) => void;
}) {
  const [fields, setFields] = useState<Fields>({
    firstName: contact?.firstName ?? seed?.firstName ?? "",
    lastName: contact?.lastName ?? seed?.lastName ?? "",
    email: contact?.email ?? seed?.email ?? "",
    phone: contact?.phone ?? "",
    company: contact?.company ?? "",
    jobTitle: contact?.jobTitle ?? "",
    notes: contact?.notes ?? "",
  });
  const [tags, setTags] = useState<string[]>(contact?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [visibility, setVisibility] = useState<ContactVisibility>(contact?.visibility ?? "PERSONAL");
  const [favorite, setFavorite] = useState(contact?.isFavorite ?? false);
  const [touched, setTouched] = useState(false);
  const create = useCreateContact();
  const update = useUpdateContact();
  const busy = create.isPending || update.isPending;
  const failure = create.error ?? update.error;
  const found = useMemo(() => problems(fields), [fields]);
  const invalid = Object.keys(found).length > 0;

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const addTag = (raw: string) => {
    const tag = raw.trim().slice(0, 50);
    if (!tag || tags.length >= 20 || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    setTags((t) => [...t, tag]);
    setTagInput("");
  };

  const save = () => {
    setTouched(true);
    if (invalid || busy) return;
    const pendingTag = tagInput.trim();
    const allTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag.slice(0, 50)] : tags;
    const trimmed = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()])) as Fields;
    if (contact) {
      // Emptied fields are sent as null so they are cleared.
      const input = {
        ...Object.fromEntries(Object.entries(trimmed).map(([k, v]) => [k, k === "email" ? v : v || null])),
        tags: allTags,
        visibility,
        isFavorite: favorite,
      };
      update.mutate({ id: contact.id, input }, { onSuccess: (saved) => onSaved(saved, false) });
    } else {
      const input: CreateContactInput = {
        email: trimmed.email,
        firstName: trimmed.firstName || undefined,
        lastName: trimmed.lastName || undefined,
        phone: trimmed.phone || undefined,
        company: trimmed.company || undefined,
        jobTitle: trimmed.jobTitle || undefined,
        notes: trimmed.notes || undefined,
        tags: allTags,
        visibility,
        isFavorite: favorite,
        source: seed?.source,
      };
      create.mutate(input, { onSuccess: (saved) => onSaved(saved, true) });
    }
  };

  const field = (key: keyof Fields, label: string, opts: { type?: string; placeholder?: string; required?: boolean; autoFocus?: boolean } = {}) => (
    <div>
      <label htmlFor={`contact-${key}`} className="mb-1 block text-[12px] font-medium text-[var(--ink2)]">
        {label}
        {opts.required && <span className="text-[var(--crit)]"> *</span>}
      </label>
      <input
        id={`contact-${key}`}
        type={opts.type ?? "text"}
        className="zoiko-input w-full"
        value={fields[key]}
        onChange={set(key)}
        placeholder={opts.placeholder}
        autoFocus={opts.autoFocus}
        aria-invalid={touched && Boolean(found[key])}
        aria-describedby={touched && found[key] ? `contact-${key}-error` : undefined}
      />
      {touched && found[key] && (
        <p id={`contact-${key}-error`} className="mt-1 text-[11.5px] text-[var(--crit)]">
          {found[key]}
        </p>
      )}
    </div>
  );

  const suggestions = groups.filter(
    (g) => !tags.includes(g) && (!tagInput || g.toLowerCase().includes(tagInput.toLowerCase()))
  );

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={contact ? "Edit contact" : "New contact"}
      size="lg"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : contact ? "Save changes" : "Add contact"}
          </button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="contact-form"
      >
        {field("firstName", "First name", { autoFocus: !contact })}
        {field("lastName", "Last name")}
        <div className="sm:col-span-2">{field("email", "Email", { type: "email", placeholder: "name@company.com", required: true })}</div>
        {field("phone", "Phone", { type: "tel", placeholder: "+44 20 7946 0000" })}
        {field("company", "Company")}
        <div className="sm:col-span-2">{field("jobTitle", "Job title")}</div>

        <div className="sm:col-span-2">
          <label htmlFor="contact-groups" className="mb-1 block text-[12px] font-medium text-[var(--ink2)]">
            Groups
          </label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 focus-within:border-[var(--accent)]">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[12px] text-[var(--accent-ink)]">
                {tag}
                <button
                  type="button"
                  onClick={() => setTags((t) => t.filter((x) => x !== tag))}
                  aria-label={`Remove ${tag}`}
                  className="rounded hover:text-[var(--ink)]"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <input
              id="contact-groups"
              className="min-w-[120px] flex-1 bg-transparent py-1 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
              value={tagInput}
              placeholder={tags.length ? "Add another group" : "e.g. Colleagues, Clients"}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                } else if (e.key === "Backspace" && !tagInput && tags.length) {
                  setTags((t) => t.slice(0, -1));
                }
              }}
            />
          </div>
          {suggestions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Existing groups">
              {suggestions.slice(0, 8).map((g) => (
                <button key={g} type="button" onClick={() => addTag(g)} className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11.5px] text-[var(--ink2)] hover:bg-[var(--s2)]">
                  + {g}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="contact-notes" className="mb-1 block text-[12px] font-medium text-[var(--ink2)]">
            Notes
          </label>
          <textarea
            id="contact-notes"
            rows={3}
            className="zoiko-input w-full resize-y"
            value={fields.notes}
            onChange={set("notes")}
            aria-invalid={touched && Boolean(found.notes)}
          />
          {touched && found.notes && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{found.notes}</p>}
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[12px] font-medium text-[var(--ink2)]">Who can see it</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["PERSONAL", "Personal", "Only you."],
                ["SHARED", "Shared with workspace", "Everyone in your workspace can see it. Only you can change it."],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-[12.5px] ${
                  visibility === value ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--s2)]"
                }`}
              >
                <input type="radio" name="contact-visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} className="mt-0.5 accent-[var(--accent)]" />
                <span>
                  <span className="block font-medium text-[var(--ink)]">{label}</span>
                  <span className="text-[var(--ink3)]">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-[13px] text-[var(--ink2)] sm:col-span-2">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Add to Favourites
        </label>

        {failure && (
          <p role="alert" className="text-[12px] text-[var(--crit)] sm:col-span-2">
            {errorText(failure)}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
