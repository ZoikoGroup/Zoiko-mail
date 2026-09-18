"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, Save, Clock, Loader2, AlertCircle, CheckCircle2, Paperclip } from "lucide-react";
import { useComposerSubmit, type ComposerMode, useSignature, useSendableMailboxes } from "@/lib/mail-hooks";
import type { MailItem, Recipients } from "@/lib/mail-api";
import { RecipientInput } from "@/components/mail/RecipientInput";

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const ALLOWED_TYPES = [
  "application/pdf",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/gif",
  "image/jpeg",
  "image/png",
  "text/csv",
  "text/plain",
];

const ACCEPT = ALLOWED_TYPES.join(",");

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The From options. A workspace with no shared mailboxes gets exactly one
  // entry, and the picker stays hidden — nobody should have to choose between
  // one thing.
  const { data: sendable } = useSendableMailboxes();
  const options = sendable?.mailboxes ?? [];
  const ownAddress = options.find((mailbox) => !mailbox.shared)?.address;

  const [sendAsMailboxId, setSendAsMailboxId] = useState("");
  // const [to, setTo] = useState("");
  // const [cc, setCc] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [notice, setNotice] = useState<{ kind: "gate" | "ok" | "err"; text: string } | null>(null);
  const { data: sigData } = useSignature();

  // Reset the form whenever the composer opens for a new context.
  useEffect(() => {
    if (!open) return;
    // setTo("");
    // setCc("");
    setTo([]);
    setCc([]);
    // setBody("");
    const sig = sigData?.signature;
    setBody(sig ? `\n\n--\n${sig}` : "");
    setFiles([]);
    setShowSchedule(false);
    setScheduledAt("");
    setNotice(null);
    // Defaults to one's own address every time the composer opens, rather than
    // remembering the last shared mailbox used: sending as the team by
    // accident is the mistake worth designing against.
    setSendAsMailboxId("");
    if (mode === "new") setSubject("");
    // reply/forward subjects are derived server-side, so we don't edit them here
  }, [open, mode, source?.messageId]);

  if (!open) return null;

  const needsRecipients = mode === "new" || mode === "forward";
  const srcMsg = source?.message;

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    // Deduplicate by name+size
    const existing = new Set(files.map((f) => `${f.name}:${f.size}`));
    const fresh = arr.filter((f) => !existing.has(`${f.name}:${f.size}`));
    setFiles((prev) => [...prev, ...fresh]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const run = (action: "send" | "draft" | "schedule") => {
    setNotice(null);

    // let recipients: Recipients | undefined;
    // if (needsRecipients) {
    //   const toList = parseEmails(to);
    //   if (toList.length === 0) {
    //     setNotice({ kind: "err", text: "Add at least one recipient." });
    //     return;
    //   }
    //   recipients = { to: toList, cc: parseEmails(cc), bcc: [] };
    // }
    let recipients: Recipients | undefined;
    if (needsRecipients) {
      if (to.length === 0) {
        setNotice({ kind: "err", text: "Add at least one recipient." });
        return;
      }
      recipients = { to, cc, bcc: [] };
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
        sendAsMailboxId: sendAsMailboxId || undefined,
        scheduledAt: action === "schedule" ? new Date(scheduledAt).toISOString() : undefined,
        files: files.length > 0 ? files : undefined,
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

          {options.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-[var(--ink3)]">
              <span className="shrink-0">From</span>
              <select
                className={field}
                value={sendAsMailboxId}
                onChange={(e) => setSendAsMailboxId(e.target.value)}
              >
                <option value="">{ownAddress ?? "My address"}</option>
                {options
                  .filter((mailbox) => mailbox.shared)
                  .map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.id} disabled={mailbox.sendSuspended}>
                      {mailbox.address}
                      {mailbox.sendSuspended ? " — sending suspended" : ""}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {sendAsMailboxId && (
            // Sending in a team's name is worth stating plainly. The audit
            // trail records both the mailbox and the person either way.
            <p className="text-xs text-[var(--ink3)]">
              This goes out from the shared address, and the reply comes back to
              the shared mailbox. Your name stays on it in the audit trail.
            </p>
          )}

          {needsRecipients && (
            <>
              {/* <input className={field} placeholder="To (comma-separated)" value={to} onChange={(e) => setTo(e.target.value)} />
              <input className={field} placeholder="Cc (optional)" value={cc} onChange={(e) => setCc(e.target.value)} /> */}
              <RecipientInput value={to} onChange={setTo} placeholder="To" autoFocus />
              <RecipientInput value={cc} onChange={setCc} placeholder="Cc (optional)" />
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

          {/* Attached files list */}
          {files.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                {files.length} file{files.length > 1 ? "s" : ""} · {bytes(totalSize)}
              </div>
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${file.size}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-1.5"
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{file.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--ink3)]">{bytes(file.size)}</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="shrink-0 rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--crit)]"
                    title="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

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
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${notice.kind === "err"
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

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ""; // allow re-selecting same file
            }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="zoiko-btn sm"
            title="Attach files"
          >
            <Paperclip className="h-4 w-4" />
            <span className="hidden sm:inline">Attach</span>
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