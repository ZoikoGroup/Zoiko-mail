import { ApiError } from "./api-client";

/**
 * Which files the composer accepts — the same list the server enforces
 * (Backend/src/modules/mail/attachment-types.ts), so a file is refused here,
 * with the reason, before it is uploaded. The server stays the authority; this
 * only saves a round trip and offers the right formats in the file picker.
 */
export const ATTACHMENT_EXTENSIONS = [
  "pdf", "doc", "docx", "odt", "rtf",
  "xls", "xlsx", "ods", "csv",
  "ppt", "pptx", "odp",
  "txt", "log", "md", "json", "ics", "eml",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "heic",
  "mp3", "wav", "m4a", "ogg", "mp4", "mov", "webm",
  "zip", "7z", "rar", "gz", "tar",
] as const;

/** The file picker's filter. By extension: browsers report types unreliably. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/** The server's default limit (ATTACHMENT_MAX_SIZE_BYTES); it says so itself if set lower. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!extension) return `${file.name}: add an extension that says what the file is.`;
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return `${file.name}: .${extension} files can't be attached.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; attachments can be up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB each.`;
  }
  return null;
}

/**
 * Whether a failed request may have done its work anyway, or failed only
 * for a moment — so trying again with the same Idempotency-Key is right: the
 * server either does it now or replays the answer it already gave. A clear
 * refusal (a 4xx about the request itself) is not retried.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0) return true; // never reached, or the answer was lost
  if (error.status >= 500) return true;
  return error.code === "IDEMPOTENCY_REQUEST_IN_PROGRESS";
}

/** Runs `attempt` until it succeeds or fails for good, waiting a little longer each time. */
export async function withRetry<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || i === tries - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** i));
    }
  }
  throw lastError;
}
