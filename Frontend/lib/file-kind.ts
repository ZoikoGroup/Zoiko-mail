/**
 * What kind of file an attachment is, for its label, its icon and whether it
 * can be previewed in the browser.
 *
 * The content type is what mail servers send, but it is often generic
 * (application/octet-stream), so the file extension decides when it is more
 * specific. Preview is never decided by extension alone for active content:
 * HTML and SVG are not on the list, because rendering them could run script.
 */
export type FileCategory = "image" | "pdf" | "video" | "audio" | "text" | "document" | "spreadsheet" | "presentation" | "archive" | "other";

export interface FileKind {
  /** Short label: PDF, DOCX, PNG… */
  label: string;
  category: FileCategory;
  /** The browser can show it inline (image, PDF, video, audio, plain text). */
  previewable: boolean;
}

const BY_EXTENSION: Record<string, { label: string; category: FileCategory }> = {
  pdf: { label: "PDF", category: "pdf" },
  png: { label: "PNG", category: "image" },
  jpg: { label: "JPG", category: "image" },
  jpeg: { label: "JPG", category: "image" },
  gif: { label: "GIF", category: "image" },
  webp: { label: "WEBP", category: "image" },
  bmp: { label: "BMP", category: "image" },
  mp4: { label: "MP4", category: "video" },
  webm: { label: "WEBM", category: "video" },
  mov: { label: "MOV", category: "video" },
  mp3: { label: "MP3", category: "audio" },
  wav: { label: "WAV", category: "audio" },
  ogg: { label: "OGG", category: "audio" },
  txt: { label: "TXT", category: "text" },
  csv: { label: "CSV", category: "text" },
  log: { label: "LOG", category: "text" },
  md: { label: "MD", category: "text" },
  json: { label: "JSON", category: "text" },
  xml: { label: "XML", category: "text" },
  doc: { label: "DOC", category: "document" },
  docx: { label: "DOCX", category: "document" },
  odt: { label: "ODT", category: "document" },
  rtf: { label: "RTF", category: "document" },
  xls: { label: "XLS", category: "spreadsheet" },
  xlsx: { label: "XLSX", category: "spreadsheet" },
  ods: { label: "ODS", category: "spreadsheet" },
  ppt: { label: "PPT", category: "presentation" },
  pptx: { label: "PPTX", category: "presentation" },
  odp: { label: "ODP", category: "presentation" },
  zip: { label: "ZIP", category: "archive" },
  rar: { label: "RAR", category: "archive" },
  "7z": { label: "7Z", category: "archive" },
  gz: { label: "GZ", category: "archive" },
  tar: { label: "TAR", category: "archive" },
};

function fromContentType(contentType: string): { label: string; category: FileCategory } | null {
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (type === "application/pdf") return { label: "PDF", category: "pdf" };
  if (type === "image/svg+xml") return { label: "SVG", category: "other" };
  if (type.startsWith("image/")) return { label: type.slice(6).toUpperCase(), category: "image" };
  if (type.startsWith("video/")) return { label: type.slice(6).toUpperCase(), category: "video" };
  if (type.startsWith("audio/")) return { label: type.slice(6).toUpperCase(), category: "audio" };
  if (type === "text/csv") return { label: "CSV", category: "text" };
  if (type === "text/plain") return { label: "TXT", category: "text" };
  if (type === "application/json") return { label: "JSON", category: "text" };
  if (type.includes("wordprocessingml") || type === "application/msword") return { label: "DOC", category: "document" };
  if (type.includes("spreadsheetml") || type === "application/vnd.ms-excel") return { label: "XLS", category: "spreadsheet" };
  if (type.includes("presentationml") || type === "application/vnd.ms-powerpoint") return { label: "PPT", category: "presentation" };
  if (type.includes("zip") || type.includes("compressed")) return { label: "ZIP", category: "archive" };
  return null;
}

export function fileKind(fileName: string, contentType: string): FileKind {
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  const match = BY_EXTENSION[extension] ?? fromContentType(contentType ?? "");
  const resolved = match ?? { label: extension ? extension.toUpperCase().slice(0, 5) : "FILE", category: "other" as const };
  return {
    ...resolved,
    previewable: ["image", "pdf", "video", "audio", "text"].includes(resolved.category),
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
