"use client";

import { useEffect, useRef, useState } from "react";

import {
  MAILBOX_WORKSPACES,
  MAILBOX_WORKSPACE_LABEL,
  type MailboxWorkspace,
} from "@/lib/admin-api";

/** The assignment in display order, as a short label for the closed control. */
export function workspaceSummary(workspaces: MailboxWorkspace[]): string {
  const chosen = MAILBOX_WORKSPACES.filter((scope) => workspaces.includes(scope));
  if (chosen.length === MAILBOX_WORKSPACES.length) return "All workspaces";
  return chosen.map((scope) => MAILBOX_WORKSPACE_LABEL[scope]).join(", ") || "None";
}

/**
 * Which workspace consoles a mailbox opens in: a dropdown of four checkboxes.
 *
 * The choice is a draft until Apply, so ticking through the options does not
 * save four times, and Cancel or a click outside leaves the saved assignment
 * as it was. At least one must stay ticked — a mailbox that opens nowhere is
 * mail nobody can read — so Apply is disabled on an empty draft.
 */
export function WorkspaceMultiSelect({
  value,
  onApply,
  disabled,
  pending,
  label,
}: {
  value: MailboxWorkspace[];
  /** Called with the new assignment; omitted to use the control as a plain form field. */
  onApply: (workspaces: MailboxWorkspace[]) => void;
  disabled?: boolean;
  pending?: boolean;
  /** Accessible name, e.g. "Workspaces for dana@acme.com". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MailboxWorkspace[]>(value);
  const root = useRef<HTMLDivElement>(null);

  // Re-seed from what was saved each time it opens, so a refetch while
  // closed is what the next edit starts from.
  useEffect(() => {
    if (open) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = (scope: MailboxWorkspace) =>
    setDraft((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    );
  const unchanged =
    draft.length === value.length && draft.every((scope) => value.includes(scope));

  return (
    <div ref={root} className="relative inline-block">
      <button
        type="button"
        className="zoiko-input flex min-w-[150px] items-center justify-between gap-2 text-left text-[12px]"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled || pending}
        onClick={() => setOpen((o) => !o)}
        title={workspaceSummary(value)}
      >
        <span className="truncate">{pending ? "Saving…" : workspaceSummary(value)}</span>
        <span aria-hidden className="text-[10px] text-[var(--ink3)]">▾</span>
      </button>

      {open && (
        <div
          role="group"
          aria-label={label}
          className="absolute left-0 z-30 mt-1 w-56 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg"
        >
          {MAILBOX_WORKSPACES.map((scope) => (
            <label
              key={scope}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-[var(--s2)]"
            >
              <input
                type="checkbox"
                checked={draft.includes(scope)}
                onChange={() => toggle(scope)}
              />
              {MAILBOX_WORKSPACE_LABEL[scope]} workspace
            </label>
          ))}
          {draft.length === 0 && (
            <p className="px-2 pt-1 text-[11px] text-[var(--crit)]">Choose at least one workspace.</p>
          )}
          <p className="px-2 pt-1.5 text-[10.5px] leading-snug text-[var(--ink3)]">
            For a personal mailbox, Admin, Owner and Support also decide whether its owner may sign into
            those consoles. Member is always available.
          </p>
          <div className="mt-2 flex justify-end gap-1.5 border-t border-[var(--border)] pt-2">
            <button type="button" className="zoiko-btn sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="zoiko-btn pri sm"
              disabled={draft.length === 0 || unchanged}
              onClick={() => {
                onApply(MAILBOX_WORKSPACES.filter((scope) => draft.includes(scope)));
                setOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
