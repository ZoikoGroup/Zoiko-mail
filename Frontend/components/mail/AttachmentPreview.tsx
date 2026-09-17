"use client";

import { useCallback, useEffect, useState } from "react";
import { Paperclip, Download, X, ChevronLeft, ChevronRight, Loader2, Eye, FileText, Image as ImageIcon, Film } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { getAccessToken } from "@/lib/auth-storage";
import type { MailAttachment } from "@/lib/mail-api";
import { downloadAttachment } from "@/lib/mail-api";

// ── Helpers ──────────────────────────────────────────────────────────────────

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(ct: string) {
  return ct.startsWith("image/");
}

function isPdf(ct: string) {
  return ct === "application/pdf";
}

function isVideo(ct: string) {
  return ct.startsWith("video/");
}

function isPreviewable(ct: string) {
  return isImage(ct) || isPdf(ct) || isVideo(ct);
}

function previewIcon(ct: string) {
  if (isImage(ct)) return ImageIcon;
  if (isPdf(ct)) return FileText;
  if (isVideo(ct)) return Film;
  return Paperclip;
}

// ── Blob URL hook ────────────────────────────────────────────────────────────

function useAttachmentBlob(messageId: string, attachment: MailAttachment, eager: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eager) return;
    let revoke = "";
    setLoading(true);
    const token = getAccessToken();
    fetch(`${API_BASE}/mail/${messageId}/attachments/${attachment.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error("Download failed");
        return res.blob();
      })
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        revoke = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null))
      .finally(() => setLoading(false));

    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [messageId, attachment.id, eager]);

  return { url, loading };
}

// ── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({
  messageId,
  attachments,
  startIndex,
  onClose,
}: {
  messageId: string;
  attachments: MailAttachment[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const att = attachments[index];
  const { url, loading } = useAttachmentBlob(messageId, att, true);

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
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{att.fileName}</div>
          <div className="text-xs text-white/60">
            {bytes(att.sizeBytes)} · {index + 1} of {attachments.length}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadAttachment(messageId, att)}
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
            title="Download"
          >
            <Download className="h-5 w-5" />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
            title="Close (Esc)"
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
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        {/* Preview content */}
        {loading ? (
          <Loader2 className="h-10 w-10 animate-spin text-white/50" />
        ) : !url ? (
          <div className="text-center text-sm text-white/50">
            <Paperclip className="mx-auto mb-2 h-10 w-10" />
            Preview not available
          </div>
        ) : isImage(att.contentType) ? (
          <img
            src={url}
            alt={att.fileName}
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
        ) : isPdf(att.contentType) ? (
          <iframe
            src={url}
            title={att.fileName}
            className="h-[80vh] w-full max-w-4xl rounded-lg bg-white"
          />
        ) : isVideo(att.contentType) ? (
          <video
            src={url}
            controls
            className="max-h-[80vh] max-w-full rounded-lg"
          />
        ) : (
          <div className="text-center text-sm text-white/50">
            <Paperclip className="mx-auto mb-2 h-10 w-10" />
            Preview not available for this file type
          </div>
        )}
      </div>
    </div>
  );
}

// ── Thumbnail ────────────────────────────────────────────────────────────────

function ImageThumbnail({
  messageId,
  attachment,
  onClick,
}: {
  messageId: string;
  attachment: MailAttachment;
  onClick: () => void;
}) {
  const { url, loading } = useAttachmentBlob(messageId, attachment, true);

  return (
    <button
      onClick={onClick}
      className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--s2)] transition hover:border-[var(--accent)]"
      title={attachment.fileName}
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
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AttachmentList({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: MailAttachment[];
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (attachments.length === 0) return null;

  // Split into previewable (images first) and non-previewable
  const images = attachments.filter((a) => isImage(a.contentType));
  const previewable = attachments.filter((a) => isPreviewable(a.contentType) && !isImage(a.contentType));
  const other = attachments.filter((a) => !isPreviewable(a.contentType));

  // For lightbox navigation, only include previewable attachments
  const lightboxItems = attachments.filter((a) => isPreviewable(a.contentType));

  const openLightbox = (att: MailAttachment) => {
    const idx = lightboxItems.findIndex((a) => a.id === att.id);
    if (idx >= 0) setLightboxIndex(idx);
  };

  return (
    <div className="mt-6">
      <div className="font-mono-num mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
        {attachments.length} attachment{attachments.length > 1 ? "s" : ""}
      </div>

      {/* Image thumbnails grid */}
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((att) => (
            <ImageThumbnail
              key={att.id}
              messageId={messageId}
              attachment={att}
              onClick={() => openLightbox(att)}
            />
          ))}
        </div>
      )}

      {/* Other previewable (PDF, video) + non-previewable files */}
      <div className="flex flex-wrap gap-2">
        {[...previewable, ...other].map((att) => {
          const Icon = previewIcon(att.contentType);
          const canPreview = isPreviewable(att.contentType);
          return (
            <div
              key={att.id}
              className="zoiko-card flex items-center gap-2 p-3 text-left"
            >
              <Icon className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
              <div className="min-w-0">
                <div className="truncate text-sm text-[var(--ink)]">{att.fileName}</div>
                <div className="text-[11px] text-[var(--ink3)]">{bytes(att.sizeBytes)}</div>
              </div>
              <div className="ml-2 flex items-center gap-1">
                {canPreview && (
                  <button
                    onClick={() => openLightbox(att)}
                    className="rounded p-1 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--accent)]"
                    title="Preview"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => downloadAttachment(messageId, att)}
                  className="rounded p-1 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink)]"
                  title="Download"
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
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

export default AttachmentList;