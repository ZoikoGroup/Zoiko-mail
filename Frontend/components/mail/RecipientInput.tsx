"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, User } from "lucide-react";
import { useContactSuggestions } from "@/lib/contacts-hooks";

const SEPARATOR = /[\s,;]+/;
// Deliberately loose — this only gates what counts as "looks like an email"
// for turning free text into a chip; the backend is the real validator.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function initialsFor(name: string | null, email: string) {
  const base = (name?.trim() || email).trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2 && name) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

/**
 * A To/Cc field that behaves like a normal text input (paste, type,
 * comma/space/Enter to commit) but also shows a contact-suggestion dropdown
 * as the person types, backed by GET /contacts/suggest.
 *
 * Value is a flat list of committed email addresses; the in-progress text
 * lives in local state until it's turned into a chip.
 */
export function RecipientInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = draft.trim();
  const { data: suggestions = [] } = useContactSuggestions(query);

  // Don't suggest someone who's already been added.
  const filtered = useMemo(
    () => suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.email.toLowerCase())),
    [suggestions, value]
  );

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length, draft]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const addEmail = (raw: string) => {
    const email = raw.trim().replace(/[,;]+$/, "");
    if (!email) return;
    if (value.some((v) => v.toLowerCase() === email.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...value, email]);
    setDraft("");
  };

  const addSuggestion = (email: string) => {
    if (!value.some((v) => v.toLowerCase() === email.toLowerCase())) {
      onChange([...value, email]);
    }
    setDraft("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const removeAt = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const commitDraftChips = (text: string) => {
    // A paste can carry several addresses at once — split and add each one
    // that looks like a real address; leave any leftover fragment as draft
    // text so the person can keep typing/fixing it.
    const parts = text.split(SEPARATOR).filter(Boolean);
    if (parts.length === 0) return;
    const complete = parts.filter((p) => LOOKS_LIKE_EMAIL.test(p));
    const rest = text.endsWith(" ") || text.endsWith(",") || text.endsWith(";") ? "" : parts[parts.length - 1];
    const toAdd = LOOKS_LIKE_EMAIL.test(rest) ? complete : complete.filter((p) => p !== rest);
    if (toAdd.length > 0) {
      const merged = [...value];
      for (const email of toAdd) {
        if (!merged.some((v) => v.toLowerCase() === email.toLowerCase())) merged.push(email);
      }
      onChange(merged);
    }
    setDraft(LOOKS_LIKE_EMAIL.test(rest) ? "" : rest);
  };

  const handleChange = (text: string) => {
    if (SEPARATOR.test(text)) {
      commitDraftChips(text);
      setOpen(true);
      return;
    }
    setDraft(text);
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && open && filtered.length > 0 && draft.trim()) {
      e.preventDefault();
      addSuggestion(filtered[highlight]?.email ?? filtered[0].email);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      addEmail(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && value.length > 0) {
      removeAt(value.length - 1);
      return;
    }
    if (e.key === "ArrowDown" && open && filtered.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp" && open && filtered.length > 0) {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && query.length >= 2 && filtered.length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email, i) => (
          <span
            key={`${email}-${i}`}
            className="zoiko-pill accent flex items-center gap-1 !py-0.5"
          >
            <span className="max-w-[220px] truncate">{email}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
              className="rounded-full p-0.5 hover:bg-black/10"
              aria-label={`Remove ${email}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => addEmail(draft)}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink3)]"
        />
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--sh2)]">
          {filtered.map((s, i) => {
            const name = [s.firstName, s.lastName].filter(Boolean).join(" ");
            return (
              <button
                key={s.id}
                type="button"
                // onMouseDown (not onClick) so this fires before the input's
                // onBlur closes the dropdown out from under it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  addSuggestion(s.email);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                  i === highlight ? "bg-[var(--s2)]" : ""
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[10px] font-bold text-[var(--accent)]">
                  {name ? initialsFor(name, s.email) : <User className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  {name && (
                    <div className="truncate text-sm text-[var(--ink)]">{name}</div>
                  )}
                  <div className="truncate text-xs text-[var(--ink3)]">{s.email}</div>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RecipientInput;