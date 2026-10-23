"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X, UserPlus } from "lucide-react";
import { usePeopleSearch } from "@/lib/calendar-hooks";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Initials for an avatar: "Sarah Chen" → "SC", "dana@x.com" → "DA". */
export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") && !nameOrEmail.includes(" ") ? nameOrEmail.split("@")[0]! : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : base.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Who to invite: chips for each address, with colleagues suggested as you
 * type. Any valid address can be added — colleagues answer in Zoiko, anyone
 * else is listed as a guest.
 */
export function AttendeeInput({
  value,
  onChange,
  names,
  inputId,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Known display names, by address (from suggestions and the loaded event). */
  names?: Record<string, string>;
  inputId: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Record<string, string>>(names ?? {});
  const [debounced, setDebounced] = useState("");
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setKnown((k) => ({ ...k, ...(names ?? {}) })), [names]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const { data: suggestions = [] } = usePeopleSearch(debounced);
  const shown = suggestions.filter((p) => !value.includes(p.email.toLowerCase())).slice(0, 6);

  const add = (raw: string, name?: string | null) => {
    const email = raw.trim().replace(/[,;]+$/, "").toLowerCase();
    if (!email) return;
    if (!EMAIL.test(email)) {
      setError(`“${raw.trim()}” is not an email address.`);
      return;
    }
    setError(null);
    if (name) setKnown((k) => ({ ...k, [email]: name }));
    if (!value.includes(email)) onChange([...value, email]);
    // Close the suggestions so they do not cover what comes next (e.g. a Share button).
    setOpen(false);
    setText("");
  };

  return (
    <div ref={box} className="relative">
      <div className="zoiko-input flex min-h-[40px] w-full flex-wrap items-center gap-1.5 py-1.5">
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--s2)] py-0.5 pl-1 pr-1.5 text-[12px] text-[var(--ink)]"
            data-testid="attendee-chip"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[9.5px] font-semibold text-white" aria-hidden>
              {initials(known[email] ?? email)}
            </span>
            <span className="truncate" title={email}>
              {known[email] ?? email}
            </span>
            <button
              type="button"
              onClick={() => onChange(value.filter((e) => e !== email))}
              aria-label={`Remove ${known[email] ?? email}`}
              className="rounded-full p-0.5 text-[var(--ink3)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          className="min-w-[160px] flex-1 bg-transparent text-[13px] text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none"
          placeholder={value.length ? "Add more people" : "Add colleagues or email addresses"}
          value={text}
          role="combobox"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setOpen(true);
            setError(null);
            const next = e.target.value;
            if (/[,;\s]$/.test(next) && next.trim()) add(next);
            else setText(next);
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "Tab") && text.trim()) {
              e.preventDefault();
              const match = shown.find((p) => p.email.toLowerCase() === text.trim().toLowerCase()) ?? (EMAIL.test(text.trim()) ? null : shown[0]);
              if (match) add(match.email, match.name);
              else add(text);
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => {
            if (text.trim() && EMAIL.test(text.trim())) add(text);
          }}
        />
      </div>
      {error && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{error}</p>}
      {open && shown.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--sh3)]"
        >
          {shown.map((person) => (
            <li key={person.email}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(person.email, person.name)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--s2)]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-ink)]" aria-hidden>
                  {initials(person.name ?? person.email)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-[var(--ink)]">{person.name ?? person.email}</span>
                  <span className="block truncate text-[11.5px] text-[var(--ink3)]">{person.email}</span>
                </span>
                <UserPlus className="ml-auto h-4 w-4 text-[var(--ink3)]" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
