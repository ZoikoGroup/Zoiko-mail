import type { Prisma } from "@prisma/client";

export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

export function uniqueParticipants(addresses: string[]): string[] {
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()))].sort();
}

/* ── list-response data minimization ──────────────────────────────────────
 *
 * API §9, API-007, SEC-008, DG-003 and AC-011 all say the same thing: a list
 * endpoint returns metadata and a short snippet, never a full message body.
 * Every list surface used to return the whole body — `GET /mail`,
 * `GET /messages` and `GET /threads` — so a folder of 25 messages shipped 25
 * complete emails to render a subject line and a paperclip icon.
 *
 * The threads screen made the cost visible: it took the full body and did
 * `.slice(0, 140)` in the browser. The 140 characters were the requirement;
 * the rest was exposure.
 *
 * Detail-by-id reads are deliberately not affected. §13 permits a full body on
 * `GET /messages/{id}` and `GET /mail/{id}` "if caller has access and tenant
 * policy permits", which is where the reading pane gets its content.
 */

/** How much of a body a list row may carry as a preview. */
export const SNIPPET_LENGTH = 160;

/**
 * The fields a list row may carry.
 *
 * MUST be paired with `toListMessage`. The select deliberately pulls
 * `textBody`/`htmlBody` because a snippet has to be cut from something, and
 * the mapper is what removes them again — the body is read inside the process
 * and never reaches the response. Using this select without the mapper would
 * reintroduce exactly the defect it exists to fix, so
 * `mail.list-minimization.test.ts` asserts no list response carries a body.
 */
export const messageListSelect = {
  id: true,
  tenantId: true,
  threadId: true,
  authorUserId: true,
  subject: true,
  status: true,
  sentAt: true,
  scheduledAt: true,
  scheduleLastError: true,
  createdAt: true,
  updatedAt: true,
  fromAddress: true,
  fromName: true,
  // Warnings are a webmail requirement (Hosted Mail §11) and are metadata.
  spamStatus: true,
  malwareStatus: true,
  quarantinedAt: true,
  quarantineReason: true,
  securityFlags: true,
  // Stripped by the mapper; present only so a snippet can be cut.
  textBody: true,
  htmlBody: true,
  author: { select: { id: true, email: true, displayName: true } },
  // Participants are permitted in a list. BCC is filtered per viewer below.
  recipients: {
    select: {
      id: true,
      email: true,
      type: true,
      deliveryStatus: true,
      recipientMembershipId: true,
    },
    orderBy: [{ type: "asc" as const }, { email: "asc" as const }],
  },
  // §9 allows `has_attachments`, not the attachment list. A count answers the
  // paperclip and the "3 attachments" label without naming the files.
  _count: { select: { attachments: true } },
} satisfies Prisma.EmailMessageSelect;

export type MessageListRow = Prisma.EmailMessageGetPayload<{
  select: typeof messageListSelect;
}>;

/** Visible text from an HTML part, for mail that has no plain-text body. */
function textFromHtml(html: string): string {
  return html
    // Script and style hold no readable text and plenty of noise.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * A one-line preview, or null when there is nothing to preview.
 *
 * Whitespace is collapsed so a body that opens with blank lines or an
 * indented quote does not produce an empty-looking snippet.
 */
export function snippetFrom(
  textBody: string | null,
  htmlBody: string | null
): string | null {
  const source = textBody?.trim() ? textBody : htmlBody ? textFromHtml(htmlBody) : "";
  const collapsed = source.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > SNIPPET_LENGTH
    ? `${collapsed.slice(0, SNIPPET_LENGTH).trimEnd()}…`
    : collapsed;
}

/**
 * A list row: metadata, a snippet, an attachment count — and no body.
 *
 * `viewerUserId` decides BCC visibility. Only the author of a message may see
 * who was blind-copied on it; for anyone else those recipients are removed
 * rather than merely hidden in the UI.
 */
export function toListMessage(row: MessageListRow, viewerUserId: string) {
  const { textBody, htmlBody, _count, recipients, ...metadata } = row;
  return {
    ...metadata,
    snippet: snippetFrom(textBody, htmlBody),
    hasAttachments: _count.attachments > 0,
    attachmentCount: _count.attachments,
    recipients:
      metadata.authorUserId === viewerUserId
        ? recipients
        : recipients.filter((recipient) => recipient.type !== "BCC"),
  };
}
