"use client";

import { useEffect, useRef, useState } from "react";
import { X, Save, Clock, AlertCircle, CheckCircle2, Paperclip } from "lucide-react";
import { useComposerSubmit, type ComposerMode, useSignature, useSendableMailboxes } from "@/lib/mail-hooks";
import { updateDraft } from "@/lib/mail-api";
import type { MailItem, Recipients } from "@/lib/mail-api";
import { RecipientInput } from "@/components/mail/RecipientInput";
import { RichTextEditor } from "@/components/mail/RichTextEditor";
import { SendMenu } from "@/components/mail/SendMenu";

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
  edit: "Edit draft",
};

/** How long to wait after the last keystroke before autosaving. Long enough
 * that we aren't firing a request per character, short enough that closing
 * the tab mid-sentence rarely loses more than this much typing. */
const AUTOSAVE_DEBOUNCE_MS = 2000;

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
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<{ kind: "gate" | "ok" | "err"; text: string } | null>(null);
  const { data: sigData } = useSignature();

  // Autosave. draftId is null until the first save actually creates a
  // draft row — before that there's nothing to PATCH, so the first save
  // goes through the same mode-specific creation (createDraft / replyApi /
  // replyAllApi / forwardApi) that an explicit "Save draft" click already
  // uses; every save after that is a plain updateDraft against that id.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const draftIdRef = useRef<string | null>(null);
  draftIdRef.current = draftId;

  // Reset the form whenever the composer opens for a new context.
  useEffect(() => {
    if (!open) return;
    setShowBcc(false);
    setFiles([]);
    setNotice(null);
    setSavedAt(null);
    // Defaults to one's own address every time the composer opens, rather than
    // remembering the last shared mailbox used: sending as the team by
    // accident is the mistake worth designing against.
    setSendAsMailboxId("");

    if (mode === "edit" && source?.message) {
      // Reopening an existing draft: load what was already saved instead of
      // starting blank, and point every save/send at that same draft id so
      // we PATCH it instead of creating a second draft.
      const msg = source.message;
      setTo(msg.recipients.filter((r) => r.type === "TO").map((r) => r.email));
      setCc(msg.recipients.filter((r) => r.type === "CC").map((r) => r.email));
      setBcc(msg.recipients.filter((r) => r.type === "BCC").map((r) => r.email));
      setSubject(msg.subject ?? "");
      setBodyHtml(msg.htmlBody ?? "");
      setBodyText(msg.textBody ?? "");
      setDraftId(source.messageId);
      return;
    }

    setTo([]);
    setCc([]);
    setBcc([]);
    const sig = sigData?.signature;
    const initial = sig ? `<p></p><p>--</p><p>${sig.replace(/\n/g, "<br/>")}</p>` : "";
    setBodyHtml(initial);
    setBodyText(sig ? `\n\n--\n${sig}` : "");
    setDraftId(null);
    if (mode === "new") setSubject("");
    // reply/forward subjects are derived server-side, so we don't edit them here
  }, [open, mode, source?.messageId]);

  const needsRecipients = mode === "new" || mode === "forward" || mode === "edit";
  const srcMsg = source?.message;

  // Debounced autosave. Skipped until there's something worth saving, and
  // skipped entirely once a send/schedule is in flight (submit.isPending)
  // so autosave can't race the real send.
  useEffect(() => {
    if (!open || submit.isPending) return;
    const hasContent = bodyText.trim().length > 0 || subject.trim().length > 0 || to.length > 0;
    if (!hasContent) return;

    const t = setTimeout(async () => {
      setSaving(true);
      try {
        if (!draftIdRef.current) {
          const result = await submit.mutateAsync({
            mode,
            sourceId: source?.messageId,
            subject: mode === "new" || mode === "edit" ? subject : undefined,
            recipients: needsRecipients ? { to, cc, bcc } : undefined,
            textBody: bodyText,
            htmlBody: bodyHtml,
            action: "draft",
            sendAsMailboxId: sendAsMailboxId || undefined,
          });
          setDraftId(result.draftId);
        } else {
          await updateDraft(draftIdRef.current, {
            subject: mode === "new" || mode === "edit" ? subject : undefined,
            recipients: needsRecipients ? { to, cc, bcc } : undefined,
            textBody: bodyText,
            htmlBody: bodyHtml,
          });
        }
        setSavedAt(new Date());
      } catch {
        // Autosave failures stay silent — they shouldn't interrupt typing.
        // The explicit Send / Save draft buttons still surface errors via
        // the `notice` banner below.
      } finally {
        setSaving(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyText, bodyHtml, subject, to, cc, bcc, open]);

  if (!open) return null;

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

  const run = (action: "send" | "draft" | "schedule", scheduledAt?: Date) => {
    setNotice(null);

    let recipients: Recipients | undefined;
    if (needsRecipients) {
      if (to.length === 0) {
        setNotice({ kind: "err", text: "Add at least one recipient." });
        return;
      }
      recipients = { to, cc, bcc };
    }

    if (action === "schedule" && !scheduledAt) {
      setNotice({ kind: "err", text: "Pick a date and time to schedule." });
      return;
    }

    // Once we have a draftId from autosave, the draft already exists with
    // (close to) this content server-side — but submit.mutate always goes
    // through the mode-specific creation path, which would create a
    // *second* draft for reply/replyAll/forward. So once autosave has run,
    // finishing the job is PATCH-then-act on the existing draft instead of
    // creating another one.
    if (draftId) {
      void (async () => {
        try {
          await updateDraft(draftId, {
            subject: mode === "new" || mode === "edit" ? subject : undefined,
            recipients,
            textBody: bodyText,
            htmlBody: bodyHtml,
          });
          const { sendDraft, scheduleDraft } = await import("@/lib/mail-api");
          if (action === "send") {
            await sendDraft(draftId);
          } else if (action === "schedule" && scheduledAt) {
            await scheduleDraft(draftId, scheduledAt.toISOString());
          }
          onClose();
        } catch (err) {
          setNotice({
            kind: "err",
            text: err instanceof Error ? err.message : "Something went wrong. Try again.",
          });
        }
      })();
      return;
    }

    submit.mutate(
      {
        mode,
        sourceId: source?.messageId,
        subject: mode === "new" || mode === "edit" ? subject : undefined,
        recipients,
        textBody: bodyText,
        htmlBody: bodyHtml,
        action,
        sendAsMailboxId: sendAsMailboxId || undefined,
        scheduledAt: action === "schedule" && scheduledAt ? scheduledAt.toISOString() : undefined,
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
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--ink3)]">
              {saving ? "Saving…" : savedAt ? `Draft saved ${savedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            <button onClick={onClose} className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]">
              <X className="h-5 w-5" />
            </button>
          </div>
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
              <div className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-xs md:text-sm font-medium text-[var(--ink3)]">To</span>
                <div className="min-w-0 flex-1">
                  <RecipientInput value={to} onChange={setTo} placeholder="Add recipients" autoFocus />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-9 shrink-0 pt-2 text-xs md:text-sm font-medium text-[var(--ink3)]">Cc</span>
                <div className="min-w-0 flex-1">
                  <RecipientInput value={cc} onChange={setCc} placeholder="Optional" />
                </div>
                {!showBcc && (
                  <button
                    onClick={() => setShowBcc(true)}
                    className="shrink-0 pt-2 text-xs font-medium text-[var(--ink3)] hover:text-[var(--ink2)]"
                  >
                    Bcc
                  </button>
                )}
              </div>
              {showBcc && (
                <div className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-xs md:text-sm font-medium text-[var(--ink3)]">Bcc</span>
                  <div className="min-w-0 flex-1">
                    <RecipientInput value={bcc} onChange={setBcc} placeholder="Optional" />
                  </div>
                </div>
              )}
            </>
          )}

          {(mode === "new" || mode === "edit") && (
            <div className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-xs md:text-sm font-medium text-[var(--ink3)]">Subj.</span>
              <input
                className={`${field} flex-1`}
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}

          <RichTextEditor
            initialHtml={bodyHtml}
            onChange={(html, text) => {
              setBodyHtml(html);
              setBodyText(text);
            }}
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
          <SendMenu
            pending={submit.isPending}
            onSendNow={() => run("send")}
            onSchedule={(date) => run("schedule", date)}
          />

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
        </div>
      </div>
    </div>
  );
}

export default ComposeModal;