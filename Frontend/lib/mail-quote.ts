import type { EmailMessage, EmailMessageSummary } from "./mail-api";

/**
 * Telling a message's own words from the history it quotes, and naming its
 * sender — the two things a conversation view needs to read like one.
 *
 * A reply carries every earlier message below it. Shown whole, a seven-message
 * thread is seven copies of the same history; collapsed rows that preview the
 * body preview the quote ("On … wrote: > …"). Mail clients show a message's
 * own words and fold the history behind a "…" toggle, and so does this.
 */

/** Where quoted history begins in plain text (the server uses the same rules for snippets). */
const QUOTE_START = [
  /^On .{4,240}wrote:\s*$/i,
  /^-{2,}\s*(Original|Forwarded) message\s*-*$/i,
  /^>/,
];

/** Plain text split into what this message says and what it quotes. */
export function splitTextQuote(text: string): { own: string; quoted: string | null } {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((line) => QUOTE_START.some((pattern) => pattern.test(line.trim())));
  if (cut === -1) return { own: text.trim(), quoted: null };
  const own = lines.slice(0, cut).join("\n").trim();
  const quoted = lines.slice(cut).join("\n").trim();
  return { own, quoted: quoted || null };
}

/** Selectors for quoted history as the common mail clients mark it. */
const HTML_QUOTE_SELECTORS = [".gmail_quote", "blockquote[type=cite]", "#divRplyFwdMsg", "#appendonsend", "blockquote"];

/**
 * HTML split into this message's own part and the quoted history after it.
 *
 * The history starts at the first quote block, and takes with it the
 * attribution line just before it ("On … wrote:"). Parsed with DOMParser,
 * which builds an inert document — nothing in the mail runs or loads.
 */
export function splitHtmlQuote(html: string): { own: string; quoted: string | null } {
  if (typeof DOMParser === "undefined") return { own: html, quoted: null };
  const doc = new DOMParser().parseFromString(html, "text/html");
  let quote: Element | null = null;
  for (const selector of HTML_QUOTE_SELECTORS) {
    quote = doc.body.querySelector(selector);
    if (quote) break;
  }
  if (!quote) return { own: html, quoted: null };

  // Climb to the element that is a direct child of <body>, so everything
  // from it onward is history and everything before it is the message.
  let top: Element = quote;
  while (top.parentElement && top.parentElement !== doc.body) top = top.parentElement;
  let start: Element = top;
  const before = top.previousElementSibling;
  if (before && /wrote:\s*$/i.test(before.textContent?.trim() ?? "")) start = before;

  const quotedParts: string[] = [];
  let node: ChildNode | null = start;
  while (node) {
    const next: ChildNode | null = node.nextSibling;
    quotedParts.push(node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : node.textContent ?? "");
    node.remove();
    node = next;
  }
  const own = doc.body.innerHTML.trim();
  const quoted = quotedParts.join("").trim();
  return { own, quoted: quoted || null };
}

/** A message's own words as one line, for a collapsed row. Empty when it only quotes. */
export function ownPreview(message: Pick<EmailMessage, "textBody" | "htmlBody">): string {
  let text = message.textBody ?? "";
  if (!text.trim() && message.htmlBody && typeof DOMParser !== "undefined") {
    const own = splitHtmlQuote(message.htmlBody).own;
    text = new DOMParser().parseFromString(own, "text/html").body.textContent ?? "";
    return text.replace(/\s+/g, " ").trim();
  }
  return splitTextQuote(text).own.replace(/\s+/g, " ").trim();
}

/**
 * Who a message is from, as one name used everywhere.
 *
 * The sender's display name when the mail has one. Otherwise the author's
 * name — but only for mail written in this workspace: mail received from
 * outside is stored with its recipient as the author, so that name would be
 * the reader's own. Failing both, the address.
 */
export function senderLabel(message: Pick<EmailMessage | EmailMessageSummary, "fromName" | "fromAddress" | "author" | "status">): string {
  if (message.fromName?.trim()) return message.fromName.trim();
  const internal = message.status !== "RECEIVED";
  if (internal && message.author?.displayName?.trim()) return message.author.displayName.trim();
  return message.fromAddress || message.author?.email || "Unknown sender";
}

/** The address to show beside the name, when it adds something. */
export function senderAddress(message: Pick<EmailMessage, "fromAddress" | "author">): string | null {
  return message.fromAddress || message.author?.email || null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Plain text with "> " quoting as HTML with nested blockquotes, so a reply to
 * a reply shows each earlier message one level further in — instead of a
 * blockquote full of literal "&gt;" marks.
 */
export function quotedTextToHtml(text: string): string {
  const lines = text.split(/\r?\n/);
  let html = "";
  let depth = 0;
  for (const line of lines) {
    const match = /^((?:>\s?)*)(.*)$/.exec(line)!;
    const level = (match[1].match(/>/g) ?? []).length;
    while (depth < level) {
      html += "<blockquote>";
      depth += 1;
    }
    while (depth > level) {
      html += "</blockquote>";
      depth -= 1;
    }
    html += `${escapeHtml(match[2])}<br>`;
  }
  while (depth > 0) {
    html += "</blockquote>";
    depth -= 1;
  }
  return html.replace(/(<br>)+(<\/blockquote>)/g, "$2");
}
