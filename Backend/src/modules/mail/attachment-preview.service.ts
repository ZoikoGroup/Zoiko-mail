import WordExtractor from "word-extractor";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { extensionOf } from "./attachment-types.js";

/**
 * Readable previews of the formats a browser cannot draw.
 *
 * PDFs, images, video, audio and text the browser shows itself, and .docx is
 * drawn in the browser (docx-preview). A legacy Word .doc is a binary format
 * no browser library renders, so its text is extracted here and shown as a
 * text preview — the words of the document, without its layout, which is
 * what a reader needs to know whether to open it.
 */

/** Long documents are cut here; the rest is a download away. */
const MAX_PREVIEW_CHARS = 200_000;

export type AttachmentPreview = { kind: "text"; text: string; truncated: boolean };

/** Extensions this service can preview. */
const TEXT_EXTRACTABLE = new Set(["doc"]);

export function canPreviewOnServer(fileName: string): boolean {
  return TEXT_EXTRACTABLE.has(extensionOf(fileName));
}

/** The document's text, for a .doc file's bytes. */
export async function previewDocument(fileName: string, data: Buffer): Promise<AttachmentPreview> {
  if (!canPreviewOnServer(fileName)) {
    throw new AppError("There is no server preview for this file type", 415, ErrorCodes.VALIDATION_ERROR);
  }
  let body: string;
  try {
    const document = await new WordExtractor().extract(data);
    body = [document.getHeaders({ includeFooters: false }), document.getBody(), document.getFootnotes()]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join("\n\n");
  } catch {
    // A damaged file, or one that is not really a Word document.
    throw new AppError("This document couldn't be read for a preview. Download it to open it.", 422, ErrorCodes.VALIDATION_ERROR);
  }
  const text = body.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return {
    kind: "text",
    text: text.slice(0, MAX_PREVIEW_CHARS),
    truncated: text.length > MAX_PREVIEW_CHARS,
  };
}
