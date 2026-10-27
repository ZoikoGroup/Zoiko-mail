import { convert } from "html-to-text";
import { extractDocument } from "./assistant.files.js";

/**
 * An email from the member's mail, written out as one document for the
 * assistant to read ("Summarize with Alet"): the headers, the whole body, and
 * the attachments — each listed, and the text of the documents among them
 * read too, so "what does the attached contract say" can be answered.
 *
 * Long emails and long attachments are cut, and the document says where, so
 * the answer can say it covers only the start.
 */

/** The body kept, and the attachment text kept in all. */
export const MAX_EMAIL_BODY_CHARS = 60_000;
const MAX_ATTACHMENT_TEXT_CHARS = 20_000;
const MAX_ALL_ATTACHMENTS_TEXT_CHARS = 40_000;
/** Attachments larger than this are listed, not read. */
const MAX_READ_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const READABLE = /\.(pdf|docx?)$/i;

export interface EmailSource {
  subject: string;
  fromAddress: string | null;
  fromName: string | null;
  author: { email: string; displayName: string | null };
  recipients: { type: string; email: string }[];
  sentAt: Date | null;
  createdAt: Date;
  textBody: string | null;
  htmlBody: string | null;
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number; scanStatus: string }[];
}

export interface EmailDocument {
  text: string;
  truncated: boolean;
  /** For the preview card. */
  summary: {
    subject: string;
    from: string;
    to: string[];
    cc: string[];
    date: string;
    attachmentCount: number;
    bodyPreview: string;
  };
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function bodyText(message: Pick<EmailSource, "textBody" | "htmlBody">): string {
  if (message.textBody?.trim()) return message.textBody.trim();
  if (!message.htmlBody) return "";
  return convert(message.htmlBody, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim();
}

/**
 * @param readAttachment returns an attachment's bytes, or null when it may
 *   not be read (blocked, quarantined) — then it is listed but not opened.
 */
export async function emailDocument(
  message: EmailSource,
  options: { restricted: boolean; readAttachment: (id: string) => Promise<Buffer | null> }
): Promise<EmailDocument> {
  const from = message.fromName
    ? `${message.fromName} <${message.fromAddress ?? message.author.email}>`
    : message.fromAddress ?? (message.author.displayName ? `${message.author.displayName} <${message.author.email}>` : message.author.email);
  const to = message.recipients.filter((r) => r.type === "TO").map((r) => r.email);
  const cc = message.recipients.filter((r) => r.type === "CC").map((r) => r.email);
  const bcc = message.recipients.filter((r) => r.type === "BCC").map((r) => r.email);
  const when = (message.sentAt ?? message.createdAt).toISOString();
  const date = new Date(when).toUTCString();

  let truncated = false;
  let body = bodyText(message);
  if (body.length > MAX_EMAIL_BODY_CHARS) {
    body = `${body.slice(0, MAX_EMAIL_BODY_CHARS)}\n[The email continues; only the first ${MAX_EMAIL_BODY_CHARS.toLocaleString("en")} characters are included.]`;
    truncated = true;
  }

  const lines: string[] = [
    `Subject: ${message.subject || "(no subject)"}`,
    `From: ${from}`,
    `To: ${to.join(", ") || "(none)"}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Date: ${date}`,
    ...(options.restricted ? ["Note: this email is in Spam or Quarantine; its attachments were not opened."] : []),
    "",
    "Body:",
    body || "(The email has no text.)",
  ];

  if (message.attachments.length) {
    lines.push("", `Attachments (${message.attachments.length}):`);
    let budget = MAX_ALL_ATTACHMENTS_TEXT_CHARS;
    for (const a of message.attachments) {
      const head = `- ${a.fileName} (${a.contentType}, ${sizeLabel(a.sizeBytes)})`;
      if (a.scanStatus === "BLOCKED") {
        lines.push(`${head} — blocked by security checks; not opened.`);
        continue;
      }
      if (options.restricted || !READABLE.test(a.fileName) || a.sizeBytes > MAX_READ_ATTACHMENT_BYTES || budget <= 0) {
        lines.push(`${head}${READABLE.test(a.fileName) && budget <= 0 ? " — not read (attachment text limit reached)." : ""}`);
        continue;
      }
      const data = await options.readAttachment(a.id);
      if (!data) {
        lines.push(`${head} — not available to read.`);
        continue;
      }
      try {
        const doc = await extractDocument(a.fileName, data);
        const room = Math.min(MAX_ATTACHMENT_TEXT_CHARS, budget);
        const shown = doc.text.slice(0, room);
        budget -= shown.length;
        const cut = doc.truncated || shown.length < doc.text.length;
        if (cut) truncated = true;
        lines.push(
          head,
          `  <<<ATTACHMENT TEXT: ${a.fileName}>>>`,
          shown,
          ...(cut ? ["  [The attachment continues; only the part above is included.]"] : []),
          "  <<<END ATTACHMENT TEXT>>>"
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "it could not be read";
        lines.push(`${head} — its text could not be read: ${reason}`);
      }
    }
  }

  return {
    text: lines.join("\n"),
    truncated,
    summary: {
      subject: message.subject || "(no subject)",
      from,
      to,
      cc,
      date: when,
      attachmentCount: message.attachments.length,
      bodyPreview: body.replace(/\s+/g, " ").slice(0, 400),
    },
  };
}
