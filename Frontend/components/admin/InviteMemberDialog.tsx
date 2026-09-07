"use client";

import { useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

import { ApiError } from "@/lib/api-client";
import { usePreviewInvitation, useSendInvitation } from "@/lib/admin-hooks";
import type { InvitationLetterDto } from "@/lib/admin-queries";

type Role = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";

interface InviteMemberDialogProps {
  /** Roles this admin may actually grant, from their capabilities. */
  grantableRoles: Role[];
  onClose: () => void;
}

/**
 * Invite someone: collect who they are, read the letter, then send it.
 *
 * Two steps rather than one form, because the invitation is the first thing
 * the recipient ever sees from this workspace and it goes to someone who does
 * not yet trust the sender. An admin should be able to read it — and change
 * the wording — before a stranger receives it.
 *
 * The letter is drafted by the server, not here. Keeping the wording in one
 * place means the review step shows exactly what will be sent, rather than a
 * copy that drifts from it.
 */
export function InviteMemberDialog({
  grantableRoles,
  onClose,
}: InviteMemberDialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(grantableRoles[0] ?? "MEMBER");

  const [letter, setLetter] = useState<InvitationLetterDto | null>(null);
  /** The body as the admin has it, one string per paragraph. */
  const [body, setBody] = useState<string[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const draft = usePreviewInvitation();
  const send = useSendInvitation();

  const trimmed = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.trim(),
  };

  const onDraft = () => {
    setFieldError(null);
    if (!trimmed.firstName) return setFieldError("First name is required.");
    if (!trimmed.lastName) return setFieldError("Last name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      return setFieldError("Enter a valid email address.");
    }

    draft.mutate(
      {
        firstName: trimmed.firstName,
        lastName: trimmed.lastName,
        email: trimmed.email,
        role,
      },
      {
        onSuccess: (drafted) => {
          setLetter(drafted);
          setBody(drafted.paragraphs);
        },
      }
    );
  };

  const onSend = () => {
    if (!letter) return;
    const cleaned = body.map((p) => p.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      return setFieldError("The letter needs at least one paragraph.");
    }

    // Only send a body when it differs from the draft. An unedited invitation
    // then uses the server's own wording rather than a copy of it, which would
    // go stale if the template were reworded later.
    const edited =
      cleaned.join("\n") !== letter.paragraphs.join("\n") ? cleaned : undefined;

    send.mutate(
      {
        firstName: trimmed.firstName,
        lastName: trimmed.lastName,
        email: trimmed.email,
        role,
        letterBody: edited,
      },
      { onSuccess: onClose }
    );
  };

  const requestError = (err: unknown) =>
    err instanceof ApiError ? err.message : err ? "Something went wrong." : null;

  const error =
    fieldError ?? requestError(draft.error) ?? requestError(send.error);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="New invitation"
        className="relative z-10 w-full max-w-[640px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
          <h2 className="flex-1 text-sm font-semibold text-[var(--ink)]">
            {letter ? "Review the invitation" : "New invitation"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-5">
          {!letter ? (
            <div className="space-y-4">
              <p className="text-[12.5px] text-[var(--ink3)]">
                Their name is used to address the letter, so it reads as a
                personal invitation rather than a system notice.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name">
                  <input
                    className="zoiko-input"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoFocus
                  />
                </Field>
                <Field label="Last name">
                  <input
                    className="zoiko-input"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Email address">
                <input
                  className="zoiko-input"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field label="Role">
                <select
                  className="zoiko-input"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {grantableRoles.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0) + r.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <LetterPreview
              letter={letter}
              body={body}
              onBodyChange={setBody}
            />
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-3 py-2 text-[12px] text-[var(--crit)]">
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-[var(--border)] px-5 py-4">
          {letter && (
            <button
              type="button"
              className="zoiko-btn"
              onClick={() => {
                setLetter(null);
                setFieldError(null);
              }}
            >
              Back
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="zoiko-btn" onClick={onClose}>
            Cancel
          </button>
          {!letter ? (
            <button
              type="button"
              className="zoiko-btn pri"
              onClick={onDraft}
              disabled={draft.isPending}
            >
              {draft.isPending ? "Drafting…" : "Draft letter"}
            </button>
          ) : (
            <button
              type="button"
              className="zoiko-btn pri"
              onClick={onSend}
              disabled={send.isPending}
            >
              {send.isPending ? "Sending…" : "Send invitation"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink3)]">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * The letter as the recipient will see it: wordmark, greeting, body.
 *
 * Laid out like the email rather than like a form, because the point of this
 * step is to judge how it reads. The body is editable in place; the greeting
 * and the expiry footer are not — they are facts about the invitation rather
 * than prose, and the server sets them either way.
 */
function LetterPreview({
  letter,
  body,
  onBodyChange,
}: {
  letter: InvitationLetterDto;
  body: string[];
  onBodyChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-[12px] text-[var(--ink3)]">
        <span className="font-semibold text-[var(--ink2)]">Subject:</span>{" "}
        {letter.subject}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-5">
        <Image
          src="/zoiko-wordmark.png"
          alt="Zoiko Mail"
          width={148}
          height={20}
          className="mb-5 h-5 w-auto dark:hidden"
        />
        <Image
          src="/zoiko-wordmark-dark.png"
          alt=""
          aria-hidden
          width={148}
          height={20}
          className="mb-5 hidden h-5 w-auto dark:block"
        />

        <p className="mb-3 text-[14px] font-medium text-[var(--ink)]">
          {letter.greeting}
        </p>

        <textarea
          className="zoiko-input min-h-[210px] w-full resize-y font-normal leading-relaxed"
          value={body.join("\n\n")}
          onChange={(e) =>
            // Blank lines separate paragraphs, which is how the body is
            // stored and how the email renders it.
            onBodyChange(e.target.value.split(/\n\s*\n/))
          }
          aria-label="Invitation letter body"
        />

        <p className="mt-4 text-[11px] text-[var(--ink3)]">
          {letter.closing} The accept button and expiry notice are added when
          the email is sent.
        </p>
      </div>
    </div>
  );
}
