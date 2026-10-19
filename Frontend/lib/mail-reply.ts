import type { EmailMessage } from "./mail-api";

/**
 * Who a reply goes to, worked out the way the server does (mail.service
 * createReplyDraft), so the composer can show it before the draft exists.
 * The server stays the authority: it builds the actual draft.
 *
 * - From someone else: Reply goes to the sender; Reply all adds the other
 *   To and Cc recipients.
 * - From us (Sent, or our own message in a thread): Reply goes to the people
 *   it was sent to; Reply all adds its Cc.
 *
 * "Us" is every address that is ours here: the sign-in email, the personal
 * mailbox and any mailbox being sent as. Bcc recipients are never repeated.
 */
export function replyRecipients(
  message: Pick<EmailMessage, "fromAddress" | "author" | "recipients">,
  ownAddresses: Array<string | null | undefined>,
  replyAll: boolean
): { to: string[]; cc: string[] } {
  const ours = new Set(ownAddresses.filter(Boolean).map((address) => address!.toLowerCase()));
  const author = (message.fromAddress ?? message.author.email).toLowerCase();
  const fromUs = ours.has(author);
  const to = new Set<string>();
  const cc = new Set<string>();
  if (!fromUs) to.add(author);
  if (replyAll || fromUs) {
    for (const recipient of message.recipients) {
      const email = recipient.email.toLowerCase();
      if (ours.has(email) || recipient.type === "BCC") continue;
      if (recipient.type === "CC") {
        if (replyAll) cc.add(email);
      } else {
        to.add(email);
      }
    }
  }
  to.forEach((email) => cc.delete(email));
  return { to: Array.from(to), cc: Array.from(cc) };
}

/** "Re: …" exactly once, as the server sets it. */
export function replySubject(subject: string | null | undefined): string {
  const base = subject?.trim() || "(no subject)";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/** "Fwd: …" for display in the forward composer. */
export function forwardSubject(subject: string | null | undefined): string {
  const base = subject?.trim() || "(no subject)";
  return /^fwd:/i.test(base) ? base : `Fwd: ${base}`;
}

/** The attribution line above a quoted original: "On <date>, <sender> wrote:". */
export function quoteAttribution(message: Pick<EmailMessage, "fromAddress" | "fromName" | "author" | "sentAt" | "createdAt">): string {
  const when = new Date(message.sentAt ?? message.createdAt);
  const date = Number.isNaN(when.getTime())
    ? ""
    : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const address = message.fromAddress ?? message.author.email;
  const name = message.fromName ?? (message.fromAddress ? null : message.author.displayName);
  const sender = name ? `${name} <${address}>` : address;
  return date ? `On ${date}, ${sender} wrote:` : `${sender} wrote:`;
}

/** A message's readable text: its text part, or its HTML with the markup removed. */
export function plainTextOf(message: Pick<EmailMessage, "textBody" | "htmlBody">): string {
  if (message.textBody?.trim()) return message.textBody.trim();
  if (!message.htmlBody) return "";
  if (typeof DOMParser === "undefined") return message.htmlBody.replace(/<[^>]+>/g, "").trim();
  // DOMParser builds an inert document: no script runs and nothing loads.
  const doc = new DOMParser().parseFromString(message.htmlBody, "text/html");
  doc.querySelectorAll("script,style").forEach((node) => node.remove());
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6").forEach((node) => node.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export interface QuotedOriginal {
  /** The heading line shown above the quote. */
  heading: string;
  /** The original's text, for display. */
  text: string;
  /** Appended to the plain-text body. */
  textSuffix: string;
  /** Appended to the HTML body. The original is escaped text, never its markup. */
  htmlSuffix: string;
}

/**
 * The original message as a reply or forward carries it, below what was typed.
 * Kept out of the editor so it can't be half-deleted by accident, and added to
 * the body on every save, because each save replaces the whole body.
 */
export function quotedOriginal(
  message: Pick<EmailMessage, "fromAddress" | "fromName" | "author" | "sentAt" | "createdAt" | "subject" | "recipients" | "textBody" | "htmlBody">,
  kind: "reply" | "forward"
): QuotedOriginal {
  const text = plainTextOf(message);
  const htmlText = escapeHtml(text).replace(/\n/g, "<br>");
  if (kind === "forward") {
    const from = message.fromName
      ? `${message.fromName} <${message.fromAddress ?? message.author.email}>`
      : message.fromAddress ?? message.author.email;
    const when = new Date(message.sentAt ?? message.createdAt);
    const to = message.recipients.filter((r) => r.type === "TO").map((r) => r.email).join(", ");
    const cc = message.recipients.filter((r) => r.type === "CC").map((r) => r.email).join(", ");
    const lines = [
      `From: ${from}`,
      Number.isNaN(when.getTime()) ? null : `Date: ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
      `Subject: ${message.subject || "(no subject)"}`,
      to ? `To: ${to}` : null,
      cc ? `Cc: ${cc}` : null,
    ].filter((line): line is string => line !== null);
    const heading = "---------- Forwarded message ---------";
    return {
      heading,
      text: `${lines.join("\n")}\n\n${text}`,
      textSuffix: `\n\n${heading}\n${lines.join("\n")}\n\n${text}`,
      htmlSuffix: `<p>${escapeHtml(heading)}<br>${lines.map(escapeHtml).join("<br>")}</p><p>${htmlText}</p>`,
    };
  }
  const heading = quoteAttribution(message);
  return {
    heading,
    text,
    textSuffix: `\n\n${heading}\n${text.split("\n").map((line) => `> ${line}`).join("\n")}`,
    htmlSuffix: `<p>${escapeHtml(heading)}</p><blockquote>${htmlText}</blockquote>`,
  };
}
