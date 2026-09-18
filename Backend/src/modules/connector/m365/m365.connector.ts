import jwt from "jsonwebtoken";
import { ConfidentialClientApplication, type Configuration } from "@azure/msal-node";
import { env } from "../../../config/env.js";
import { prisma } from "../../../config/prisma.js";
import { AppError } from "../../../common/errors/AppError.js";
import { ErrorCodes } from "../../../common/errors/errorCodes.js";
import { logger } from "../../../config/logger.js";
import { normalizeSubject, uniqueParticipants } from "../../message/message.utils.js";
import { findOrCreateThread } from "../message.normalize.js";

/**
 * Microsoft 365 connector (ZM-BE-006): MSAL confidential-client OAuth +
 * Graph change-notification subscriptions + delta sync, normalizing messages
 * into the same EmailMessage / MessageThread models the other pipelines use.
 *
 * Tokens stay in the Secret Manager (local-equivalent under dev) via
 * `storeConnectorTokens` / `readConnectorTokens` — never in the database.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MS365_SCOPES = ["Mail.Read", "offline_access", "User.Read"];

interface MicrosoftUserInfo {
  id: string;
  mail?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
}

interface ImportTarget {
  id: string;
  tenantId: string;
  membership: { mailbox: { id: string }; user: { id: string } };
}

interface GraphMessage {
  id: string;
  conversationId?: string | null;
  subject?: string | null;
  from?: { emailAddress?: { address?: string | null; name?: string | null } } | null;
  toRecipients?: Array<{ emailAddress?: { address?: string | null } }> | null;
  ccRecipients?: Array<{ emailAddress?: { address?: string | null } }> | null;
  bodyPreview?: string | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  receivedDateTime?: string | null;
  isRead?: boolean | null;
  internetMessageId?: string | null;
  "@removed"?: { reason?: string } | null;
}

function msalConfig(): Configuration {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) {
    throw new AppError(
      "Microsoft 365 OAuth is not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_REDIRECT_URI in the backend .env file.",
      503,
      "OAUTH_NOT_CONFIGURED"
    );
  }
  return {
    auth: {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`,
    },
  };
}

function confidentialClient(): ConfidentialClientApplication {
  return new ConfidentialClientApplication(msalConfig());
}

const GRAPH_HEADERS = {
  "Content-Type": "application/json",
  'Client-Request-Id': "zoikomail-connector",
} as const;

class MicrosoftConnector {
  async authUrl(state: string): Promise<string> {
    if (!env.MICROSOFT_REDIRECT_URI) {
      throw new AppError("MICROSOFT_REDIRECT_URI is not configured", 503, "OAUTH_NOT_CONFIGURED");
    }
    const client = confidentialClient();
    const response = await client.getAuthCodeUrl({
      scopes: MS365_SCOPES,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
      state,
      prompt: "consent",
    });
    return response;
  }

  /** Exchanges the redirect code for tokens via the OAuth v2 token endpoint. */
  async acquireTokens(code: string): Promise<{ tokens: { accessToken: string; refreshToken?: string; expiresAt: number }; user: MicrosoftUserInfo }> {
    if (!env.MICROSOFT_REDIRECT_URI) {
      throw new AppError("MICROSOFT_REDIRECT_URI is not configured", 503, "OAUTH_NOT_CONFIGURED");
    }
    const response = await fetch(this.tokenEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID!,
        client_secret: env.MICROSOFT_CLIENT_SECRET!,
        code,
        redirect_uri: env.MICROSOFT_REDIRECT_URI,
        scope: MS365_SCOPES.join(" "),
        grant_type: "authorization_code",
      }),
    });
    const body = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token || !body.id_token) {
      throw new AppError(
        `Microsoft token exchange failed: ${body.error_description ?? body.error ?? "unknown error"}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    // The id_token JWT carries oid/sub, mail, upn and name for the account map.
    const claims = jwt.decode(body.id_token) as {
      oid?: string; sub?: string; mail?: string; upn?: string; name?: string;
    } | null;
    const userId = claims?.oid ?? claims?.sub;
    if (!userId) {
      throw new AppError("Microsoft token missing account id (oid/sub)", 400, ErrorCodes.VALIDATION_ERROR);
    }
    const user: MicrosoftUserInfo = {
      id: userId,
      mail: claims?.mail ?? null,
      userPrincipalName: claims?.upn ?? null,
      displayName: claims?.name ?? null,
    };
    if (!user.mail && !user.userPrincipalName) {
      throw new AppError("Microsoft account has no usable email address", 400, ErrorCodes.VALIDATION_ERROR);
    }
    return {
      tokens: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      },
      user,
    };
  }

  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
    const response = await fetch(this.tokenEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID!,
        client_secret: env.MICROSOFT_CLIENT_SECRET!,
        refresh_token: refreshToken,
        scope: MS365_SCOPES.join(" "),
        grant_type: "refresh_token",
      }),
    });
    const body = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new AppError(
        `Microsoft token refresh failed: ${body.error_description ?? body.error ?? "unknown error"}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? refreshToken,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
  }

  private tokenEndpoint(): string {
    return `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  }

  /** Registers a Graph change-notification subscription for the account's inbox. */
  async registerSubscription(accountId: string, tenantId: string): Promise<string> {
    const notificationUrl = env.MICROSOFT_NOTIFICATION_URL;
    if (!notificationUrl) {
      throw new AppError("MICROSOFT_NOTIFICATION_URL is not configured; Graph subscriptions cannot be created", 503, "OAUTH_NOT_CONFIGURED");
    }
    const accessToken = await this.accessTokenFor(accountId, tenantId);
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "MICROSOFT_365", status: { not: "DISCONNECTED" } },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    const principalId = account.providerAccountId;

    const response = await fetch(`${GRAPH_BASE}/subscriptions`, {
      method: "POST",
      headers: { ...GRAPH_HEADERS, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl,
        lifecycleNotificationUrl: notificationUrl,
        resource: `users/${principalId}/mailFolders/inbox/messages`,
        expirationDateTime: new Date(Date.now() + 3600_000 * 3).toISOString(),
        clientState: env.MICROSOFT_NOTIFICATION_CLIENT_STATE,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new AppError(`Graph subscription failed: ${text.slice(0, 300)}`, 502, "PROVIDER_ERROR");
    }
    const created = (await response.json()) as { id: string; expirationDateTime: string };
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        microsoftSubscriptionId: created.id,
        watchExpiresAt: new Date(created.expirationDateTime),
        status: "ACTIVE",
        lastErrorCode: null,
      },
    });
    logger.info({ accountId: account.id, subscriptionId: created.id }, "Microsoft Graph subscription registered");
    return created.id;
  }

  /** Refreshes subscriptions that are expired or about to expire. */
  async renewSubscriptions(beforeMs = 60 * 60 * 1000): Promise<number> {
    const soon = new Date(Date.now() + beforeMs);
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: "MICROSOFT_365",
        status: { in: ["ACTIVE", "DEGRADED"] },
        watchExpiresAt: { lt: soon },
      },
      select: { id: true, tenantId: true },
      take: 50,
    });
    let renewed = 0;
    for (const account of accounts) {
      try {
        await this.registerSubscription(account.id, account.tenantId);
        renewed += 1;
      } catch (error) {
        logger.warn({ accountId: account.id, error }, "Microsoft Graph subscription renewal failed");
      }
    }
    return renewed;
  }

  /** Deletes then re-creates a subscription (used on lifecycle events). */
  async resubscribe(accountId: string, tenantId: string): Promise<string> {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "MICROSOFT_365", status: { not: "DISCONNECTED" } },
      select: { id: true, tenantId: true },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    const accessToken = await this.accessTokenFor(account.id, account.tenantId);
    const current = await prisma.connectedAccount.findFirst({
      where: { id: account.id },
      select: { microsoftSubscriptionId: true },
    });
    if (current?.microsoftSubscriptionId) {
      await fetch(`${GRAPH_BASE}/subscriptions/${current.microsoftSubscriptionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { microsoftSubscriptionId: null },
    });
    return this.registerSubscription(account.id, account.tenantId);
  }

  /**
   * Incremental delta sync of the inbox. Without a stored delta link the first
   * run fetches the delta query from scratch (Graph returns a full page then a
   * delta link); every later run continues from the stored link.
   */
  async syncInbox(
    accountId: string,
    tenantId: string
  ): Promise<{ fetched: number; imported: number; deleted: number; nextDeltaLink: string | null }> {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "MICROSOFT_365", status: { not: "DISCONNECTED" } },
      include: { membership: { include: { mailbox: true, user: { select: { id: true } } } } },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    const mailbox = account.membership.mailbox;
    if (!mailbox) throw new AppError("Microsoft account has no mailbox to sync into", 409, ErrorCodes.CONFLICT);

    const target: ImportTarget = {
      id: account.id,
      tenantId: account.tenantId,
      membership: { mailbox: { id: mailbox.id }, user: { id: account.membership.user.id } },
    };

    const accessToken = await this.accessTokenFor(account.id, account.tenantId);
    const principalId = account.providerAccountId;

    const select = "id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,internetMessageId,bodyPreview";
    const urlBase = `${GRAPH_BASE}/users/${principalId}/mailFolders/inbox/messages/delta?&$select=${encodeURIComponent(select)}`;
    let url: string = account.microsoftDeltaLink ?? urlBase;

    const counts = { fetched: 0, imported: 0, deleted: 0 };
    let deltaLink: string | null = null;
    let pages = 0;

    while (url && pages < 20) {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new AppError(`Graph delta query failed: ${text.slice(0, 300)}`, 502, "PROVIDER_ERROR");
      }
      const page = (await response.json()) as {
        value?: GraphMessage[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      };
      for (const message of page.value ?? []) {
        if (message["@removed"]) {
          if (await this.softDeleteMessage(message.id)) counts.deleted += 1;
          continue;
        }
        counts.fetched += 1;
        if (await this.importMessage(target, message)) counts.imported += 1;
      }
      if (page["@odata.deltaLink"]) {
        deltaLink = page["@odata.deltaLink"];
      }
      url = page["@odata.nextLink"] ?? "";
      pages += 1;
    }

    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        microsoftDeltaLink: deltaLink ?? account.microsoftDeltaLink,
        lastSyncedAt: new Date(),
        status: "ACTIVE",
        lastErrorCode: null,
      },
    });
    return { fetched: counts.fetched, imported: counts.imported, deleted: counts.deleted, nextDeltaLink: deltaLink };
  }

  private async accessTokenFor(accountId: string, tenantId: string): Promise<string> {
    const { connectorService } = await import("../connector.service.js");
    return connectorService.getMicrosoftAccessToken(accountId, tenantId);
  }

  private async importMessage(account: ImportTarget, message: GraphMessage): Promise<boolean> {
    const subject = message.subject?.trim() || "(no subject)";
    const fromName = message.from?.emailAddress?.name ?? null;
    const fromAddress = (message.from?.emailAddress?.address ?? "").toLowerCase() || null;
    const toAddresses = (message.toRecipients ?? [])
      .map((r) => r.emailAddress?.address?.toLowerCase())
      .filter((a): a is string => !!a);
    const ccAddresses = (message.ccRecipients ?? [])
      .map((r) => r.emailAddress?.address?.toLowerCase())
      .filter((a): a is string => !!a);
    const recipients = [
      ...toAddresses.map((email) => ({ email, type: "TO" as const })),
      ...ccAddresses.map((email) => ({ email, type: "CC" as const })),
    ];
    const sentAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
    const isRead = message.isRead === true;
    const providerMessageId = message.id;

    const exists = await prisma.emailMessage.findUnique({
      where: {
        tenantId_providerType_providerMessageId: {
          tenantId: account.tenantId,
          providerType: "MICROSOFT_365",
          providerMessageId,
        },
      },
      select: { id: true },
    });
    if (exists) return false;

    const participants = uniqueParticipants([...(fromAddress ? [fromAddress] : []), ...toAddresses, ...ccAddresses]);

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
          providerType: "MICROSOFT_365",
          providerMessageId,
          providerUid: message.internetMessageId ?? message.id,
          fromAddress,
          fromName,
          textBody: message.bodyPreview ?? null,
          htmlBody: null,
          securityFlags: { conversationId: message.conversationId ?? null },
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
        payload: { messageId: providerMessageId, threadId: message.conversationId ?? null },
        idempotencyKey: `ai-extract-${providerMessageId}`,
      });
    }
    return true;
  }

  private async softDeleteMessage(messageId: string): Promise<boolean> {
    const message = await prisma.emailMessage.findFirst({
      where: { providerType: "MICROSOFT_365", providerMessageId: messageId },
      select: { id: true, tenantId: true },
    });
    if (!message) return false;
    await prisma.mailboxMessage.updateMany({
      where: { tenantId: message.tenantId, messageId: message.id, folder: "INBOX" },
      data: { folder: "TRASH", isRead: true },
    });
    return true;
  }
}

export const microsoftConnector = new MicrosoftConnector();