import type { EmailMessage } from "./mail-api";

/**
 * Print Mail: one message, or a whole conversation, as a plain document the
 * browser can print or save as PDF (its print dialog offers "Save as PDF").
 *
 * The page itself is never printed. A separate document holding only the
 * subject, the headers and each body is written into a hidden frame and that
 * frame is printed, so nothing of the app (rails, toolbars, buttons) can leak
 * onto the paper, whatever the screen layout is.
 *
 * The frame is sandboxed without scripts, like the reading pane's: a body is
 * written by whoever sent it. allow-modals is what lets its print dialog open;
 * allow-same-origin lets this code reach the frame to call print().
 */

export interface PrintOptions {
  /** Spam is shown as plain text only; it prints the same way. */
  plainTextOnly?: boolean;
  /** Mailbox the message was read from, shown in the header line. */
  mailbox?: string | null;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sender(m: EmailMessage): string {
  const address = m.fromAddress ?? m.author.email;
  const name = m.fromName ?? (m.fromAddress ? null : m.author.displayName);
  return name && name !== address ? `${name} <${address}>` : address;
}

/**
 * A sender's HTML, reduced to what prints: no scripts, frames, forms or
 * embedded objects, no event handlers or javascript: links. The frame runs
 * no scripts anyway; this keeps the markup itself inert.
 */
export function printableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, frame, object, embed, form, base, meta, link, noscript").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  // A sender's <style> stays inside its own body, scoped by the wrapper below.
  return doc.body.innerHTML;
}

function messageSection(m: EmailMessage, opts: PrintOptions): string {
  const to = m.recipients.filter((r) => r.type === "TO").map((r) => r.email);
  const cc = m.recipients.filter((r) => r.type === "CC").map((r) => r.email);
  const bcc = m.recipients.filter((r) => r.type === "BCC").map((r) => r.email);
  const when = new Date(m.sentAt ?? m.createdAt);
  const rows: [string, string][] = [
    ["From", sender(m)],
    ["To", to.join(", ") || "—"],
    ...(cc.length ? [["Cc", cc.join(", ")] as [string, string]] : []),
    ...(bcc.length ? [["Bcc", bcc.join(", ")] as [string, string]] : []),
    ["Date", Number.isNaN(when.getTime()) ? "—" : longDate.format(when)],
  ];
  const body =
    m.htmlBody && !opts.plainTextOnly
      ? `<div class="html-body">${printableHtml(m.htmlBody)}</div>`
      : m.textBody?.trim()
        ? `<pre class="text-body">${esc(m.textBody)}</pre>`
        : m.htmlBody
          ? `<pre class="text-body">${esc(new DOMParser().parseFromString(m.htmlBody, "text/html").body.textContent ?? "")}</pre>`
          : `<p class="empty">(no content)</p>`;
  const attachments = m.attachments.length
    ? `<div class="attachments"><strong>${m.attachments.length} attachment${m.attachments.length === 1 ? "" : "s"}</strong><ul>${m.attachments
        .map((a) => `<li>${esc(a.fileName)} <span>(${sizeLabel(a.sizeBytes)})</span></li>`)
        .join("")}</ul></div>`
    : "";
  return `<section class="message">
    <table class="headers">${rows.map(([k, v]) => `<tr><th>${k}:</th><td>${esc(v)}</td></tr>`).join("")}</table>
    ${body}
    ${attachments}
  </section>`;
}

/** The whole printable document, exported for tests. */
export function printDocument(messages: EmailMessage[], opts: PrintOptions = {}): string {
  const subject = messages[messages.length - 1]?.subject || messages[0]?.subject || "(no subject)";
  const count = messages.length > 1 ? `<p class="count">${messages.length} messages in this conversation</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${esc(subject)}</title><style>
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12.5pt; line-height: 1.5; }
    .brand { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111827; padding-bottom: 6pt; margin-bottom: 14pt; font-size: 9.5pt; color: #4b5563; }
    .brand strong { font-size: 11pt; color: #111827; letter-spacing: 0.02em; }
    h1 { font-size: 18pt; line-height: 1.3; margin: 0 0 4pt; word-wrap: break-word; }
    .count { margin: 0 0 10pt; font-size: 9.5pt; color: #6b7280; }
    .message { padding: 12pt 0 14pt; border-top: 1px solid #d1d5db; }
    .message:first-of-type { border-top: 0; padding-top: 4pt; }
    .headers { border-collapse: collapse; margin-bottom: 12pt; font-size: 10.5pt; }
    .headers th { text-align: left; vertical-align: top; padding: 1pt 10pt 1pt 0; color: #4b5563; font-weight: 600; white-space: nowrap; }
    .headers td { padding: 1pt 0; word-break: break-word; }
    .html-body, .text-body { font-size: 11.5pt; overflow-wrap: anywhere; }
    .html-body img { max-width: 100%; height: auto; }
    .html-body table { max-width: 100%; }
    .html-body blockquote { border-left: 2px solid #d1d5db; margin: 0 0 0 6pt; padding-left: 10pt; color: #4b5563; }
    .text-body { white-space: pre-wrap; font-family: inherit; margin: 0; }
    .empty { color: #6b7280; font-style: italic; }
    .attachments { margin-top: 12pt; padding-top: 8pt; border-top: 1px dashed #d1d5db; font-size: 10pt; }
    .attachments ul { margin: 4pt 0 0; padding-left: 16pt; }
    .attachments span { color: #6b7280; }
    a { color: #1d4ed8; }
  </style></head><body>
    <div class="brand"><strong>Zoiko Mail</strong><span>${opts.mailbox ? `${esc(opts.mailbox)} · ` : ""}Printed ${esc(longDate.format(new Date()))}</span></div>
    <h1>${esc(subject)}</h1>
    ${count}
    ${messages.map((m) => messageSection(m, opts)).join("")}
  </body></html>`;
}

/**
 * Opens the browser's print dialog for these messages. Resolves once the
 * dialog has been shown; rejects if the browser would not open it.
 */
export function printMessages(messages: EmailMessage[], opts: PrintOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (messages.length === 0) {
      reject(new Error("There is nothing to print."));
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-modals allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("data-testid", "print-frame");
    frame.title = "Print preview";
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
    let done = false;
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    frame.onload = () => {
      if (done) return;
      done = true;
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("The print view could not be prepared.");
        win.focus();
        win.print();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Printing is not available in this browser."));
      } finally {
        cleanup();
      }
    };
    frame.srcdoc = printDocument(messages, opts);
    document.body.appendChild(frame);
  });
}
