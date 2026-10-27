"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Eye, FileText, Image as ImageIcon, Loader2, Mail, Paperclip, Sparkles, X } from "lucide-react";
import type { PreviewItem } from "@/components/mail/AttachmentPreview";
import { localFilePreviewItem } from "@/components/mail/AttachmentPreview";
import { loadAssistantImage, type AssistantAttachment, type AssistantEmailSummary } from "@/lib/assistant-api";

/**
 * Something attached to the next question: a file picked on this device, or
 * an email brought from Mail ("Summarize with Alet"). Being read by the
 * server, ready, or refused with the reason.
 */
export interface ComposerFile {
  key: string;
  name: string;
  size: number;
  /** The picked file; none for an email. */
  file?: File;
  /** An email from Mail: its card details and the text Alet will read. */
  email?: { summary: AssistantEmailSummary; preview: string };
  status: "uploading" | "ready" | "error";
  attachment?: AssistantAttachment;
  error?: string;
  /** One Idempotency-Key per file, kept for its retries. */
  idempotencyKey: string;
}

export const isEmailEntry = (f: ComposerFile) => f.attachment?.kind === "EMAIL" || f.key.startsWith("email:");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (name: string, type: string) => type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name);

/** An object URL for a blob or file, released when it is no longer shown. */
function useObjectUrl(source: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    const next = URL.createObjectURL(source);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);
  return url;
}

export function composerPreviewItem(f: ComposerFile): PreviewItem {
  return localFilePreviewItem(f.file ?? new File([], f.name), f.key);
}

/** A sent image, previewed from the server's copy. Documents keep only their text, so there is nothing to open. */
export function sentImagePreviewItem(a: AssistantAttachment): PreviewItem {
  return {
    key: `assistant:${a.id}`,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    load: () => loadAssistantImage(a.id),
    loadDocText: async () => {
      throw new Error("No text preview for images");
    },
    download: () => {
      void loadAssistantImage(a.id).then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = a.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    },
  };
}

function Thumb({ file }: { file?: File }) {
  const url = useObjectUrl(file && isImage(file.name, file.type) ? file : null);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
      <FileText className="h-5 w-5" aria-hidden />
    </span>
  );
}

/** The files waiting to go with the question. */
export function ComposerFileChips({
  files,
  onOpen,
  onRemove,
}: {
  files: ComposerFile[];
  onOpen: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const chips = files.filter((f) => !isEmailEntry(f));
  if (chips.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attached files" data-testid="assistant-composer-files">
      {chips.map((f) => {
        const pages = f.attachment?.pageCount ? ` · ${f.attachment.pageCount} page${f.attachment.pageCount === 1 ? "" : "s"}` : "";
        return (
          <li
            key={f.key}
            data-testid="assistant-composer-file"
            data-status={f.status}
            className={`flex max-w-[300px] items-center gap-2.5 rounded-xl border bg-[var(--surface)] py-1.5 pl-1.5 pr-1 ${
              f.status === "error" ? "border-[var(--crit)]/50" : "border-[var(--border)]"
            }`}
          >
            <button
              type="button"
              onClick={() => onOpen(f.key)}
              className="flex min-w-0 items-center gap-2.5 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label={`Preview ${f.name}`}
            >
              <Thumb file={f.file} />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-[var(--ink)]">{f.name}</span>
                <span
                  className={`flex items-center gap-1 text-[11px] ${f.status === "error" ? "text-[var(--crit)]" : "text-[var(--ink3)]"}`}
                  title={f.error}
                >
                  {f.status === "uploading" && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reading…
                    </>
                  )}
                  {f.status === "ready" && (
                    <>
                      <Check className="h-3 w-3 text-[var(--ok)]" aria-hidden /> {formatBytes(f.size)}
                      {pages}
                      {f.attachment?.truncated ? " · long, start read" : ""}
                    </>
                  )}
                  {f.status === "error" && (
                    <>
                      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="line-clamp-2">{f.error}</span>
                    </>
                  )}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(f.key)}
              aria-label={`Remove ${f.name}`}
              className="shrink-0 rounded-md p-1 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * An email brought from Mail, waiting in the composer. Nothing has gone to
 * the AI: the member reads what will be sent, then presses Analyze Email.
 */
export function EmailCard({
  entry,
  busy,
  onAnalyze,
  onPreview,
  onRemove,
}: {
  entry: ComposerFile;
  busy: boolean;
  onAnalyze: () => void;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const summary = entry.email?.summary;
  return (
    <section
      aria-label="Email to analyze"
      data-testid="assistant-email-card"
      data-status={entry.status}
      className={`mb-2 rounded-2xl border bg-[var(--surface)] p-3.5 ${entry.status === "error" ? "border-[var(--crit)]/50" : "border-[var(--accent)]/40"}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <Mail className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">Email from Mail · not sent to Alet yet</p>
          {entry.status === "uploading" && (
            <p className="mt-1 flex items-center gap-2 text-[13px] text-[var(--ink2)]" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparing the email…
            </p>
          )}
          {entry.status === "error" && (
            <p role="alert" className="mt-1 flex items-start gap-2 text-[13px] text-[var(--crit)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {entry.error}
            </p>
          )}
          {entry.status === "ready" && !summary && (
            <h3 className="mt-0.5 truncate text-[14.5px] font-semibold text-[var(--ink)]" data-testid="assistant-email-subject">{entry.name}</h3>
          )}
          {entry.status === "ready" && summary && (
            <>
              <h3 className="mt-0.5 truncate text-[14.5px] font-semibold text-[var(--ink)]" data-testid="assistant-email-subject">{summary.subject}</h3>
              <dl className="mt-1 grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5 text-[12px]">
                <dt className="text-[var(--ink3)]">From</dt>
                <dd className="truncate text-[var(--ink2)]">{summary.from}</dd>
                <dt className="text-[var(--ink3)]">To</dt>
                <dd className="truncate text-[var(--ink2)]">{[...summary.to, ...summary.cc].join(", ") || "—"}</dd>
                <dt className="text-[var(--ink3)]">Date</dt>
                <dd className="text-[var(--ink2)]">{longDate.format(new Date(summary.date))}</dd>
              </dl>
              {summary.bodyPreview && <p className="mt-1.5 line-clamp-2 text-[12.5px] text-[var(--ink3)]">{summary.bodyPreview}</p>}
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--ink3)]">
                {summary.attachmentCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Paperclip className="h-3 w-3" aria-hidden /> {summary.attachmentCount} attachment{summary.attachmentCount === 1 ? "" : "s"} included
                  </span>
                )}
                {entry.attachment?.truncated && <span>Long email: Alet reads the first part.</span>}
              </p>
            </>
          )}
        </div>
        <button type="button" onClick={onRemove} aria-label="Remove email" className="shrink-0 rounded-md p-1 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {entry.status === "ready" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAnalyze} disabled={busy} className="zoiko-btn pri px-4 py-2 text-[13px]" data-testid="analyze-email">
            <Sparkles className="h-4 w-4" aria-hidden /> Analyze Email
          </button>
          <button type="button" onClick={onPreview} className="zoiko-btn px-3 py-2 text-[13px]">
            <Eye className="h-4 w-4" aria-hidden /> Preview what Alet will read
          </button>
          <span className="text-[11.5px] text-[var(--ink3)]">Or type your own question about it below.</span>
        </div>
      )}
    </section>
  );
}

function SentImage({ attachment, onOpen }: { attachment: AssistantAttachment; onOpen: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadAssistantImage(attachment.id).then(
      (b) => alive && setBlob(b),
      () => alive && setFailed(true)
    );
    return () => {
      alive = false;
    };
  }, [attachment.id]);
  const url = useObjectUrl(blob);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${attachment.fileName}`}
      title={attachment.fileName}
      className="overflow-hidden rounded-xl border border-white/30 bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={attachment.fileName} className="h-28 w-auto max-w-[220px] object-cover" />
      ) : (
        <span className="flex h-28 w-28 items-center justify-center text-white/80">
          {failed ? <ImageIcon className="h-6 w-6" aria-hidden /> : <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
        </span>
      )}
    </button>
  );
}

/** The files a question was asked about, on its bubble. */
export function MessageFiles({ attachments, onOpenImage }: { attachments: AssistantAttachment[]; onOpenImage: (a: AssistantAttachment) => void }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => a.kind === "IMAGE");
  const documents = attachments.filter((a) => a.kind === "DOCUMENT");
  const emails = attachments.filter((a) => a.kind === "EMAIL");
  return (
    <div className="mb-2 flex flex-col items-end gap-2" data-testid="assistant-message-files">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((a) => (
            <SentImage key={a.id} attachment={a} onOpen={() => onOpenImage(a)} />
          ))}
        </div>
      )}
      {emails.map((a) => (
        <span key={a.id} className="inline-flex max-w-full items-center gap-2 rounded-xl bg-white/15 px-3 py-1.5 text-[12.5px]" title="An email from Mail">
          <Mail className="h-4 w-4 shrink-0" aria-hidden />
          <span className="shrink-0 text-white/75">Email:</span>
          <span className="truncate font-medium">{a.fileName}</span>
        </span>
      ))}
      {documents.map((a) => (
        <span
          key={a.id}
          className="inline-flex max-w-full items-center gap-2 rounded-xl bg-white/15 px-3 py-1.5 text-[12.5px]"
          title={a.truncated ? "A long document: Alet read the start of it." : `Read by Alet`}
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate font-medium">{a.fileName}</span>
          <span className="shrink-0 text-white/75">
            {a.pageCount ? `${a.pageCount} page${a.pageCount === 1 ? "" : "s"} · ` : ""}
            {formatBytes(a.sizeBytes)}
          </span>
        </span>
      ))}
    </div>
  );
}
