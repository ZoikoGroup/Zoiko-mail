"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  FileSpreadsheet,
  FileArchive,
  Presentation,
  File as FileIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { getAccessToken } from "@/lib/auth-storage";
import type { MailAttachment } from "@/lib/mail-api";
import { attachmentUrl, downloadAttachment } from "@/lib/mail-api";
import { API_BASE } from "@/lib/config";
import { ApiError, newIdempotencyKey } from "@/lib/api-client";
import { fileKind, formatBytes, type FileCategory, type FileKind, type PreviewMode } from "@/lib/file-kind";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Spinner } from "@/components/ui/Spinner";

/*
 * Attachment previews, the same for mail being written and mail received.
 *
 * Every attachment is a tile showing the file itself — the image, the PDF's
 * first page, the Word document's first page, the opening lines of a text
 * file — and opens a full-window viewer with zoom, fit and scrolling.
 *
 * How each format is drawn:
 *   image, video, audio, PDF  the browser, from an object URL (PDF in its own
 *                             viewer, which has zoom, fit and page controls)
 *   text, CSV                 read as text, never handed to the browser
 *   .docx                     drawn into the page by docx-preview
 *   .doc                      its text, read by the server (word-extractor):
 *                             no browser library renders the binary format
 *   anything else             its details and a download
 */

// ── Badges ──────────────────────────────────────────────────────────────────

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

// ── Preview items ────────────────────────────────────────────────────────────

/** Anything the tiles and viewer can show: a stored attachment, or a file in the composer. */
export interface PreviewItem {
  key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  load: () => Promise<Blob>;
  /** A .doc's text, read by the server. */
  loadDocText: () => Promise<{ text: string; truncated: boolean }>;
  download: () => void;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new ApiError(res.status, body?.error?.message || fallback, body?.error?.code);
}

/** A stored attachment, on a received message or on one's own draft. */
export function attachmentPreviewItem(messageId: string, attachment: MailAttachment, mailboxId?: string | null): PreviewItem {
  const auth = (): Record<string, string> => {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  return {
    key: `att:${attachment.id}`,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    load: async () => {
      const res = await fetch(attachmentUrl(messageId, attachment.id, mailboxId), { headers: auth() });
      if (!res.ok) return readError(res, "Couldn't load this attachment");
      return res.blob();
    },
    loadDocText: async () => {
      const url = `${API_BASE}/mail/${messageId}/attachments/${attachment.id}/preview${mailboxId ? `?mailboxId=${mailboxId}` : ""}`;
      const res = await fetch(url, { headers: auth() });
      if (!res.ok) return readError(res, "Couldn't preview this document");
      return (await res.json()).data;
    },
    download: () => void downloadAttachment(messageId, attachment, mailboxId),
  };
}

/** A file picked in the composer, previewed from the browser's own copy before it uploads. */
export function localFilePreviewItem(file: File, key: string): PreviewItem {
  return {
    key: `local:${key}`,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    load: async () => file,
    loadDocText: async () => {
      // Read by the server and answered; nothing is stored.
      const token = getAccessToken();
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch(`${API_BASE}/mail/attachments/preview`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Idempotency-Key": newIdempotencyKey() },
        body: form,
      });
      if (!res.ok) return readError(res, "Couldn't preview this document");
      return (await res.json()).data;
    },
    download: () => {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}

// ── Loading, once per file ───────────────────────────────────────────────────

/**
 * Bytes and server text, fetched once per file and shared by its tile and the
 * viewer, so opening a preview does not download the file again. Kept for the
 * most recent files only.
 */
const CACHE_LIMIT = 40;
const blobCache = new Map<string, Promise<Blob>>();
const docTextCache = new Map<string, Promise<{ text: string; truncated: boolean }>>();

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let entry = cache.get(key);
  if (!entry) {
    entry = load();
    cache.set(key, entry);
    // A failure is not remembered, so Retry really retries.
    entry.catch(() => cache.delete(key));
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  return entry;
}

/** The MIME type to draw a blob with. Mail often labels files octet-stream, which a browser won't show. */
function renderType(kind: FileKind, contentType: string): string {
  const declared = contentType.toLowerCase().split(";")[0].trim();
  if (kind.category === "pdf") return "application/pdf";
  if (["image", "video", "audio"].includes(kind.category) && declared.startsWith(`${kind.category}/`)) return declared;
  if (kind.category === "image") return `image/${kind.label === "JPG" ? "jpeg" : kind.label.toLowerCase()}`;
  if (kind.category === "video") return `video/${kind.label === "MOV" ? "quicktime" : kind.label.toLowerCase()}`;
  if (kind.category === "audio") return `audio/${kind.label === "MP3" ? "mpeg" : kind.label.toLowerCase()}`;
  return "application/octet-stream";
}

/** Text previews stop here; the rest is a download away. */
const TEXT_PREVIEW_LIMIT = 200_000;

interface PreviewData {
  status: "loading" | "ready" | "error";
  error?: string;
  url?: string;
  blob?: Blob;
  text?: string;
  truncated?: boolean;
}

/** Loads what an item's preview mode needs. `active` false loads nothing. */
function usePreviewData(item: PreviewItem | null, mode: PreviewMode | null, active = true) {
  const [data, setData] = useState<PreviewData>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const load = item?.load;
  const loadDocText = item?.loadDocText;

  useEffect(() => {
    if (!item || !mode || !active || !load || !loadDocText) return;
    let cancelled = false;
    let revoke = "";
    setData({ status: "loading" });
    const kind = fileKind(item.fileName, item.contentType);
    const run = async (): Promise<PreviewData> => {
      if (mode === "doc") {
        const result = await cached(docTextCache, item.key, loadDocText);
        return { status: "ready", text: result.text, truncated: result.truncated };
      }
      const blob = await cached(blobCache, item.key, load);
      if (mode === "text") {
        return { status: "ready", text: await blob.slice(0, TEXT_PREVIEW_LIMIT).text(), truncated: blob.size > TEXT_PREVIEW_LIMIT };
      }
      if (mode === "docx") return { status: "ready", blob };
      const url = URL.createObjectURL(new Blob([blob], { type: renderType(kind, item.contentType) }));
      revoke = url;
      return { status: "ready", url };
    };
    run()
      .then((result) => {
        if (cancelled) {
          if (revoke) URL.revokeObjectURL(revoke);
          return;
        }
        setData(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setData({ status: "error", error: error instanceof Error ? error.message : "Couldn't load this file" });
      });
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // The key identifies the file; load functions are recreated with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key, mode, active, attempt]);

  const retry = useCallback(() => {
    if (item) {
      blobCache.delete(item.key);
      docTextCache.delete(item.key);
    }
    setAttempt((n) => n + 1);
  }, [item]);

  return { ...data, retry };
}

// ── Renderers ────────────────────────────────────────────────────────────────

/** A CSV as rows: quoted fields handled, enough to read a file. */
function parseCsv(source: string, maxRows = 500): string[][] {
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

/** Text or CSV on a white page; `scale` sizes the type. */
function TextPage({ text, csv, scale = 1, truncated, compact = false }: { text: string; csv: boolean; scale?: number; truncated?: boolean; compact?: boolean }) {
  const rows = csv ? parseCsv(text, compact ? 12 : 500) : null;
  return (
    <div
      className={`${compact ? "h-full overflow-hidden p-2" : "mx-auto min-h-full w-full max-w-[980px] rounded-md p-8 shadow-xl"} bg-white text-slate-900`}
      style={{ fontSize: `${(compact ? 7 : 13) * scale}px` }}
      data-testid={compact ? undefined : "text-preview"}
    >
      {rows ? (
        <table className="border-collapse">
          <tbody>
            {rows.map((cells, r) => (
              <tr key={r} className={r === 0 ? "bg-slate-100 font-semibold" : ""}>
                {cells.map((value, c) => (
                  <td key={c} className="whitespace-nowrap border border-slate-200 px-[0.6em] py-[0.25em]">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-sans leading-relaxed">{compact ? text.slice(0, 900) : text}</pre>
      )}
      {!compact && (truncated || (rows && rows.length >= 500)) && (
        <p className="mt-6 border-t border-slate-200 pt-3 text-[12px] text-slate-500">
          Showing the beginning of the file. Download it to see all of it.
        </p>
      )}
    </div>
  );
}

/**
 * A .docx drawn into the page by docx-preview: real pages, fonts, tables and
 * images. `zoom` scales it; `onPageWidth` reports the page width for "fit".
 */
function DocxPages({
  blob,
  zoom = 1,
  thumbnail = false,
  onPageWidth,
  onFailed,
}: {
  blob: Blob;
  zoom?: number;
  thumbnail?: boolean;
  onPageWidth?: (width: number) => void;
  onFailed?: (message: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const styles = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRendered(false);
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !body.current || !styles.current) return;
        body.current.innerHTML = "";
        await renderAsync(blob, body.current, styles.current, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true,
        });
        if (cancelled) return;
        setRendered(true);
        const page = body.current.querySelector<HTMLElement>("section.docx");
        if (page) onPageWidth?.(page.offsetWidth);
      } catch {
        if (!cancelled) onFailed?.("This Word document couldn't be drawn. Download it to open it.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  return (
    <div
      className={thumbnail ? "pointer-events-none origin-top-left" : "mx-auto w-max"}
      style={thumbnail ? { transform: "scale(0.24)", width: "420%" } : { zoom }}
      data-testid={thumbnail ? undefined : "docx-preview"}
      data-rendered={rendered || undefined}
    >
      <div ref={styles} />
      <div ref={body} className={thumbnail ? "[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 [&_section.docx]:!mb-0 [&_section.docx]:!shadow-none" : "[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0"} />
    </div>
  );
}

// ── Tiles ────────────────────────────────────────────────────────────────────

/** The coloured square that says what a file is, where there is no picture of it. */
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

function FileTile({ kind, large = false }: { kind: FileKind; large?: boolean }) {
  const tile = TILE[kind.category];
  const text = tile.text(kind);
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${large ? "h-14 w-14 text-base" : "h-9 w-9"} ${!large && text.length > 2 ? "text-[10px]" : !large ? "text-sm" : ""}`}
      style={{ backgroundColor: tile.bg }}
    >
      {text}
    </span>
  );
}

/** What a tile shows: a small picture of the file itself. */
function TilePicture({ item, kind }: { item: PreviewItem; kind: FileKind }) {
  // Video and audio get an icon: loading them for a thumbnail costs too much.
  const mode = kind.preview && kind.preview !== "video" && kind.preview !== "audio" ? kind.preview : null;
  const data = usePreviewData(item, mode, mode !== null);
  const [docxFailed, setDocxFailed] = useState(false);

  if (!mode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <FileTile kind={kind} large />
        {!kind.previewable && <span className="text-[11px] text-[var(--ink3)]">No preview</span>}
      </div>
    );
  }
  if (data.status === "loading") {
    return (
      // A Spinner, not the logo loader: the tile is a button, and the loader's
      // slow-load notice carries a button of its own.
      <div className="flex h-full items-center justify-center text-[var(--ink3)]" role="status" aria-label={`Loading preview of ${item.fileName}`}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (data.status === "error" || docxFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center">
        <FileTile kind={kind} />
        <span className="text-[11px] text-[var(--ink3)]">Preview unavailable</span>
      </div>
    );
  }
  switch (mode) {
    case "image":
      return <img src={data.url} alt="" aria-hidden className="h-full w-full object-cover" />;
    case "pdf":
      // The browser's own PDF viewer, toolbar hidden: the first page at width.
      return (
        <iframe
          src={`${data.url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          title=""
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none h-[calc(100%+40px)] w-[calc(100%+20px)] border-0 bg-white"
        />
      );
    case "docx":
      return (
        <div className="h-full overflow-hidden bg-white">
          <DocxPages blob={data.blob!} thumbnail onFailed={() => setDocxFailed(true)} />
        </div>
      );
    default:
      return <TextPage text={data.text ?? ""} csv={kind.label === "CSV"} compact />;
  }
}

/**
 * One attachment: a picture of it, its name, type and size, and what can be
 * done with it. The same tile in the composer, in a reply, and on mail received.
 */
export function AttachmentTile({
  item,
  onOpen,
  onRemove,
  uploading = false,
  testId,
}: {
  item: PreviewItem;
  onOpen: () => void;
  onRemove?: () => void;
  uploading?: boolean;
  testId: string;
}) {
  const kind = fileKind(item.fileName, item.contentType);
  return (
    <div
      data-testid={testId}
      className={`group flex w-[188px] shrink-0 flex-col overflow-hidden rounded-xl border bg-[var(--s2)] transition hover:border-[var(--accent)] hover:shadow-md ${uploading ? "border-dashed border-[var(--border)]" : "border-[var(--border)]"}`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open preview of ${item.fileName}`}
        className="relative h-[136px] overflow-hidden border-b border-[var(--border)] bg-[var(--s3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
      >
        <TilePicture item={item} kind={kind} />
        {uploading && (
          <span className="absolute right-1.5 top-1.5 inline-flex rounded-full bg-black/60 px-2 py-0.5 text-[10px]">
            <Spinner size="xs" label="Uploading" className="!gap-1 !text-white" />
          </span>
        )}
      </button>
      <div className="flex min-w-0 items-center gap-1.5 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-[var(--ink)]" title={item.fileName}>
            {item.fileName}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--ink3)]">
            <FileTypeBadge kind={kind} />
            <span>{formatBytes(item.sizeBytes)}</span>
            {!kind.previewable && <span className="sr-only">· No preview, download to open</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="shrink-0 rounded p-1 text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--accent)]"
          aria-label={`Preview ${item.fileName}`}
          title="Preview"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 rounded p-1 text-[var(--ink3)] hover:bg-[var(--crit-soft)] hover:text-[var(--crit)]"
            aria-label={`Remove ${item.fileName}`}
            title="Remove"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={item.download}
            className="shrink-0 rounded p-1 text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--ink)]"
            aria-label={`Download ${item.fileName}`}
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Viewer ───────────────────────────────────────────────────────────────────

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

/** Formats with this viewer's own zoom (PDF has the browser viewer's). */
const ZOOMABLE: PreviewMode[] = ["image", "docx", "doc", "text"];

function ViewerBody({
  item,
  kind,
  zoom,
  fit,
  onFitScale,
}: {
  item: PreviewItem;
  kind: FileKind;
  zoom: number;
  fit: boolean;
  onFitScale: (scale: number) => void;
}) {
  const mode = kind.preview;
  const data = usePreviewData(item, mode);
  const area = useRef<HTMLDivElement>(null);
  const [docxError, setDocxError] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  if (!mode) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-xl bg-white/5 p-6 text-center text-sm text-white/80" data-testid="no-preview">
          <div className="mx-auto mb-3 w-fit">
            <FileTile kind={kind} large />
          </div>
          <p className="font-medium text-white">{item.fileName}</p>
          <p className="mt-1 text-white/60">
            {kind.label} · {formatBytes(item.sizeBytes)}
          </p>
          <p className="mt-3 text-white/60">Browsers can&apos;t show {kind.label} files here. Download it to open it.</p>
          <button
            onClick={item.download}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 font-medium text-white hover:bg-white/25"
          >
            <Download className="h-4 w-4" /> Download
          </button>
        </div>
      </div>
    );
  }
  if (data.status === "loading") {
    return (
      // The viewer is dark in either theme, so the caption is lightened.
      <div className="flex h-full items-center justify-center">
        <BrandLoader variant="compact" label="Preparing preview" className="!text-white/70" onRetry={data.retry} />
      </div>
    );
  }
  if (data.status === "error" || docxError) {
    return (
      <div className="flex h-full items-center justify-center p-6" role="alert">
        <div className="max-w-sm text-center text-sm text-white/70" data-testid="preview-error">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-white/50" />
          <p className="font-medium text-white">Couldn&apos;t show this file</p>
          <p className="mt-1">{docxError ?? data.error}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => {
                setDocxError(null);
                data.retry();
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 font-medium text-white hover:bg-white/25"
            >
              <RotateCcw className="h-4 w-4" /> Retry
            </button>
            <button onClick={item.download} className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 font-medium text-white hover:bg-white/25">
              <Download className="h-4 w-4" /> Download
            </button>
          </div>
        </div>
      </div>
    );
  }

  switch (mode) {
    case "pdf":
      // The browser's PDF viewer, filling the window: its own zoom, fit and pages.
      return <iframe src={`${data.url}#view=FitH`} title={item.fileName} className="h-full w-full border-0 bg-white" />;
    case "video":
      return (
        <div className="flex h-full items-center justify-center p-4">
          <video src={data.url} controls className="max-h-full max-w-full rounded-lg" />
        </div>
      );
    case "audio":
      return (
        <div className="flex h-full items-center justify-center p-4">
          <audio src={data.url} controls className="w-full max-w-lg" />
        </div>
      );
    case "image":
      return (
        <div ref={area} className={`h-full w-full overflow-auto ${fit ? "flex items-center justify-center p-4" : "p-6"}`}>
          <img
            src={data.url}
            alt={item.fileName}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              const box = area.current?.getBoundingClientRect();
              if (box) onFitScale(Math.min(1, (box.width - 32) / img.naturalWidth, (box.height - 32) / img.naturalHeight));
            }}
            className={fit ? "max-h-full max-w-full rounded object-contain shadow-2xl" : "mx-auto max-w-none rounded shadow-2xl"}
            style={!fit && natural ? { width: natural.w * zoom, height: natural.h * zoom } : undefined}
          />
        </div>
      );
    case "docx":
      return (
        <div ref={area} className="h-full w-full overflow-auto bg-[#e7ebf0] px-6 py-8">
          <DocxPages
            blob={data.blob!}
            zoom={zoom}
            onPageWidth={(width) => {
              const box = area.current?.getBoundingClientRect();
              if (box && width) onFitScale(Math.min(2, (box.width - 64) / width));
            }}
            onFailed={setDocxError}
          />
        </div>
      );
    default:
      // text, CSV, and a .doc's text
      return (
        <div className="h-full w-full overflow-auto bg-[#e7ebf0] px-6 py-8">
          {mode === "doc" && (
            <p className="mx-auto mb-3 max-w-[980px] text-[12px] text-slate-600">
              The text of this Word 97–2003 document. Download it to see its layout.
            </p>
          )}
          <TextPage text={data.text ?? ""} csv={kind.label === "CSV"} scale={zoom} truncated={data.truncated} />
        </div>
      );
  }
}

/**
 * The full-window viewer. Zoom −/+ (and Ctrl/⌘ +/−, 0), Fit and 100% for
 * images, Word documents and text; the PDF viewer brings its own. Arrow keys
 * move between files; Escape closes.
 */
export function FilePreview({
  items,
  startIndex,
  onClose,
}: {
  items: PreviewItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(startIndex, Math.max(items.length - 1, 0)));
  const item = items[index] ?? null;
  const kind = item ? fileKind(item.fileName, item.contentType) : null;
  const zoomable = Boolean(kind?.preview && ZOOMABLE.includes(kind.preview));
  // "Fit" follows the window; a set zoom is kept until changed.
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const scale = fit ? (kind?.preview === "image" ? fitScale : kind?.preview === "docx" ? fitScale : 1) : zoom;

  useEffect(() => {
    setFit(true);
    setZoom(1);
    setFitScale(1);
  }, [index]);

  const step = useCallback(
    (direction: 1 | -1) => {
      const current = scale;
      const next =
        direction > 0
          ? ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
          : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0];
      setFit(false);
      setZoom(next);
    },
    [scale]
  );

  const prev = () => setIndex((i) => (i > 0 ? i - 1 : items.length - 1));
  const next = () => setIndex((i) => (i < items.length - 1 ? i + 1 : 0));

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && !e.ctrlKey) prev();
      else if (e.key === "ArrowRight" && !e.ctrlKey) next();
      else if (zoomable && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        step(1);
      } else if (zoomable && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        step(-1);
      } else if (zoomable && e.key === "0") {
        e.preventDefault();
        setFit(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose, items.length, zoomable, step]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleKey]);

  if (!item || !kind) return null;
  const control =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b1120]/95 backdrop-blur-sm" role="dialog" aria-label={`Preview of ${item.fileName}`}>
      {/* Top bar: what it is, zoom, download, close */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileTypeBadge kind={kind} />
            <div className="truncate text-sm font-medium text-white">{item.fileName}</div>
          </div>
          <div className="text-xs text-white/55">
            {formatBytes(item.sizeBytes)} · {index + 1} of {items.length}
          </div>
        </div>

        {zoomable && (
          <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5" role="group" aria-label="Zoom">
            <button className={control} onClick={() => step(-1)} aria-label="Zoom out" title="Zoom out (−)">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              className={`${control} w-16 text-xs tabular-nums`}
              onClick={() => {
                setFit(false);
                setZoom(1);
              }}
              aria-label="Actual size"
              title="Actual size (100%)"
              data-testid="zoom-level"
            >
              {Math.round(scale * 100)}%
            </button>
            <button className={control} onClick={() => step(1)} aria-label="Zoom in" title="Zoom in (+)">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              className={`${control} ${fit ? "bg-white/15 text-white" : ""}`}
              onClick={() => setFit(true)}
              aria-label="Fit to screen"
              aria-pressed={fit}
              title="Fit to screen (0)"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        )}
        {kind.preview === "pdf" && <span className="hidden text-xs text-white/50 md:inline">Zoom and fit with the PDF toolbar</span>}

        <div className="flex items-center gap-1">
          <button onClick={item.download} className={control} title="Download" aria-label={`Download ${item.fileName}`}>
            <Download className="h-5 w-5" />
          </button>
          <button onClick={onClose} className={control} title="Close (Esc)" aria-label="Close preview">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* The file, as large as the window allows */}
      <div className="relative min-h-0 flex-1">
        <ViewerBody key={item.key} item={item} kind={kind} zoom={scale} fit={fit} onFitScale={setFitScale} />
        {items.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous attachment"
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/85 shadow-lg hover:bg-black/70"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={next}
              aria-label="Next attachment"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/85 shadow-lg hover:bg-black/70"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Received attachments ─────────────────────────────────────────────────────

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
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  if (attachments.length === 0) return null;
  const items = attachments.map((att) => attachmentPreviewItem(messageId, att, mailboxId));
  const totalSize = attachments.reduce((sum, a) => sum + a.sizeBytes, 0);

  // One after another: browsers block a burst of simultaneous downloads.
  const downloadAll = async () => {
    setDownloadingAll(true);
    try {
      for (const att of attachments) await downloadAttachment(messageId, att, mailboxId);
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
      <div className="flex flex-wrap gap-3">
        {items.map((item, index) => (
          <AttachmentTile key={item.key} item={item} testId="attachment-card" onOpen={() => setOpenIndex(index)} />
        ))}
      </div>
      {openIndex !== null && <FilePreview items={items} startIndex={openIndex} onClose={() => setOpenIndex(null)} />}
    </div>
  );
}

export default AttachmentList;
