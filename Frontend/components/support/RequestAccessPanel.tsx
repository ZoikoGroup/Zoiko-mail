"use client";

import { useState } from "react";
import { ShieldQuestion } from "lucide-react";

import { requestSupportAccess, type SupportScope } from "@/lib/support-api";
import { ApiError } from "@/lib/api-client";

/**
 * How a support seat obtains the one thing still gated behind access.
 *
 * The workspace console answers by invitation — an accepted SUPPORT
 * membership in the workspace IS the authorization, so every section opens
 * without a grant. Diagnostics is the exception: it runs against a
 * time-boxed grant an Owner or Admin approves. Before this panel existed,
 * the only way to obtain that grant was for somebody to call the API
 * directly.
 *
 * The attribution the server insists on is asked for here rather than
 * guessed at: a ticket in this workspace, or an incident named in the reason.
 * Collecting it at request time means the owner is deciding on a case instead
 * of being asked to invent one.
 */

const SCOPES: Array<{ value: SupportScope; label: string; hint: string }> = [
  { value: "TENANT_DIAGNOSTICS", label: "Workspace diagnostics", hint: "members, mailboxes, status" },
  { value: "DNS_DIAGNOSTICS", label: "DNS and domains", hint: "MX, SPF, DKIM, DMARC" },
  { value: "DELIVERY_DIAGNOSTICS", label: "Delivery and bounces", hint: "delivery and provider events" },
  { value: "AUDIT_READ", label: "Audit log", hint: "who did what in this workspace" },
];

const WINDOWS = [15, 30, 60, 120, 240];

export function RequestAccessPanel({ onRequested }: { onRequested?: () => void }) {
  const [reason, setReason] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [scopes, setScopes] = useState<SupportScope[]>(["TENANT_DIAGNOSTICS"]);
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const toggle = (s: SupportScope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestSupportAccess({
        reason: reason.trim(),
        ticketId: ticketId.trim() || undefined,
        scopes,
        requestedMinutes: minutes,
      });
      setSent(true);
      onRequested?.();
    } catch (e) {
      // readableMessage prefers the server's per-field reason over
      // "Validation failed", which is what the attribution rule returns.
      setError(e instanceof ApiError ? e.readableMessage : "Could not send that request.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-950">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Request sent</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          The workspace owner has been notified. Access opens as soon as they approve it, and ends
          on its own when the window runs out — you will not need to close it.
        </p>
      </div>
    );
  }

  const ready = reason.trim().length >= 10 && scopes.length > 0;

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <ShieldQuestion className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Ask for diagnostics access
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Your invitation into this workspace already opens every screen here —
            the console is not gated on a grant. Diagnostics is the one thing
            that still runs against an owner-approved window: it expires on its
            own, and every run is recorded in their audit log.
          </p>
        </div>
      </div>

      <label htmlFor="ra-reason" className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
        Why you need it
      </label>
      <textarea
        id="ra-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="INC-1234 — customer reports external mail bouncing since 09:00"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Name the ticket or incident. An access nobody can account for afterwards is refused.
      </p>

      <label htmlFor="ra-ticket" className="mb-1 mt-4 block text-xs font-medium text-slate-700 dark:text-slate-300">
        Ticket ID <span className="font-normal text-slate-500">(optional)</span>
      </label>
      <input
        id="ra-ticket"
        value={ticketId}
        onChange={(e) => setTicketId(e.target.value)}
        placeholder="Ticket in this workspace"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-medium text-slate-700 dark:text-slate-300">
          What you need to see
        </legend>
        <div className="space-y-1.5">
          {SCOPES.map((s) => (
            <label key={s.value} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={scopes.includes(s.value)}
                onChange={() => toggle(s.value)}
                className="mt-0.5 h-4 w-4 accent-teal-600"
              />
              <span>
                <span className="text-slate-800 dark:text-slate-200">{s.label}</span>{" "}
                <span className="text-xs text-slate-500 dark:text-slate-400">— {s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="ra-window" className="mb-1 mt-4 block text-xs font-medium text-slate-700 dark:text-slate-300">
        For how long
      </label>
      <select
        id="ra-window"
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        {WINDOWS.map((m) => (
          <option key={m} value={m}>
            {m} minutes
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        The owner can shorten this. They cannot extend it beyond what you ask for.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || busy}
        className="mt-5 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Sending…" : "Request access"}
      </button>
    </div>
  );
}
