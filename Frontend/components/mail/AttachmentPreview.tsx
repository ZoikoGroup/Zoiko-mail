"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Eye,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  FileArchive,
  Presentation,
  File as FileIcon,
} from "lucide-react";
import { getAccessToken } from "@/lib/auth-storage";
import type { MailAttachment } from "@/lib/mail-api";
import { attachmentUrl, downloadAttachment } from "@/lib/mail-api";
import { fileKind, formatBytes, type FileCategory, type FileKind } from "@/lib/file-kind";

// ── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<FileCategory, typeof FileIcon> = {
  image: ImageIcon,
  pdf: FileText,
  video: Film,
  audio: Music,
  text: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  other: FileIcon,
};

const CATEGORY_TONE: Record<FileCategory, string> = {
  pdf: "bg-red-500/15 text-red-600 dark:text-red-400",
  document: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  spreadsheet: "bg-green-500/15 text-green-700 dark:text-green-400",
  presentation: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  image: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  video: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  audio: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  archive: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  text: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  other: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

/** The type of a file at a glance: an icon and its short label (PDF, DOCX…). */
export function FileTypeBadge({ kind }: { kind: FileKind }) {
  const Icon = CATEGORY_ICON[kind.category];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${CATEGORY_TONE[kind.category]}`}
      data-testid="file-type-badge"
    >
      <Icon className="h-3 w-3" />
      {kind.label}
    </span>
  );
}

/** The MIME type to render a preview with. Mail often labels files
 * application/octet-stream, which a browser won't show inline. */
function renderType(kind: FileKind, contentType: string): string {
  const declared = contentType.toLowerCase().split(";")[0].trim();
  if (kind.category === "pdf") return "application/pdf";
  if (kind.category === "text") return "text/plain";
  if (["image", "video", "audio"].includes(kind.category) && declared.startsWith(`${kind.category}/`)) return declared;
  if (kind.category === "image") return `image/${kind.label === "JPG" ? "jpeg" : kind.label.toLowerCase()}`;
  if (kind.category === "video") return `video/${kind.label === "MOV" ? "quicktime" : kind.label.toLowerCase()}`;
  if (kind.category === "audio") return `audio/${kind.label === "MP3" ? "mpeg" : kind.label.toLowerCase()}`;
  return "application/octet-stream";
}

/** Text previews stop here; the rest is a download away. */
const TEXT_PREVIEW_LIMIT = 200_000;

// ── Blob hook ────────────────────────────────────────────────────────────────

function useAttachmentBlob(messageId: string, attachment: MailAttachment, eager: boolean, mailboxId?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!eager) return;
    let revoke = "";
    let cancelled = false;
    const kind = fileKind(attachment.fileName, attachment.contentType);
    setLoading(true);
    setFailed(false);
    setUrl(null);
    setText(null);
    const token = getAccessToken();
    fetch(attachmentUrl(messageId, attachment.id, mailboxId), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error("Download failed");
        return res.blob();
      })
      .then(async (blob) => {
        if (cancelled) return;
        if (kind.category === "text") {
          // Shown as text in the page, never handed to the browser to render.
          setText(await blob.slice(0, TEXT_PREVIEW_LIMIT).text());
          return;
        }
        const typed = new Blob([blob], { type: renderType(kind, attachment.contentType) });
        const objectUrl = URL.createObjectURL(typed);
        revoke = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [messageId, attachment.id, attachment.fileName, attachment.contentType, eager, mailboxId]);

  return { url, text, loading, failed };
}

/** A CSV as a table: simple quoted-field parsing, enough to read a file. */
function parseCsv(source: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length && rows.length < maxRows; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if ((cell || row.length) && rows.length < maxRows) rows.push([...row, cell]);
  return rows;
}

function TextPreview({ attachment, text }: { attachment: MailAttachment; text: string }) {
  const truncated = attachment.sizeBytes > TEXT_PREVIEW_LIMIT;
  const isCsv = fileKind(attachment.fileName, attachment.contentType).label === "CSV";
  const rows = isCsv ? parseCsv(text) : null;
  return (
    <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white text-slate-900" data-testid="text-preview">
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {rows ? (
          <table className="border-collapse text-xs">
            <tbody>
              {rows.map((cells, r) => (
                <tr key={r} className={r === 0 ? "bg-slate-100 font-semibold" : ""}>
                  {cells.map((value, c) => (
                    <td key={c} className="whitespace-nowrap border border-slate-200 px-2 py-1">
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs">{text}</pre>
        )}
      </div>
      {(truncated || (rows && rows.length >= 200)) && (
        <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          Showing the beginning of the file. Download it to see all of it.
        </div>
      )}
    </div>
  );
}

// ── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({
  messageId,
  attachments,
  startIndex,
  onClose,
  mailboxId,
}: {
  messageId: string;
  attachments: MailAttachment[];
  startIndex: number;
  onClose: () => void;
  mailboxId?: string | null;
}) {
  const [index, setIndex] = useState(startIndex);
  const att = attachments[index];
  const kind = fileKind(att.fileName, att.contentType);
  const { url, text, loading, failed } = useAttachmentBlob(messageId, att, true, mailboxId);

  const prev = () => setIndex((i) => (i > 0 ? i - 1 : attachments.length - 1));
  const next = () => setIndex((i) => (i < attachments.length - 1 ? i + 1 : 0));

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleKey]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" role="dialog" aria-label={`Preview of ${att.fileName}`}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileTypeBadge kind={kind} />
            <div className="truncate text-sm font-medium text-white">{att.fileName}</div>
          </div>
          <div className="text-xs text-white/60">
            {formatBytes(att.sizeBytes)} · {index + 1} of {attachments.length}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadAttachment(messageId, att, mailboxId)}
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
            title="Download"
            aria-label={`Download ${att.fileName}`}
          >
            <Download className="h-5 w-5" />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
            title="Close (Esc)"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12">
        {/* Nav arrows */}
        {attachments.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous attachment"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={next}
              aria-label="Next attachment"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {/* Preview content */}
        {loading ? (
          <Loader2 className="h-10 w-10 animate-spin text-white/50" />
        ) : failed ? (
          <div className="text-center text-sm text-white/60">
            <FileIcon className="mx-auto mb-2 h-10 w-10" />
            Couldn&apos;t load this attachment. Try downloading it.
          </div>
        ) : text !== null ? (
          <TextPreview attachment={att} text={text} />
        ) : !url ? null : kind.category === "image" ? (
          <img src={url} alt={att.fileName} className="max-h-[80vh] max-w-full rounded-lg object-contain" />
        ) : kind.category === "pdf" ? (
          <iframe src={url} title={att.fileName} className="h-[80vh] w-full max-w-4xl rounded-lg bg-white" />
        ) : kind.category === "video" ? (
          <video src={url} controls className="max-h-[80vh] max-w-full rounded-lg" />
        ) : kind.category === "audio" ? (
          <audio src={url} controls className="w-full max-w-md" />
        ) : null}
      </div>
    </div>
  );
}

// ── Thumbnail ────────────────────────────────────────────────────────────────

function ImageThumbnail({
  messageId,
  attachment,
  onClick,
  mailboxId,
}: {
  messageId: string;
  attachment: MailAttachment;
  onClick: () => void;
  mailboxId?: string | null;
}) {
  const { url, loading } = useAttachmentBlob(messageId, attachment, true, mailboxId);

  return (
    <div className="flex w-28 shrink-0 flex-col gap-1">
      <button
        onClick={onClick}
        className="group relative h-20 w-28 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--s2)] transition hover:border-[var(--accent)]"
        title={`Preview ${attachment.fileName}`}
        aria-label={`Preview ${attachment.fileName}`}
      >
        {loading ? (
          <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-[var(--ink3)]" />
        ) : url ? (
          <img src={url} alt={attachment.fileName} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="absolute inset-0 m-auto h-6 w-6 text-[var(--ink3)]" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
          <Eye className="h-5 w-5 text-white opacity-0 transition group-hover:opacity-100" />
        </div>
      </button>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ink2)]" title={attachment.fileName}>
          {attachment.fileName}
        </span>
        <button
          onClick={() => downloadAttachment(messageId, attachment, mailboxId)}
          className="shrink-0 rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
          title="Download"
          aria-label={`Download ${attachment.fileName}`}
        >
          <Download className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── File tile ────────────────────────────────────────────────────────────────

/** The coloured square that says what a file is before its name is read. */
const TILE: Record<FileCategory, { bg: string; text: (kind: FileKind) => string }> = {
  pdf: { bg: "#E5484D", text: () => "PDF" },
  document: { bg: "#2F6FED", text: () => "W" },
  spreadsheet: { bg: "#1F9D60", text: () => "X" },
  presentation: { bg: "#E8663D", text: () => "P" },
  image: { bg: "#8B5CF6", text: () => "IMG" },
  video: { bg: "#D9468F", text: () => "VID" },
  audio: { bg: "#D9468F", text: () => "AUD" },
  archive: { bg: "#B7791F", text: () => "ZIP" },
  text: { bg: "#64748B", text: (kind) => kind.label.slice(0, 3) },
  other: { bg: "#64748B", text: (kind) => kind.label.slice(0, 3) },
};

function FileTile({ kind }: { kind: FileKind }) {
  const tile = TILE[kind.category];
  const text = tile.text(kind);
  return (
    <span
      aria-hidden
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md font-bold text-white ${text.length > 2 ? "text-[10px]" : "text-sm"}`}
      style={{ backgroundColor: tile.bg }}
    >
      {text}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AttachmentList({
  messageId,
  attachments,
  mailboxId,
}: {
  messageId: string;
  attachments: MailAttachment[];
  /** The shared inbox the message is in; omitted for one's own mailbox. */
  mailboxId?: string | null;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  if (attachments.length === 0) return null;

  const kinds = new Map(attachments.map((a) => [a.id, fileKind(a.fileName, a.contentType)]));
  const kindOf = (a: MailAttachment) => kinds.get(a.id)!;

  // Images as thumbnails; everything else as a card.
  const images = attachments.filter((a) => kindOf(a).category === "image");
  const files = attachments.filter((a) => kindOf(a).category !== "image");

  // For lightbox navigation, only include previewable attachments
  const lightboxItems = attachments.filter((a) => kindOf(a).previewable);
  const totalSize = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  const openLightbox = (att: MailAttachment) => {
    const idx = lightboxItems.findIndex((a) => a.id === att.id);
    if (idx >= 0) setLightboxIndex(idx);
  };

  // One after another: browsers block a burst of simultaneous downloads.
  const downloadAll = async () => {
    setDownloadingAll(true);
    try {
      for (const att of attachments) {
        await downloadAttachment(messageId, att, mailboxId);
      }
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div className="mt-6 border-t border-[var(--border)] pt-4" data-testid="attachment-list">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--ink2)]">
          {attachments.length} attachment{attachments.length > 1 ? "s" : ""} · {formatBytes(totalSize)}
        </span>
        {attachments.length > 1 && (
          <button
            type="button"
            onClick={() => void downloadAll()}
            disabled={downloadingAll}
            className="text-[12px] font-medium text-[var(--accent)] hover:underline disabled:opacity-60"
          >
            {downloadingAll ? "Downloading…" : "Download all"}
          </button>
        )}
      </div>

      {/* Image thumbnails grid */}
      {images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {images.map((att) => (
            <ImageThumbnail
              key={att.id}
              messageId={messageId}
              attachment={att}
              mailboxId={mailboxId}
              onClick={() => openLightbox(att)}
            />
          ))}
        </div>
      )}

      {/* Documents, media and other files */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {files.map((att) => {
          const kind = kindOf(att);
          return (
            <div
              key={att.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--s2)] p-3 transition hover:border-[var(--accent)]"
              data-testid="attachment-card"
            >
              <FileTile kind={kind} />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => (kind.previewable ? openLightbox(att) : downloadAttachment(messageId, att, mailboxId))}
                title={kind.previewable ? `Preview ${att.fileName}` : `Download ${att.fileName}`}
              >
                <div className="truncate text-[13px] font-medium text-[var(--ink)]">{att.fileName}</div>
                <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--ink3)]">
                  <FileTypeBadge kind={kind} />
                  <span>{formatBytes(att.sizeBytes)}</span>
                  {/* Said to screen readers; sighted users see the missing eye. */}
                  {!kind.previewable && <span className="sr-only">· No preview, download to open</span>}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                {kind.previewable && (
                  <button
                    onClick={() => openLightbox(att)}
                    className="rounded p-1 text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--accent)]"
                    title="Preview"
                    aria-label={`Preview ${att.fileName}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => downloadAttachment(messageId, att, mailboxId)}
                  className="rounded p-1 text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--ink)]"
                  title="Download"
                  aria-label={`Download ${att.fileName}`}
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lightbox overlay */}
      {lightboxIndex !== null && (
        <Lightbox
          messageId={messageId}
          attachments={lightboxItems}
          startIndex={lightboxIndex}
          mailboxId={mailboxId}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

export default AttachmentList;
