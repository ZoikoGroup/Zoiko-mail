import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

interface StorageContext {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
  email: string;
}

/**
 * What a copy of a message weighs: its subject and bodies plus every
 * attachment. One expression, so the breakdown, the largest-messages list and
 * the recalculation can never disagree about a message's size.
 */
const MESSAGE_BYTES = Prisma.sql`(
  octet_length(m."subject")
  + octet_length(coalesce(m."text_body", ''))
  + octet_length(coalesce(m."html_body", ''))
  + coalesce((SELECT sum(a."size_bytes") FROM "message_attachments" a WHERE a."message_id" = m."id"), 0)
)`;

const LARGEST = 8;

/**
 * The person's own storage, itemised. The meter in the rail only shows a
 * total; this says where it went, so a full mailbox can be fixed.
 */
export class StorageService {
  private async mailboxOf(context: StorageContext) {
    return prisma.mailbox.upsert({
      where: { membershipId: context.membershipId, tenantId: context.tenantId },
      create: { tenantId: context.tenantId, membershipId: context.membershipId, address: context.email.toLowerCase() },
      update: {},
      select: { id: true, address: true, storageUsed: true, storageLimit: true },
    });
  }

  async overview(context: StorageContext) {
    const mailbox = await this.mailboxOf(context);

    const folders = await prisma.$queryRaw<Array<{ folder: string; messages: bigint; bytes: bigint }>>(Prisma.sql`
      SELECT mm."folder"::text AS folder, count(*) AS messages, coalesce(sum(${MESSAGE_BYTES}), 0) AS bytes
      FROM "mailbox_messages" mm
      JOIN "email_messages" m ON m."id" = mm."message_id"
      WHERE mm."mailbox_id" = ${mailbox.id}::uuid AND mm."tenant_id" = ${context.tenantId}::uuid
      GROUP BY mm."folder"
    `);

    const largest = await prisma.$queryRaw<
      Array<{ id: string; subject: string; folder: string; from_address: string | null; created_at: Date; bytes: bigint; attachments: bigint }>
    >(Prisma.sql`
      SELECT m."id", m."subject", mm."folder"::text AS folder, m."from_address", mm."created_at",
             ${MESSAGE_BYTES} AS bytes,
             (SELECT count(*) FROM "message_attachments" a WHERE a."message_id" = m."id") AS attachments
      FROM "mailbox_messages" mm
      JOIN "email_messages" m ON m."id" = mm."message_id"
      WHERE mm."mailbox_id" = ${mailbox.id}::uuid AND mm."tenant_id" = ${context.tenantId}::uuid
      ORDER BY bytes DESC, mm."created_at" DESC
      LIMIT ${LARGEST}
    `);

    const attachmentTotals = await prisma.$queryRaw<Array<{ files: bigint; bytes: bigint }>>(Prisma.sql`
      SELECT count(*) AS files, coalesce(sum(a."size_bytes"), 0) AS bytes
      FROM "mailbox_messages" mm
      JOIN "message_attachments" a ON a."message_id" = mm."message_id"
      WHERE mm."mailbox_id" = ${mailbox.id}::uuid AND mm."tenant_id" = ${context.tenantId}::uuid
    `);

    const used = Number(mailbox.storageUsed);
    const limit = Number(mailbox.storageLimit);
    const itemised = folders.reduce((sum, row) => sum + Number(row.bytes), 0);
    return {
      address: mailbox.address,
      usedBytes: used,
      limitBytes: limit,
      freeBytes: Math.max(0, limit - used),
      /** Past the limit, new mail cannot be stored and attachments are refused. */
      full: used >= limit,
      /** The itemised total, which can differ from usedBytes until Recalculate is run. */
      itemisedBytes: itemised,
      folders: folders
        .map((row) => ({ folder: row.folder, messages: Number(row.messages), bytes: Number(row.bytes) }))
        .sort((a, b) => b.bytes - a.bytes),
      attachments: { files: Number(attachmentTotals[0]?.files ?? 0), bytes: Number(attachmentTotals[0]?.bytes ?? 0) },
      largest: largest.map((row) => ({
        id: row.id,
        subject: row.subject,
        folder: row.folder,
        from: row.from_address,
        date: row.created_at,
        bytes: Number(row.bytes),
        attachments: Number(row.attachments),
      })),
    };
  }

  /**
   * Sets the stored usage to what the mailbox actually holds. Usage is bumped
   * as mail arrives and eased down as drafts are purged, so it drifts; this
   * is the one place that makes it exact again.
   */
  async recalculate(context: StorageContext) {
    await this.syncUsage(context);
    return this.overview(context);
  }

  /** The recount alone, for callers that free space (emptying Trash) and need the meter to follow. */
  async syncUsage(context: StorageContext): Promise<void> {
    const mailbox = await this.mailboxOf(context);
    const [row] = await prisma.$queryRaw<Array<{ bytes: bigint }>>(Prisma.sql`
      SELECT coalesce(sum(${MESSAGE_BYTES}), 0)::bigint AS bytes
      FROM "mailbox_messages" mm
      JOIN "email_messages" m ON m."id" = mm."message_id"
      WHERE mm."mailbox_id" = ${mailbox.id}::uuid AND mm."tenant_id" = ${context.tenantId}::uuid
    `);
    const bytes = row?.bytes ?? 0n;
    await prisma.mailbox.update({
      where: { id: mailbox.id, tenantId: context.tenantId },
      data: { storageUsed: bytes },
    });
  }
}

export const storageService = new StorageService();
