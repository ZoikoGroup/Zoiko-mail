import { extractText, getDocumentProxy } from "unpdf";
import WordExtractor from "word-extractor";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { LocalAttachmentStorage } from "../mail/attachment.storage.js";

/**
 * Files attached to assistant questions: which are accepted, how each is
 * checked, and how its content is read.
 *
 * Documents (PDF, Word) are read in memory and only their text is kept; the
 * uploaded bytes never touch the disk. Images are kept in the assistant's own
 * storage, under a random name, because the model looks at the picture itself.
 */

export type AttachmentKind = "DOCUMENT" | "IMAGE";

interface FileType {
  kind: AttachmentKind;
  contentType: string;
  label: string;
  /** The file's first bytes, so a renamed file cannot pass as another type. */
  signature: (data: Buffer) => boolean;
}

const startsWith = (data: Buffer, bytes: number[]) => bytes.every((b, i) => data[i] === b);

const TYPES: Record<string, FileType> = {
  pdf: { kind: "DOCUMENT", contentType: "application/pdf", label: "PDF", signature: (d) => d.subarray(0, 1024).includes("%PDF-") },
  docx: {
    kind: "DOCUMENT",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word document",
    signature: (d) => startsWith(d, [0x50, 0x4b, 0x03, 0x04]),
  },
  doc: { kind: "DOCUMENT", contentType: "application/msword", label: "Word document", signature: (d) => startsWith(d, [0xd0, 0xcf, 0x11, 0xe0]) },
  png: { kind: "IMAGE", contentType: "image/png", label: "PNG image", signature: (d) => startsWith(d, [0x89, 0x50, 0x4e, 0x47]) },
  jpg: { kind: "IMAGE", contentType: "image/jpeg", label: "JPEG image", signature: (d) => startsWith(d, [0xff, 0xd8, 0xff]) },
  jpeg: { kind: "IMAGE", contentType: "image/jpeg", label: "JPEG image", signature: (d) => startsWith(d, [0xff, 0xd8, 0xff]) },
  webp: {
    kind: "IMAGE",
    contentType: "image/webp",
    label: "WebP image",
    signature: (d) => d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP",
  },
  gif: { kind: "IMAGE", contentType: "image/gif", label: "GIF image", signature: (d) => d.subarray(0, 4).toString("latin1") === "GIF8" },
};

export const ASSISTANT_FILE_EXTENSIONS = Object.keys(TYPES);

/** The most text kept from one document; the model is told when it was cut. */
export const MAX_DOCUMENT_CHARS = 120_000;
/** A document with less readable text than this is treated as having none. */
const MIN_DOCUMENT_CHARS = 20;

export const assistantStorage = new LocalAttachmentStorage(env.ASSISTANT_STORAGE_PATH);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function unsupported(): AppError {
  return new AppError(
    "Alet can read PDF, Word (.doc, .docx) and image (PNG, JPEG, WebP, GIF) files.",
    415,
    ErrorCodes.VALIDATION_ERROR
  );
}

export interface CheckedFile {
  kind: AttachmentKind;
  contentType: string;
  label: string;
}

/** Type and size, by extension and by the file's own first bytes. */
export function checkFile(fileName: string, data: Buffer): CheckedFile {
  const type = TYPES[extensionOf(fileName)];
  if (!type) throw unsupported();
  if (data.length === 0) throw new AppError("This file is empty.", 422, ErrorCodes.VALIDATION_ERROR);
  if (data.length > env.ASSISTANT_ATTACHMENT_MAX_BYTES) {
    throw new AppError(`Files can be up to ${Math.round(env.ASSISTANT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB.`, 413, ErrorCodes.VALIDATION_ERROR);
  }
  if (!type.signature(data)) {
    throw new AppError(`This file isn't a valid ${type.label}. It may be damaged or have the wrong extension.`, 415, ErrorCodes.VALIDATION_ERROR);
  }
  return { kind: type.kind, contentType: type.contentType, label: type.label };
}

export interface ExtractedDocument {
  text: string;
  pageCount: number | null;
  truncated: boolean;
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A document's text. Refuses one with no readable text, with the reason. */
export async function extractDocument(fileName: string, data: Buffer): Promise<ExtractedDocument> {
  const extension = extensionOf(fileName);
  let text = "";
  let pageCount: number | null = null;

  if (extension === "pdf") {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const result = await extractText(pdf, { mergePages: false });
      pageCount = result.totalPages;
      // Pages are marked so answers can point to where something is.
      text = (result.text as string[]).map((page, i) => `[Page ${i + 1}]\n${page}`).join("\n\n");
      if (!tidy((result.text as string[]).join("")).length) text = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/password/i.test(message)) {
        throw new AppError("This PDF is password-protected. Remove the password and attach it again.", 422, ErrorCodes.VALIDATION_ERROR);
      }
      throw new AppError("This PDF couldn't be read. It may be damaged.", 422, ErrorCodes.VALIDATION_ERROR);
    }
    if (tidy(text).replace(/\[Page \d+\]/g, "").trim().length < MIN_DOCUMENT_CHARS) {
      throw new AppError(
        "This PDF has no selectable text — it is probably scanned. Attach a photo or screenshot of the page instead, and Alet will read the image.",
        422,
        ErrorCodes.VALIDATION_ERROR
      );
    }
  } else {
    try {
      const document = await new WordExtractor().extract(data);
      text = [document.getHeaders({ includeFooters: false }), document.getBody(), document.getFootnotes(), document.getEndnotes()]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join("\n\n");
    } catch {
      throw new AppError("This Word document couldn't be read. It may be damaged.", 422, ErrorCodes.VALIDATION_ERROR);
    }
    if (tidy(text).length < MIN_DOCUMENT_CHARS) {
      throw new AppError("This Word document has no text to read.", 422, ErrorCodes.VALIDATION_ERROR);
    }
  }

  const clean = tidy(text);
  return { text: clean.slice(0, MAX_DOCUMENT_CHARS), pageCount, truncated: clean.length > MAX_DOCUMENT_CHARS };
}
