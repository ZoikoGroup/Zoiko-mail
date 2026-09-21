import { prisma } from "../../config/prisma.js";

/**
 * What a support view may show of a restricted mailbox — Runbook §7.
 *
 * §7 asks support views to "prefer metadata, status, error codes, hashes, and
 * excerpts over full content". Subject sits on the line: the Data Model spec
 * lists it as metadata alongside sender, recipient and timestamp — which is
 * why a delivery-triage screen showing "which message bounced" is legitimate
 * — but the column's own note is narrower:
 *
 *     subject — Subject; may be redacted by policy for restricted mailboxes.
 *
 * So the rule is not "hide subjects from support". It is "hide them for
 * restricted mailboxes", which is the same set AC-008 keeps away from AI. A
 * mailbox whose owner has turned processing off should not have its subject
 * lines readable on a console the owner never sees.
 *
 * Deliberately not applied to sender, recipient or timestamp: those are the
 * fields triage runs on, the spec names them as metadata without the caveat,
 * and removing them would make the delivery views useless while protecting
 * nothing the subject did not already give away.
 */

/** Shown in place of a subject the viewer is not entitled to read. */
export const REDACTED_SUBJECT = "[subject withheld — restricted mailbox]";

/**
 * Message ids that belong to at least one restricted mailbox.
 *
 * One query for the whole page rather than one per row: these views return up
 * to fifty messages, and a per-row check would turn a list into fifty-one
 * round trips. Returns an empty set for an empty input so callers do not have
 * to special-case it.
 */
export async function restrictedMessageIds(messageIds: string[]): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();

  const rows = await prisma.mailboxMessage.findMany({
    where: {
      messageId: { in: messageIds },
      mailbox: { aiEnabled: false },
    },
    select: { messageId: true },
  });

  return new Set(rows.map((row) => row.messageId));
}

/**
 * Replace the subject when the message belongs to a restricted mailbox.
 *
 * Takes the id alongside the subject because the caller has already shaped
 * its row; this keeps the decision in one place rather than repeated at each
 * of the six support views that surface a subject.
 */
export function redactSubject(
  subject: string | null | undefined,
  messageId: string | null | undefined,
  restricted: ReadonlySet<string>
): string | null {
  if (messageId && restricted.has(messageId)) return REDACTED_SUBJECT;
  return subject ?? null;
}
