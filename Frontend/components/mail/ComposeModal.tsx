"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Save, AlertCircle, CheckCircle2, Paperclip, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useComposerSubmit, type ComposerMode, useSignature, useSendableMailboxes } from "@/lib/mail-hooks";
import { useMe } from "@/lib/auth-hooks";
import { ApiError } from "@/lib/api-client";
import {
  deleteAttachment,
  getMessage,
  scheduleDraft,
  sendDraft,
  updateDraft,
  uploadAttachment,
} from "@/lib/mail-api";
import type { MailAttachment, MailItem } from "@/lib/mail-api";
import { forwardSubject, quotedOriginal, replyRecipients, replySubject } from "@/lib/mail-reply";
import { fileKind, formatBytes } from "@/lib/file-kind";
import { RecipientInput } from "@/components/mail/RecipientInput";
import { RichTextEditor } from "@/components/mail/RichTextEditor";
import { SendMenu } from "@/components/mail/SendMenu";
import { FileTypeBadge } from "@/components/mail/AttachmentPreview";

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
  defaultSendAsMailboxId,
}: {
  open: boolean;
  mode: ComposerMode;
  source: MailItem | null;
  onClose: () => void;
  /** Reply from a shared inbox as that inbox, rather than as oneself. */
  defaultSendAsMailboxId?: string | null;
}) {
  const submit = useComposerSubmit();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The From options. A workspace with no shared mailboxes gets exactly one
  // entry, and the picker stays hidden — nobody should have to choose between
  // one thing.
  const { data: sendable, isFetched: sendableFetched } = useSendableMailboxes();
  const { data: me } = useMe();
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
  const [showQuote, setShowQuote] = useState(false);
  // Files picked but not yet on the draft, and attachments the draft has.
  const [files, setFiles] = useState<File[]>([]);
  const [attached, setAttached] = useState<MailAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "gate" | "ok" | "err"; text: string } | null>(null);
  const { data: sigData } = useSignature();

  // Autosave. draftId is null until the first save actually creates a
  // draft row — before that there's nothing to PATCH, so the first save
  // goes through the mode-specific creation (createDraft / reply / replyAll /
  // forward); every save after that is a plain updateDraft against that id.
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const draftIdRef = useRef<string | null>(null);
  draftIdRef.current = draftId;
  // The one in-flight creation, shared by autosave and Send so the two can
  // never create a draft each.
  const creatingRef = useRef<Promise<string> | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const filesRef = useRef<File[]>([]);
  filesRef.current = files;
  const uploadedRef = useRef(new WeakSet<File>());
  const syncingRef = useRef<Promise<void>>(Promise.resolve());
  // What the body was when the composer opened (the signature), so a reply
  // isn't autosaved before anything has been written.
  const initialTextRef = useRef("");
  const prefilledRef = useRef<string | null>(null);

  const isReply = mode === "reply" || mode === "replyAll";
  const srcMsg = source?.message;
  // The original, carried below what is typed. A draft being edited already
  // has it in its body.
  const quote = useMemo(
    () => (srcMsg && (isReply || mode === "forward") ? quotedOriginal(srcMsg, isReply ? "reply" : "forward") : null),
    [srcMsg, isReply, mode]
  );
  const fullText = bodyText + (quote?.textSuffix ?? "");
  const fullHtml = bodyHtml + (quote?.htmlSuffix ?? "");

  // Reset the form whenever the composer opens for a new context.
  useEffect(() => {
    if (!open) {
      prefilledRef.current = null;
      return;
    }
    setShowBcc(false);
    setFiles([]);
    setAttached([]);
    setNotice(null);
    setSavedAt(null);
    setShowQuote(false);
    creatingRef.current = null;
    uploadedRef.current = new WeakSet();
    // Defaults to one's own address every time the composer opens, rather than
    // remembering the last shared mailbox used: sending as the team by
    // accident is the mistake worth designing against.
    // A reply to a shared inbox's message goes out as that inbox — the
    // message was read from it, and the server reads the source there.
    setSendAsMailboxId(defaultSendAsMailboxId ?? "");

    if (mode === "edit" && source?.message) {
      // Reopening an existing draft: load what was already saved instead of
      // starting blank, and point every save/send at that same draft id so
      // we PATCH it instead of creating a second draft.
      const msg = source.message;
      setTo(msg.recipients.filter((r) => r.type === "TO").map((r) => r.email));
      setCc(msg.recipients.filter((r) => r.type === "CC").map((r) => r.email));
      const savedBcc = msg.recipients.filter((r) => r.type === "BCC").map((r) => r.email);
      setBcc(savedBcc);
      setShowBcc(savedBcc.length > 0);
      setSubject(msg.subject ?? "");
      setBodyHtml(msg.htmlBody ?? "");
      setBodyText(msg.textBody ?? "");
      initialTextRef.current = msg.textBody ?? "";
      setAttached(msg.attachments ?? []);
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
    initialTextRef.current = sig ? `\n\n--\n${sig}` : "";
    setDraftId(null);
    if (mode === "new") setSubject("");
    else if (mode === "forward") setSubject(forwardSubject(source?.message?.subject));
    else setSubject(replySubject(source?.message?.subject));
  }, [open, mode, source?.messageId]);

  // Fill a reply's To and Cc the way the server addresses it, once we know
  // which addresses are ours. They stay editable, as in any mail client.
  useEffect(() => {
    if (!open || !isReply || !srcMsg || !source) return;
    const key = `${mode}:${source.messageId}`;
    if (prefilledRef.current === key || !sendableFetched) return;
    prefilledRef.current = key;
    const own = [me?.email, ...(sendable?.mailboxes ?? []).map((mailbox) => mailbox.address)];
    const prefilled = replyRecipients(srcMsg, own, mode === "replyAll");
    setTo(prefilled.to);
    setCc(prefilled.cc);
  }, [open, isReply, mode, source, srcMsg, sendableFetched, sendable, me?.email]);

  /** The draft's id, creating the draft first if there isn't one yet. */
  const ensureDraft = async (): Promise<string> => {
    if (draftIdRef.current) return draftIdRef.current;
    if (!creatingRef.current) {
      creatingRef.current = submit
        .mutateAsync({
          mode,
          sourceId: source?.messageId,
          subject: mode === "new" || mode === "edit" ? subject : undefined,
          recipients: mode === "new" || mode === "forward" ? { to, cc, bcc } : undefined,
          textBody: fullText,
          htmlBody: fullHtml,
          action: "draft",
          sendAsMailboxId: sendAsMailboxId || undefined,
          includesQuote: quote ? true : undefined,
        })
        .then((result) => {
          draftIdRef.current = result.draftId;
          setDraftId(result.draftId);
          return result.draftId;
        })
        .catch((err) => {
          creatingRef.current = null;
          throw err;
        });
    }
    return creatingRef.current;
  };

  /** Puts every picked file on the draft. Each file is uploaded once. */
  const syncAttachments = (id: string): Promise<void> => {
    const next = syncingRef.current.catch(() => undefined).then(async () => {
      const pending = filesRef.current.filter((file) => !uploadedRef.current.has(file));
      if (pending.length === 0) return;
      setUploading(true);
      try {
        for (const file of pending) {
          const attachment = await uploadAttachment(id, file);
          uploadedRef.current.add(file);
          setFiles((prev) => prev.filter((f) => f !== file));
          setAttached((prev) => [...prev, attachment]);
        }
      } finally {
        setUploading(false);
      }
    });
    syncingRef.current = next;
    return next;
  };

  const saveBody = (id: string) =>
    updateDraft(id, {
      subject,
      // A draft must keep at least one To; while it has none, the saved
      // recipients are left as they are.
      recipients: to.length > 0 ? { to, cc, bcc } : undefined,
      textBody: fullText,
      htmlBody: fullHtml,
    });

  // Debounced autosave. Skipped until there's something worth saving, and
  // skipped entirely while a send/schedule is in flight so autosave can't
  // race the real send.
  useEffect(() => {
    if (!open || busy) return;
    const typed = bodyText.trim() !== initialTextRef.current.trim();
    const hasContent = isReply
      ? typed || files.length > 0
      : typed || subject.trim().length > 0 || to.length > 0 || files.length > 0;
    if (!hasContent) return;

    const t = setTimeout(async () => {
      if (busyRef.current) return;
      setSaving(true);
      try {
        const existing = draftIdRef.current;
        const id = await ensureDraft();
        // A draft created just now already holds this content (apart from
        // edited reply recipients, which the update below carries).
        if (existing || isReply) await saveBody(id);
        await syncAttachments(id);
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
  }, [bodyText, bodyHtml, subject, to, cc, bcc, files, open]);

  if (!open) return null;

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming);
    // Deduplicate by name+size, against both pending and attached files.
    const existing = new Set([
      ...files.map((f) => `${f.name}:${f.size}`),
      ...attached.map((a) => `${a.fileName}:${a.sizeBytes}`),
    ]);
    const fresh = arr.filter((f) => !existing.has(`${f.name}:${f.size}`));
    setFiles((prev) => [...prev, ...fresh]);
  };

  const removeFile = (file: File) => {
    setFiles((prev) => prev.filter((f) => f !== file));
  };

  const removeAttached = async (attachment: MailAttachment) => {
    if (!draftId) return;
    try {
      await deleteAttachment(draftId, attachment.id);
      setAttached((prev) => prev.filter((a) => a.id !== attachment.id));
    } catch (err) {
      setNotice({ kind: "err", text: err instanceof Error ? err.message : "Couldn't remove the attachment." });
    }
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0) + attached.reduce((sum, a) => sum + a.sizeBytes, 0);
  const attachmentCount = files.length + attached.length;

  const run = async (action: "send" | "draft" | "schedule", scheduledAt?: Date) => {
    setNotice(null);

    if (to.length === 0) {
      setNotice({ kind: "err", text: "Add at least one recipient." });
      return;
    }
    if (action === "schedule" && !scheduledAt) {
      setNotice({ kind: "err", text: "Pick a date and time to schedule." });
      return;
    }

    // One path for every mode: make sure the draft exists (reusing the one
    // autosave made), write the current content to it, put the attachments
    // on it, then act on it. Creating-and-sending in one go would skip the
    // attachments and any edits to a reply's recipients.
    setBusy(true);
    try {
      const id = await ensureDraft();
      await saveBody(id);
      await syncAttachments(id);
      if (action === "send") {
        try {
          await sendDraft(id);
        } catch (err) {
          // A blocked send keeps the message as a draft rather than losing it.
          if (err instanceof ApiError && (err.status === 403 || err.status === 429)) {
            setNotice({
              kind: "gate",
              text:
                err.status === 429
                  ? "Your mailbox can't send right now (suspended or warming up). Saved as a draft."
                  : err.message || "Sending isn't enabled for your mailbox yet. Saved as a draft.",
            });
            return; // keep the composer open so they can see what happened
          }
          throw err;
        }
      } else if (action === "schedule" && scheduledAt) {
        await scheduleDraft(id, scheduledAt.toISOString());
      }
      void qc.invalidateQueries({ queryKey: ["mail"] });
      onClose();
    } catch (err) {
      setNotice({
        kind: "err",
        text: err instanceof Error ? err.message : "Something went wrong. Try again.",
      });
      // The draft may have been created before the failure; reload its
      // attachment list so what is shown is what it has.
      const id = draftIdRef.current;
      if (id) {
        getMessage(id)
          .then((item) => setAttached(item.message.attachments ?? []))
          .catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-label={MODE_TITLE[mode]}
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-[var(--surface)] shadow-[var(--sh3)] sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 className="font-editorial text-lg text-[var(--ink)]">{MODE_TITLE[mode]}</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--ink3)]">
              {saving ? "Saving…" : savedAt ? `Draft saved ${savedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}
            </span>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {options.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-[var(--ink3)]">
              <span className="w-9 shrink-0">From</span>
              <select
                className={field}
                value={sendAsMailboxId}
                onChange={(e) => setSendAsMailboxId(e.target.value)}
                // The From of a draft is fixed when it is created.
                disabled={Boolean(draftId)}
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

          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-xs md:text-sm font-medium text-[var(--ink3)]">To</span>
            <div className="min-w-0 flex-1" data-testid="compose-to">
              <RecipientInput value={to} onChange={setTo} placeholder="Add recipients" autoFocus={!isReply} />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-9 shrink-0 pt-2 text-xs md:text-sm font-medium text-[var(--ink3)]">Cc</span>
            <div className="min-w-0 flex-1" data-testid="compose-cc">
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

          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-xs md:text-sm font-medium text-[var(--ink3)]">Subj.</span>
            <input
              className={`${field} flex-1`}
              placeholder="Subject"
              aria-label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <RichTextEditor
            initialHtml={bodyHtml}
            onChange={(html, text) => {
              setBodyHtml(html);
              setBodyText(text);
            }}
          />

          {/* The original, sent below the reply; collapsed like a mail client's "…" */}
          {quote && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)]" data-testid="compose-quote">
              <button
                type="button"
                onClick={() => setShowQuote((value) => !value)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-[var(--ink3)] hover:text-[var(--ink2)]"
              >
                {showQuote ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span className="truncate">{quote.heading}</span>
              </button>
              {showQuote && (
                <div className="max-h-60 overflow-y-auto border-t border-[var(--border)] px-3 py-2">
                  <div className="whitespace-pre-wrap break-words border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--ink2)]">
                    {quote.text || "(no text)"}
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "forward" && (srcMsg?.attachments?.length ?? 0) > 0 && (
            <p className="text-xs text-[var(--ink3)]">
              The original&apos;s attachments aren&apos;t included in a forward. Download
              them and attach them here to send them on.
            </p>
          )}

          {/* Attached files list */}
          {attachmentCount > 0 && (
            <div className="space-y-1.5" data-testid="compose-attachments">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                {attachmentCount} file{attachmentCount > 1 ? "s" : ""} · {formatBytes(totalSize)}
                {uploading ? " · uploading…" : ""}
              </div>
              {attached.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-1.5"
                >
                  <FileTypeBadge kind={fileKind(attachment.fileName, attachment.contentType)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{attachment.fileName}</span>
                  <span className="shrink-0 text-[11px] text-[var(--ink3)]">{formatBytes(attachment.sizeBytes)}</span>
                  <button
                    onClick={() => void removeAttached(attachment)}
                    className="shrink-0 rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--crit)]"
                    title="Remove"
                    aria-label={`Remove ${attachment.fileName}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${file.size}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--s2)] px-3 py-1.5"
                >
                  <FileTypeBadge kind={fileKind(file.name, file.type)} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{file.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--ink3)]">
                    {uploading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} {formatBytes(file.size)}
                  </span>
                  <button
                    onClick={() => removeFile(file)}
                    className="shrink-0 rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--crit)]"
                    title="Remove"
                    aria-label={`Remove ${file.name}`}
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
            pending={busy}
            onSendNow={() => void run("send")}
            onSchedule={(date) => void run("schedule", date)}
          />

          <button onClick={() => void run("draft")} disabled={busy} className="zoiko-btn disabled:opacity-50">
            <Save className="h-4 w-4" /> Save draft
          </button>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="compose-file-input"
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
