import { google, type gmail_v1 } from "googleapis";
import { env } from "../../../config/env.js";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../common/errors/AppError.js";
import { ErrorCodes } from "../../../common/errors/errorCodes.js";
import { logger } from "../../../config/logger.js";
import { normalizeSubject, uniqueParticipants } from "../../message/message.utils.js";
import {
  findOrCreateThread,
  parseAddressList,
  parseFromHeader,
} from "../message.normalize.js";

/**
 * Gmail connector (ZM-BE-005): `users.watch` registration + incremental
 * history sync, normalizing fetched mail into the same EmailMessage /
 * MessageThread models the IMAP provider-mail pipeline uses.
 *
 * Access tokens come from the connector service's existing
 * `getGoogleAccessToken` (dynamic import breaks the module cycle), so refresh
 * and reauthorization marking stay in one place.
 */

export interface GmailWatchRegistration {
  historyId: string;
  expiresAt: string;
}

interface ImportTarget {
  id: string;
  tenantId: string;
  membership: { mailbox: { id: string }; user: { id: string } };
}

class GmailConnector {
  private async accessTokenFor(accountId: string, tenantId: string): Promise<string> {
    const { connectorService } = await import("../connector.service.js");
    return connectorService.getGoogleAccessToken(accountId, tenantId);
  }

  private async clientFor(accountId: string, tenantId: string): Promise<gmail_v1.Gmail> {
    const accessToken = await this.accessTokenFor(accountId, tenantId);
    const oauth2 = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    oauth2.setCredentials({ access_token: accessToken });
    return google.gmail({ version: "v1", auth: oauth2 });
  }

  /** Registers `users.watch` so Google pushes Pub/Sub changes for the mailbox. */
  async registerWatch(accountId: string, tenantId: string): Promise<GmailWatchRegistration> {
    const topic = env.GMAIL_PUBSUB_TOPIC;
    if (!topic) {
      throw new AppError(
        "GMAIL_PUBSUB_TOPIC is not configured; users.watch cannot be registered",
        503,
        "OAUTH_NOT_CONFIGURED"
      );
    }
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "GMAIL", status: { not: "DISCONNECTED" } },
      select: { id: true, tenantId: true },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);

    const gmail = await this.clientFor(account.id, account.tenantId);
    const response = await gmail.users.watch({
      userId: "me",
      requestBody: { topicName: topic, labelIds: ["INBOX"] },
    });
    const historyId = String(response.data.historyId ?? "");
    const expiresAt = Number(response.data.expiration ?? 0);
    if (!historyId || !expiresAt) {
      throw new AppError("Gmail watch response was incomplete", 502, "PROVIDER_ERROR");
    }
    const expiry = new Date(expiresAt);
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { watchExpiresAt: expiry, status: "ACTIVE", lastErrorCode: null },
    });
    logger.info({ accountId: account.id, expiresAt: expiry.toISOString() }, "Gmail users.watch registered");
    return { historyId, expiresAt: expiry.toISOString() };
  }

  /** Renews watches that are expired or about to expire within `beforeMs`. */
  async renewExpiringWatches(beforeMs = 60 * 60 * 1000): Promise<number> {
    const soon = new Date(Date.now() + beforeMs);
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: "GMAIL",
        status: { in: ["ACTIVE", "DEGRADED"] },
        watchExpiresAt: { lt: soon },
      },
      select: { id: true, tenantId: true },
      take: 50,
    });
    let renewed = 0;
    for (const account of accounts) {
      try {
        await this.registerWatch(account.id, account.tenantId);
        renewed += 1;
      } catch (error) {
        logger.warn({ accountId: account.id, error }, "Gmail watch renewal failed");
      }
    }
    return renewed;
  }

  /**
   * Incremental history sync. First sync (or when the checkpoint is absent)
   * backfills the most recent INBOX messages; afterwards it replays history
   * records (messageAdded / messageDeleted) from the last checkpoint. Idempotent
   * thanks to the unique (tenant, providerType, providerMessageId) constraint
   * and the checkpoint that only advances per committed page.
   */
  async syncHistory(
    accountId: string,
    tenantId: string,
    startHistoryId?: string
  ): Promise<{ fetched: number; imported: number; deleted: number; checkpointHistoryId: number | null }> {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "GMAIL", status: { not: "DISCONNECTED" } },
      include: { membership: { include: { mailbox: true, user: { select: { id: true } } } } },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    const mailbox = account.membership.mailbox;
    if (!mailbox) throw new AppError("Gmail account has no mailbox to sync into", 409, ErrorCodes.CONFLICT);

    const target: ImportTarget = {
      id: account.id,
      tenantId: account.tenantId,
      membership: { mailbox: { id: mailbox.id }, user: { id: account.membership.user.id } },
    };

    let checkpoint = startHistoryId ? BigInt(startHistoryId) : null;
    const result = { fetched: 0, imported: 0, deleted: 0, checkpointHistoryId: null as number | null };

    if (checkpoint === null || checkpoint <= 0n) {
      // First run: backfill recent INBOX messages, then adopt the current
      // profile historyId so future runs are incremental.
      const gmail = await this.clientFor(account.id, account.tenantId);
      const list = await gmail.users.messages.list({ userId: "me", maxResults: 50, labelIds: ["INBOX"] });
      for (const message of list.data.messages ?? []) {
        if (!message.id) continue;
        result.fetched += 1;
        if (await this.importMessage(target, message.id)) result.imported += 1;
      }
      const profile = await gmail.users.getProfile({ userId: "me" });
      checkpoint = BigInt(String(profile.data.historyId ?? "0"));
      result.checkpointHistoryId = Number(checkpoint);
    } else {
      const applied = await this.applyHistory(target, checkpoint);
      result.fetched = applied.fetched;
      result.imported = applied.imported;
      result.deleted = applied.deleted;
      result.checkpointHistoryId = Number(applied.checkpoint);
    }

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date(), status: "ACTIVE", lastErrorCode: null },
    });
    return result;
  }

  private async applyHistory(
    account: ImportTarget,
    startHistoryId: bigint
  ): Promise<{ fetched: number; imported: number; deleted: number; checkpoint: bigint }> {
    const gmail = await this.clientFor(account.id, account.tenantId);
    let pageToken: string | undefined;
    let checkpoint = startHistoryId;
    const counts = { fetched: 0, imported: 0, deleted: 0 };

    do {
      const response = await gmail.users.history.list({
        userId: "me",
        startHistoryId: String(checkpoint),
        pageToken,
        maxResults: env.GMAIL_HISTORY_PAGE_SIZE,
        historyTypes: ["messageAdded", "messageDeleted"],
      });

      for (const record of response.data.history ?? []) {
        const recordId = BigInt(String(record.id ?? "0"));
        if (recordId > checkpoint) checkpoint = recordId;
        for (const entry of record.messagesAdded ?? []) {
          const id = entry.message?.id;
          if (!id) continue;
          counts.fetched += 1;
          if (await this.importMessage(account, id)) counts.imported += 1;
        }
        for (const entry of record.messagesDeleted ?? []) {
          const id = entry.message?.id;
          if (!id) continue;
          if (await this.handleDeletedMessage(account, id)) counts.deleted += 1;
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return { ...counts, checkpoint };
  }

  /** Imports one Gmail message into EmailMessage + MessageThread. Returns true when new. */
  private async importMessage(account: ImportTarget, messageId: string): Promise<boolean> {
    const gmail = await this.clientFor(account.id, account.tenantId);
    const response = await gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata" });
    const raw = response.data as gmail_v1.Schema$Message;
    const headers = Object.fromEntries((raw.payload?.headers ?? []).map((h) => [h.name?.toLowerCase(), h.value]));

    const subject = headers["subject"]?.trim() || "(no subject)";
    const fromValue = headers["from"] ?? "";
    const toValue = headers["to"] ?? "";
    const ccValue = headers["cc"] ?? "";
    const dateValue = headers["date"] ?? "";
    const isRead = !(raw.labelIds ?? []).includes("UNREAD");

    const { fromName, fromAddress } = parseFromHeader(fromValue);
    const toAddresses = parseAddressList(toValue);
    const ccAddresses = parseAddressList(ccValue);
    const recipients = [
      ...toAddresses.map((email) => ({ email, type: "TO" as const })),
      ...ccAddresses.map((email) => ({ email, type: "CC" as const })),
    ];
    const sentAt = dateValue ? new Date(dateValue) : new Date(Number(raw.internalDate ?? Date.now()));

    const exists = await prisma.emailMessage.findUnique({
      where: {
        tenantId_providerType_providerMessageId: {
          tenantId: account.tenantId,
          providerType: "GMAIL",
          providerMessageId: raw.id!,
        },
      },
      select: { id: true },
    });
    if (exists) return false;

    const participants = uniqueParticipants([
      ...(fromAddress ? [fromAddress] : []),
      ...toAddresses,
      ...ccAddresses,
    ]);

    await prisma.$transaction(async (tx) => {
      const thread = await findOrCreateThread(tx, {
        tenantId: account.tenantId,
        subjectNormalized: normalizeSubject(subject),
        participants,
        lastMessageAt: sentAt,
      });
      await tx.emailMessage.create({
        data: {
          tenantId: account.tenantId,
          authorUserId: account.membership.user.id,
          threadId: thread.id,
          subject,
          status: "RECEIVED",
          sentAt,
          providerType: "GMAIL",
          providerMessageId: raw.id!,
          providerUid: raw.id!,
          fromAddress,
          fromName,
          textBody: extractTextBody(raw.payload),
          htmlBody: extractHtmlBody(raw.payload),
          securityFlags: { snippet: raw.snippet ?? null },
          recipients: {
            create: recipients.map((recipient) => ({
              tenantId: account.tenantId,
              email: recipient.email,
              type: recipient.type,
              deliveryStatus: "DELIVERED",
            })),
          },
          mailboxItems: {
            create: {
              tenantId: account.tenantId,
              mailboxId: account.membership.mailbox.id,
              folder: "INBOX",
              isRead,
            },
          },
        },
      });
      await tx.messageThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
      });
    });

    // Offload AI extraction to the background queue so mail ingestion is never
    // blocked (ZM-BE-007). Idempotent per message via the idempotency key.
    if (env.FLAG_AI_EXTRACTION_ENABLED) {
      const { jobService } = await import("../../job/job.service.js");
      await jobService.enqueue({
        tenantId: account.tenantId,
        userId: account.membership.user.id,
        type: "AI_EXTRACTION",
        payload: { messageId: raw.id, threadId: raw.threadId ?? null },
        idempotencyKey: `ai-extract-${raw.id}`,
      });
    }
    return true;
  }

  /** Soft-deletes a Gmail message: mailbox copy to TRASH, record retained. */
  private async handleDeletedMessage(account: ImportTarget, messageId: string): Promise<boolean> {
    const message = await prisma.emailMessage.findFirst({
      where: { tenantId: account.tenantId, providerType: "GMAIL", providerMessageId: messageId },
      select: { id: true },
    });
    if (!message) return false;
    await prisma.mailboxMessage.updateMany({
      where: { tenantId: account.tenantId, messageId: message.id, folder: "INBOX" },
      data: { folder: "TRASH", isRead: true },
    });
    return true;
  }
}

export const gmailConnector = new GmailConnector();

// ─── body extraction (Gmail-specific payload shapes) ────────────────────────

function extractTextBody(payload?: gmail_v1.Schema$MessagePart): string | null {
  const text = collectParts(payload, "text/plain");
  return text.length > 0 ? text.join("\n").slice(0, 100_000) : null;
}

function extractHtmlBody(payload?: gmail_v1.Schema$MessagePart): string | null {
  const html = collectParts(payload, "text/html");
  return html.length > 0 ? html.join("\n").slice(0, 500_000) : null;
}

function collectParts(payload: gmail_v1.Schema$MessagePart | undefined, mime: string): string[] {
  if (!payload) return [];
  const out: string[] = [];
  if (payload.mimeType === mime && payload.body?.data) {
    out.push(Buffer.from(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  }
  for (const part of payload.parts ?? []) {
    out.push(...collectParts(part, mime));
  }
  return out;
}