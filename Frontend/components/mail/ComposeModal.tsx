"use client";

import { useEffect, useState } from "react";
import { X, Send, Save, Clock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { useComposerSubmit, type ComposerMode } from "@/lib/mail-hooks";
import type { MailItem, Recipients } from "@/lib/mail-api";

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const MODE_TITLE: Record<ComposerMode, string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

export function ComposeModal({
  open,
  mode,
  source,
  onClose,
}: {
  open: boolean;
  mode: ComposerMode;
  source: MailItem | null;
  onClose: () => void;
}) {
  const submit = useComposerSubmit();

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [notice, setNotice] = useState<{ kind: "gate" | "ok" | "err"; text: string } | null>(null);

  // Reset the form whenever the composer opens for a new context.
  useEffect(() => {
    if (!open) return;
    setTo("");
    setCc("");
    setBody("");
    setShowSchedule(false);
    setScheduledAt("");
    setNotice(null);
    if (mode === "new") setSubject("");
    // reply/forward subjects are derived server-side, so we don't edit them here
  }, [open, mode, source?.messageId]);

  if (!open) return null;

  const needsRecipients = mode === "new" || mode === "forward";
  const srcMsg = source?.message;

  const run = (action: "send" | "draft" | "schedule") => {
    setNotice(null);

    let recipients: Recipients | undefined;
    if (needsRecipients) {
      const toList = parseEmails(to);
      if (toList.length === 0) {
        setNotice({ kind: "err", text: "Add at least one recipient." });
        return;
      }
      recipients = { to: toList, cc: parseEmails(cc), bcc: [] };
    }

    if (action === "schedule" && !scheduledAt) {
      setNotice({ kind: "err", text: "Pick a date and time to schedule." });
      return;
    }

    submit.mutate(
      {
        mode,
        sourceId: source?.messageId,
        subject: mode === "new" ? subject : undefined,
        recipients,
        textBody: body,
        action,
        scheduledAt: action === "schedule" ? new Date(scheduledAt).toISOString() : undefined,
      },
      {
        onSuccess: (res) => {
          if (res.gated) {
            setNotice({ kind: "gate", text: res.gateMessage ?? "Saved as a draft." });
            return; // keep the composer open so they can see what happened
          }
          onClose();
        },
        onError: (err) => {
          setNotice({ kind: "err", text: err.message || "Something went wrong. Try again." });
        },
      }
    );
  };

  const field =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-[var(--surface)] shadow-[var(--sh3)] sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="font-editorial text-lg text-[var(--ink)]">{MODE_TITLE[mode]}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {/* Context line for reply/forward */}
          {mode !== "new" && srcMsg && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-xs text-[var(--ink3)]">
              {mode === "forward" ? "Forwarding" : "Replying to"}:{" "}
              <span className="text-[var(--ink2)]">{srcMsg.subject || "(no subject)"}</span>
              {mode !== "forward" && (
                <> — recipients are set automatically from the original message.</>
              )}
            </div>
          )}

          {needsRecipients && (
            <>
              <input className={field} placeholder="To (comma-separated)" value={to} onChange={(e) => setTo(e.target.value)} />
              <input className={field} placeholder="Cc (optional)" value={cc} onChange={(e) => setCc(e.target.value)} />
            </>
          )}

          {mode === "new" && (
            <input className={field} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          )}

          <textarea
            className={`${field} min-h-[220px] resize-y`}
            placeholder="Write your message…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          {showSchedule && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--ink3)]" />
              <input
                type="datetime-local"
                className={field}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
          )}

          {notice && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                notice.kind === "err"
                  ? "border-[var(--crit)]/30 bg-[var(--crit-soft)] text-[var(--crit)]"
                  : notice.kind === "gate"
                  ? "border-[var(--warn)]/30 bg-[var(--warn-soft)] text-[var(--warn)]"
                  : "border-[var(--ok)]/30 bg-[var(--ok-soft)] text-[var(--ok)]"
              }`}
            >
              {notice.kind === "err" ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : notice.kind === "gate" ? (
                <Save className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
          <button onClick={() => run(showSchedule ? "schedule" : "send")} disabled={submit.isPending} className="zoiko-btn pri disabled:opacity-50">
            {submit.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : showSchedule ? (
              <Clock className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {showSchedule ? "Schedule" : "Send"}
          </button>

          <button onClick={() => run("draft")} disabled={submit.isPending} className="zoiko-btn disabled:opacity-50">
            <Save className="h-4 w-4" /> Save draft
          </button>

          <button
            onClick={() => setShowSchedule((s) => !s)}
            className="zoiko-btn sm ml-auto"
            title="Schedule send"
          >
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">{showSchedule ? "Cancel schedule" : "Schedule"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ComposeModal;