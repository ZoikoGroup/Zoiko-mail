import { Prisma } from "@prisma/client";

/**
 * Shared normalization helpers used by the Gmail and Microsoft 365
 * connectors. Both sync pipelines produce the same EmailMessage /
 * MessageThread / MailboxMessage shapes so the read side stays provider-agnostic.
 */

export function parseFromHeader(header: string): { fromName: string | null; fromAddress: string | null } {
  const match = header.match(/^(.*?)(?:<([^>]+)>)?$/);
  const name = match?.[1]?.trim();
  const address = match?.[2]?.trim();
  return {
    fromName: name && name.length > 0 ? name : null,
    fromAddress: address ?? null,
  };
}

export function parseAddressList(header: string): string[] {
  if (!header.trim()) return [];
  return header
    .split(",")
    .map((part) => part.trim().replace(/^.*<([^>]+)>$/, "$1").trim())
    .filter((email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    .map((email) => email.toLowerCase());
}

/**
 * Reuses the existing conversation thread (normalized subject + participant
 * overlap) so replies join the thread the IMAP provider-mail pipeline would
 * otherwise create fresh.
 */
export async function findOrCreateThread(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    subjectNormalized: string;
    participants: string[];
    lastMessageAt: Date;
  }
): Promise<{ id: string }> {
  const existing = await tx.messageThread.findFirst({
    where: {
      tenantId: input.tenantId,
      subjectNormalized: input.subjectNormalized,
      participants: { array_contains: input.participants.slice(0, 2) },
    },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing;
  return tx.messageThread.create({
    data: {
      tenantId: input.tenantId,
      subjectNormalized: input.subjectNormalized,
      participants: input.participants,
      firstMessageAt: input.lastMessageAt,
      lastMessageAt: input.lastMessageAt,
    },
    select: { id: true },
  });
}