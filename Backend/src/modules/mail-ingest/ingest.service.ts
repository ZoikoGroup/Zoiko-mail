import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { sseManager } from "../../common/sse/sse.manager.js";
import { auditService } from "../audit/audit.service.js";
import { participantService } from "../participant/participant.service.js";
import { normalizeSubject, uniqueParticipants } from "../message/message.utils.js";
import { attachmentStorage } from "../mail/attachment.storage.js";

/**
 * Receiving mail from the internet — decision D1, the ingest core
 * (implementation guide v2.5 §5.2).
 *
 * The inbound edge (a Cloudflare Email Worker in the pilot, Stalwart over
 * LMTP later) has already accepted the message on port 25. It hands Zoiko the
 * raw RFC 5322 message and the envelope recipients, signed with a shared
 * secret. This resolves each recipient to a mailbox — by address or alias, in
 * whichever workspace owns it — and stores one copy per workspace with a
 * placement in each recipient mailbox's INBOX.
 *
 * Re-delivery is safe: the edge retries until it gets an answer, so the same
 * Message-ID arriving again is acknowledged, not stored twice.
 */

export const INBOUND_PROVIDER_TYPE = "INBOUND";

export type RecipientOutcome = { address: string; status: "DELIVERED" | "DUPLICATE" | "UNKNOWN" };

interface Target {
  address: string;
  mailbox: { id: string; tenantId: string; address: string };
  /** Who the stored copy is attributed to: the mailbox owner, or for a shared mailbox a workspace owner. */
  authorUserId: string;
  /** Told live when it arrives; null for a shared mailbox. */
  ownerUserId: string | null;
}

export class IngestService {
  // ── authentication ───────────────────────────────────────────────────────

  /**
   * HMAC-SHA256 over `<timestamp>.<recipients>.<raw message>`, hex, with
   * INBOUND_WEBHOOK_SECRET. The timestamp bounds replays; the recipients are
   * signed too, so a captured message cannot be re-aimed at other mailboxes.
   */
  static sign(secret: string, timestamp: string, recipients: string, raw: Buffer): string {
    return createHmac("sha256", secret).update(`${timestamp}.${recipients}.`).update(raw).digest("hex");
  }

  verify(raw: Buffer, headers: { timestamp?: string; signature?: string; recipients?: string }): string[] {
    const secret = env.INBOUND_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError("Inbound mail is not configured on this deployment", 503, ErrorCodes.INBOUND_NOT_CONFIGURED);
    }
    const { timestamp, signature, recipients } = headers;
    const refuse = () => {
      throw new AppError("The inbound request signature is not valid", 401, ErrorCodes.INBOUND_SIGNATURE_INVALID);
    };
    if (!timestamp || !signature || !recipients || !/^\d+$/.test(timestamp)) refuse();
    if (Math.abs(Date.now() - Number(timestamp)) > env.INBOUND_SIGNATURE_TOLERANCE_MS) refuse();
    const expected = Buffer.from(IngestService.sign(secret, timestamp!, recipients!, raw), "hex");
    const given = Buffer.from(signature!, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) refuse();

    const list = recipients!
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter((address) => /^[^\s@]+@[^\s@]+$/.test(address));
    if (list.length === 0 || list.length > 100) refuse();
    return [...new Set(list)];
  }

  // ── recipients ───────────────────────────────────────────────────────────

  /**
   * The mailbox an envelope recipient reaches, across every workspace.
   *
   * Addresses are unique per workspace, not globally, so when two workspaces
   * hold the same address the one that has verified the domain wins; if that
   * still leaves more than one (or none), the address reaches nobody rather
   * than the wrong workspace.
   */
  private async resolve(address: string): Promise<Target | null> {
    const candidates = await prisma.mailbox.findMany({
      where: { address: { equals: address, mode: "insensitive" }, deletionRequestedAt: null },
      select: {
        id: true, tenantId: true, address: true, membershipId: true,
        membership: { select: { userId: true, status: true, user: { select: { status: true } } } },
        domain: { select: { verificationStatus: true } },
      },
    });
    const usable = candidates.filter((mailbox) =>
      mailbox.membershipId === null ||
      (mailbox.membership &&
        ["ACTIVE", "INVITED"].includes(mailbox.membership.status) &&
        ["ACTIVE", "INVITED"].includes(mailbox.membership.user.status))
    );
    let chosen = usable.length === 1 ? usable[0]! : null;
    if (!chosen && usable.length > 1) {
      const verified = usable.filter((mailbox) => mailbox.domain?.verificationStatus === "VERIFIED");
      chosen = verified.length === 1 ? verified[0]! : null;
    }

    if (!chosen) {
      // An alias is globally unique, so it names one mailbox at most.
      const alias = await prisma.alias.findFirst({
        where: { address: { equals: address, mode: "insensitive" }, status: "ACTIVE", mailbox: { deletionRequestedAt: null } },
        select: {
          mailbox: {
            select: {
              id: true, tenantId: true, address: true, membershipId: true,
              membership: { select: { userId: true, status: true, user: { select: { status: true } } } },
            },
          },
        },
      });
      const target = alias?.mailbox;
      if (!target) return null;
      if (target.membership && !["ACTIVE", "INVITED"].includes(target.membership.status)) return null;
      chosen = { ...target, domain: null };
    }

    if (chosen.membership) {
      return {
        address,
        mailbox: { id: chosen.id, tenantId: chosen.tenantId, address: chosen.address },
        authorUserId: chosen.membership.userId,
        ownerUserId: chosen.membership.userId,
      };
    }
    // A shared mailbox has no owner; the copy is attributed to a workspace owner.
    const owner = await prisma.tenantMembership.findFirst({
      where: { tenantId: chosen.tenantId, role: "OWNER", status: "ACTIVE" },
      select: { userId: true },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return null;
    return { address, mailbox: { id: chosen.id, tenantId: chosen.tenantId, address: chosen.address }, authorUserId: owner.userId, ownerUserId: null };
  }

  // ── storage ──────────────────────────────────────────────────────────────

  async ingest(raw: Buffer, envelopeRecipients: string[], envelopeFrom: string | null): Promise<RecipientOutcome[]> {
    if (raw.length > env.INBOUND_MAX_MESSAGE_BYTES) {
      throw new AppError("The message is larger than this deployment accepts", 413, ErrorCodes.VALIDATION_ERROR);
    }
    return withCrossTenant(async () => {
      const outcomes = new Map<string, RecipientOutcome>();
      const targets: Target[] = [];
      for (const address of envelopeRecipients) {
        const target = await this.resolve(address);
        if (target) targets.push(target);
        else outcomes.set(address, { address, status: "UNKNOWN" });
      }
      if (targets.length === 0) return envelopeRecipients.map((address) => outcomes.get(address)!);

      const parsed = await simpleParser(raw);
      const internetMessageId =
        parsed.messageId?.trim() || `<${createHash("sha256").update(raw).digest("hex")}@ingest.zoiko>`;

      // One stored copy per workspace; one INBOX placement per mailbox.
      const byTenant = new Map<string, Target[]>();
      for (const target of targets) {
        // The same mailbox reached twice (an address and its alias) is one delivery.
        const group = byTenant.get(target.mailbox.tenantId) ?? [];
        if (!group.some((existing) => existing.mailbox.id === target.mailbox.id)) group.push(target);
        else outcomes.set(target.address, { address: target.address, status: "DUPLICATE" });
        byTenant.set(target.mailbox.tenantId, group);
      }

      const notify: Array<{ userId: string; tenantId: string; messageId: string }> = [];
      for (const [tenantId, group] of byTenant) {
        const stored = await this.storeForTenant(tenantId, group, parsed, raw, internetMessageId, envelopeFrom);
        for (const result of stored) {
          if (!outcomes.has(result.address)) outcomes.set(result.address, { address: result.address, status: result.status });
          if (result.status === "DELIVERED" && result.ownerUserId) {
            notify.push({ userId: result.ownerUserId, tenantId, messageId: result.messageId });
          }
        }
      }

      for (const item of notify) {
        sseManager.sendToUser(item.userId, {
          type: "NEW_MAIL",
          tenantId: item.tenantId,
          userId: item.userId,
          payload: { count: 1, folder: "INBOX", messageId: item.messageId },
        });
      }
      return envelopeRecipients.map((address) => outcomes.get(address) ?? { address, status: "UNKNOWN" as const });
    });
  }

  private async storeForTenant(
    tenantId: string,
    group: Target[],
    parsed: ParsedMail,
    raw: Buffer,
    internetMessageId: string,
    envelopeFrom: string | null
  ) {
    const existing = await prisma.emailMessage.findUnique({
      where: { tenantId_providerType_providerMessageId: { tenantId, providerType: INBOUND_PROVIDER_TYPE, providerMessageId: internetMessageId } },
      select: { id: true },
    });
    if (existing) return this.placeExisting(tenantId, group, existing.id);

    // Files first: they are outside the transaction, and removed again if it fails.
    const saved: Array<{ fileName: string; contentType: string; sizeBytes: number; storageKey: string }> = [];
    for (const attachment of parsed.attachments ?? []) {
      saved.push({
        fileName: attachment.filename || "attachment",
        contentType: attachment.contentType || "application/octet-stream",
        sizeBytes: attachment.size ?? attachment.content.length,
        storageKey: await attachmentStorage.save(attachment.content),
      });
    }

    const sender = firstAddress(parsed.from);
    const to = addresses(parsed.to);
    const cc = addresses(parsed.cc);
    const receivedAt = new Date();
    try {
      const messageId = await prisma.$transaction(async (tx) => {
        // A reply joins the conversation it answers, matched on the ids our
        // own sent mail carries (relay) or earlier inbound mail had.
        const referenced = [
          ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
          ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
        ];
        const parent = referenced.length
          ? await tx.emailMessage.findFirst({
            where: { tenantId, providerMessageId: { in: referenced }, threadId: { not: null } },
            select: { threadId: true },
            orderBy: { createdAt: "desc" },
          })
          : null;
        const subject = parsed.subject || "(no subject)";
        const threadId = parent?.threadId ?? (await tx.messageThread.create({
          data: {
            tenantId,
            subjectNormalized: normalizeSubject(subject),
            participants: uniqueParticipants([...(sender ? [sender.address] : []), ...to.map((a) => a.address), ...cc.map((a) => a.address)]),
            firstMessageAt: receivedAt,
            lastMessageAt: receivedAt,
          },
          select: { id: true },
        })).id;

        const mailboxIds = new Set(group.map((target) => target.mailbox.id));
        const message = await tx.emailMessage.create({
          data: {
            tenantId,
            authorUserId: group[0]!.authorUserId,
            threadId,
            subject,
            textBody: parsed.text?.trim() || null,
            htmlBody: typeof parsed.html === "string" ? parsed.html : null,
            status: "RECEIVED",
            sentAt: parsed.date ?? receivedAt,
            providerType: INBOUND_PROVIDER_TYPE,
            providerMessageId: internetMessageId,
            fromAddress: sender?.address ?? envelopeFrom,
            fromName: sender?.name || null,
            securityFlags: { inbound: true, envelopeFrom, size: raw.length },
            recipients: {
              create: [
                ...to.map((a) => ({ tenantId, email: a.address, type: "TO" as const, deliveryStatus: "DELIVERED" as const })),
                ...cc.map((a) => ({ tenantId, email: a.address, type: "CC" as const, deliveryStatus: "DELIVERED" as const })),
              ],
            },
            mailboxItems: { create: [...mailboxIds].map((mailboxId) => ({ tenantId, mailboxId, folder: "INBOX" as const })) },
            attachments: { create: saved.map((file) => ({ tenantId, ...file })) },
          },
          select: { id: true },
        });

        const participants = await participantService.recordThreadParticipation(
          {
            tenantId,
            threadId,
            messageId: message.id,
            addresses: [
              ...(sender ? [{ email: sender.address, displayName: sender.name || null, role: "SENDER" as const }] : []),
              ...to.map((a) => ({ email: a.address, displayName: a.name || null, role: "RECIPIENT" as const })),
              ...cc.map((a) => ({ email: a.address, displayName: a.name || null, role: "CC" as const })),
            ],
          },
          tx
        );
        await tx.messageThread.update({ where: { id: threadId, tenantId }, data: { participants, lastMessageAt: receivedAt } });
        // Each copy counts against its mailbox's quota (§5.6).
        await tx.mailbox.updateMany({
          where: { id: { in: [...mailboxIds] }, tenantId },
          data: { storageUsed: { increment: BigInt(raw.length) } },
        });
        await auditService.record({
          tenantId,
          actorUserId: null,
          actorType: "SYSTEM",
          eventType: "INBOUND_MESSAGE_RECEIVED",
          targetType: "EmailMessage",
          targetId: message.id,
          metadata: { mailboxes: group.map((target) => target.mailbox.address), size: raw.length, attachments: saved.length },
        }, tx);
        return message.id;
      });
      return group.map((target) => ({ address: target.address, status: "DELIVERED" as const, ownerUserId: target.ownerUserId, messageId }));
    } catch (error) {
      await Promise.all(saved.map((file) => attachmentStorage.delete(file.storageKey).catch(() => undefined)));
      // Two deliveries of one message racing: the unique index decides, and
      // the loser places its copies on the winner's row.
      const raced = await prisma.emailMessage.findUnique({
        where: { tenantId_providerType_providerMessageId: { tenantId, providerType: INBOUND_PROVIDER_TYPE, providerMessageId: internetMessageId } },
        select: { id: true },
      });
      if (raced) return this.placeExisting(tenantId, group, raced.id);
      logger.error({ err: error, tenantId }, "Inbound message could not be stored");
      throw error;
    }
  }

  /** A re-delivered message: make sure each mailbox has it, and say which already did. */
  private async placeExisting(tenantId: string, group: Target[], messageId: string) {
    const results: Array<{ address: string; status: "DELIVERED" | "DUPLICATE"; ownerUserId: string | null; messageId: string }> = [];
    for (const target of group) {
      const placed = await prisma.mailboxMessage.findFirst({ where: { tenantId, mailboxId: target.mailbox.id, messageId }, select: { id: true } });
      if (!placed) {
        await prisma.mailboxMessage.create({ data: { tenantId, mailboxId: target.mailbox.id, messageId, folder: "INBOX" } });
      }
      results.push({ address: target.address, status: placed ? "DUPLICATE" : "DELIVERED", ownerUserId: target.ownerUserId, messageId });
    }
    return results;
  }
}

function addresses(value: AddressObject | AddressObject[] | undefined): Array<{ address: string; name: string }> {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((group) => group.value)
    .filter((entry): entry is typeof entry & { address: string } => Boolean(entry.address))
    .map((entry) => ({ address: entry.address.toLowerCase(), name: entry.name ?? "" }));
}

function firstAddress(value: AddressObject | undefined) {
  return addresses(value)[0] ?? null;
}

export const ingestService = new IngestService();
