/**
 * Which files may be attached, and what type each one is stored as.
 *
 * The extension decides. Browsers report a file's MIME type from the
 * operating system's registry, and for ordinary files that is often wrong or
 * missing — Windows sends a .docx as application/octet-stream when Office is
 * not installed, and many browsers send nothing at all for .pptx or .md. The
 * old check trusted that report against a short list, so real documents were
 * refused as "not allowed" and the ones that got through were stored with
 * whatever type the browser guessed, which is what previews then trusted.
 *
 * So: the extension must be one listed here; the reported type must agree
 * with it or be generic; and the stored type is always the canonical one
 * below. Anything the browser says is HTML, script or an executable is
 * refused whatever its name, so a renamed payload cannot ride in on a
 * harmless extension.
 */

/** Extension → canonical MIME type. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  // Spreadsheets
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  // Presentations
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  // Text
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  json: "application/json",
  ics: "text/calendar",
  eml: "message/rfc822",
  // Images (no SVG: it can carry script)
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  // Audio and video
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  // Archives
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  gz: "application/gzip",
  tar: "application/x-tar",
};

/** Reports that say nothing about the file, so the extension decides alone. */
const GENERIC_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

/** Other names browsers and systems use for the same types. */
const ALIASES: Record<string, string[]> = {
  // Office Open XML files are zip archives, and some systems report them so.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["application/zip", "application/x-zip-compressed"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["application/zip", "application/x-zip-compressed"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["application/zip", "application/x-zip-compressed"],
  "text/csv": ["application/vnd.ms-excel", "application/csv", "text/x-csv", "text/plain"],
  "application/zip": ["application/x-zip-compressed", "application/x-zip"],
  "application/x-7z-compressed": ["application/x-7z"],
  "application/vnd.rar": ["application/x-rar-compressed", "application/x-rar"],
  "application/gzip": ["application/x-gzip"],
  "application/rtf": ["text/rtf"],
  "text/markdown": ["text/x-markdown", "text/plain"],
  "application/json": ["text/json", "text/plain"],
  "text/calendar": ["text/plain"],
  "image/jpeg": ["image/pjpeg", "image/jpg"],
  "image/bmp": ["image/x-ms-bmp"],
  "image/heic": ["image/heif"],
  "audio/wav": ["audio/x-wav", "audio/wave"],
  "audio/mp4": ["audio/x-m4a", "audio/m4a"],
  "audio/mpeg": ["audio/mp3"],
  "message/rfc822": ["application/octet-stream"],
};

/** Reported types that are refused whatever the file is called. */
const DANGEROUS = /(html|javascript|ecmascript|x-msdownload|x-msdos-program|x-executable|x-sh|x-bat|x-msi|svg|x-php|java-archive|vnd\.microsoft\.portable-executable)/i;

export type AttachmentTypeCheck =
  | { ok: true; contentType: string; extension: string }
  | { ok: false; reason: string };

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** Whether a file may be attached, and if so the type it is stored as. */
export function checkAttachmentType(fileName: string, reportedType: string | undefined): AttachmentTypeCheck {
  const reported = (reportedType ?? "").toLowerCase().split(";")[0]!.trim();
  if (DANGEROUS.test(reported)) {
    return { ok: false, reason: "Files that can run code (programs, scripts, web pages) can't be attached." };
  }
  const extension = extensionOf(fileName);
  const canonical = ATTACHMENT_TYPES[extension];
  if (!canonical) {
    return {
      ok: false,
      reason: extension
        ? `.${extension} files can't be attached. Documents, spreadsheets, presentations, images, audio, video, text and archives can.`
        : "Files without an extension can't be attached; add one that says what the file is.",
    };
  }
  const agrees = reported === canonical || GENERIC_TYPES.has(reported) || (ALIASES[canonical] ?? []).includes(reported);
  if (!agrees) {
    return { ok: false, reason: `This file is named .${extension} but the browser reports it as ${reported}.` };
  }
  return { ok: true, contentType: canonical, extension };
}
