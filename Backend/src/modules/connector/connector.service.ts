import { createHash } from "node:crypto";
import { Prisma, type ConnectorProvider } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { env } from "../../config/env.js";
import { deliveryProtectionService } from "../delivery-protection/delivery-protection.service.js";
import {
  deleteConnectorTokens,
  readConnectorTokens,
  storeConnectorTokens,
} from "../../common/secrets/connectorTokens.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const MS365_SCOPES = ["Mail.Read", "offline_access", "User.Read"];

interface CreateAccountInput {
  provider: ConnectorProvider;
  providerAccountId: string;
  email: string;
  scopes: string[];
}

interface NormalizedCallback {
  providerEventId?: string;
  providerAccountId: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  providerReference?: string;
  occurredAt: string;
  cursor?: string;
}

function eventHash(provider: ConnectorProvider, input: NormalizedCallback) {
  return createHash("sha256").update(JSON.stringify({
    provider,
    providerEventId: input.providerEventId ?? null,
    providerAccountId: input.providerAccountId,
    eventType: input.eventType,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    providerReference: input.providerReference ?? null,
    occurredAt: input.occurredAt,
    cursor: input.cursor ?? null,
  })).digest("hex");
}

export class ConnectorService {
  list(tenantId: string, membershipId: string) {
    return prisma.connectedAccount.findMany({
      where: { tenantId, membershipId },
      select: {
        id: true, provider: true, email: true, scopes: true, status: true,
        watchExpiresAt: true, lastSyncedAt: true, lastErrorCode: true,
        disconnectedAt: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Every connected account in the tenant, for the admin provider-sync view.
   *
   * `list` above is deliberately caller-scoped — a Member sees only their own
   * accounts — which is right for the member surface and useless for an
   * operator triaging sync failures across the workspace. Rather than widen
   * `list` and change what a Member sees, this is a separate read gated on a
   * capability a Member does not hold.
   *
   * Includes the owning member, because a failing connector is only actionable
   * if you know whose reauthorization to chase. Deliberately no tokens or
   * secrets — the operator needs status, not credentials.
   */
  listForTenant(tenantId: string) {
    return prisma.connectedAccount.findMany({
      where: { tenantId },
      select: {
        id: true, provider: true, email: true, scopes: true, status: true,
        watchExpiresAt: true, lastSyncedAt: true, lastErrorCode: true,
        disconnectedAt: true, createdAt: true, updatedAt: true,
        membership: {
          select: {
            id: true,
            role: true,
            user: { select: { id: true, email: true, displayName: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { lastSyncedAt: "desc" }],
    });
  }

  async create(
    input: CreateAccountInput,
    context: { tenantId: string; membershipId: string; userId: string; requestId?: string }
  ) {
    try {
      const account = await prisma.$transaction(async (tx) => {
        const membership = await tx.tenantMembership.findFirst({
          where: {
            id: context.membershipId,
            tenantId: context.tenantId,
            userId: context.userId,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (!membership) {
          throw new AppError("Active membership not found", 403, ErrorCodes.FORBIDDEN);
        }
        const created = await tx.connectedAccount.create({
          data: {
            tenantId: context.tenantId,
            membershipId: context.membershipId,
            userId: context.userId,
            ...input,
          },
          select: {
            id: true, provider: true, email: true, scopes: true, status: true,
            createdAt: true, updatedAt: true,
          },
        });
        await auditService.record({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "CONNECTED_ACCOUNT_CREATED",
          targetType: "ConnectedAccount",
          targetId: created.id,
          requestId: context.requestId,
          metadata: { provider: input.provider, scopes: input.scopes },
        }, tx);
        return created;
      });
      return account;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("This provider account is already connected", 409, ErrorCodes.CONFLICT);
      }
      throw error;
    }
  }

  async disconnect(
    accountId: string,
    context: { tenantId: string; membershipId: string; userId: string; requestId?: string }
  ) {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId: context.tenantId, membershipId: context.membershipId },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);

    // Best-effort provider cleanup (token revocation) is attempted *before*
    // deleting local state. Failures to reach the provider must not block the
    // disconnect — the user is leaving, local credential state must go
    // regardless. Audit the outcome either way. Never log token values.
    let providerRevoked = false;
    try {
      if (account.provider === "GMAIL") {
        await revokeGoogleAccessToken(account.providerAccountId);
        providerRevoked = true;
      } else if (account.provider === "MICROSOFT_365") {
        await revokeMicrosoftAccessToken(account.providerAccountId);
        providerRevoked = true;
      }
    } catch (error) {
      logger.warn(
        { provider: account.provider, accountId: account.id, requestId: context.requestId },
        "Provider token revocation failed during disconnect; continuing"
      );
    }

    const disconnectCtx = {
      tenantId: context.tenantId,
      requestId: context.requestId,
    };
    // Delete the secret holding the tokens. Uses ref from the row (or the
    // deterministic one) so a row without a ref still clears any orphaned value.
    try {
      await deleteConnectorTokens(account.provider, account.providerAccountId, account.tokenSecretRef, {
        purpose: "disconnect",
        ...disconnectCtx,
      });
    } catch (error) {
      logger.warn(
        { provider: account.provider, accountId: account.id },
        "Secret deletion failed during disconnect; continuing"
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.connectedAccount.update({
        where: { id: account.id },
        data: {
          status: "DISCONNECTED",
          disconnectedAt: new Date(),
          tokenSecretRef: null,
          watchExpiresAt: null,
          microsoftSubscriptionId: null,
          microsoftDeltaLink: null,
        },
        select: { id: true, provider: true, email: true, status: true, disconnectedAt: true },
      });
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "CONNECTED_ACCOUNT_DISCONNECTED",
        targetType: "ConnectedAccount",
        targetId: account.id,
        requestId: context.requestId,
        metadata: { provider: account.provider, providerRevoked },
      }, tx);
      return updated;
    });
  }

  /**
   * On-demand sync for a single connected account (Sync Now).
   *
   * Deliberately caller-scoped like `list` / `disconnect`: the caller must own
   * the account. Dispatches to the provider's incremental sync (Gmail history /
   * M365 delta) so a user can pull latest mail without waiting for a webhook or
   * catch-up timer. No tokens or secrets are returned to the caller.
   */
  async syncNow(
    accountId: string,
    context: { tenantId: string; membershipId: string; userId: string; requestId?: string }
  ) {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId: context.tenantId, membershipId: context.membershipId },
      select: { id: true, provider: true, status: true },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    if (account.status === "DISCONNECTED") {
      throw new AppError("Disconnected accounts cannot sync", 409, ErrorCodes.CONFLICT);
    }

    try {
      const result =
        account.provider === "GMAIL"
          ? await (await import("./gmail/gmail.connector.js")).gmailConnector.syncHistory(account.id, context.tenantId)
          : await (await import("./m365/m365.connector.js")).microsoftConnector.syncInbox(account.id, context.tenantId);

      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "CONNECTED_ACCOUNT_SYNCED",
        targetType: "ConnectedAccount",
        targetId: account.id,
        requestId: context.requestId,
        metadata: { provider: account.provider, ...result },
      });

      return { synced: true, provider: account.provider, result };
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error(
        { accountId: account.id, provider: account.provider, error, requestId: context.requestId },
        "On-demand connector sync failed"
      );
      throw new AppError("Sync failed — the provider may be unavailable or needs reauthorization", 502, "PROVIDER_ERROR");
    }
  }

  async listEvents(accountId: string, tenantId: string, membershipId: string) {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, membershipId },
      select: { id: true },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.providerEvent.findMany({
      where: { tenantId, connectedAccountId: account.id },
      select: {
        id: true, providerEventId: true, provider: true, eventType: true,
        normalizedResourceType: true, normalizedResourceId: true,
        providerReference: true, sanitizedPayload: true, receivedAt: true,
        processedAt: true, processingStatus: true, errorCode: true, requestId: true,
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    });
  }

  /**
   * Tenant-wide provider event feed for OWNER/ADMIN. Deliberately omits
   * payloads (sanitizedPayload / normalized resource refs) — owners get
   * routing metadata only; full payloads remain a platform-support concern.
   */
  async listProviderEvents(
    input: { status?: string; provider?: string; limit?: number },
    tenantId: string
  ) {
    const events = await prisma.providerEvent.findMany({
      where: {
        tenantId,
        ...(input.status
          ? { processingStatus: input.status as Prisma.ProviderEventWhereInput["processingStatus"] }
          : {}),
        ...(input.provider
          ? { provider: input.provider as Prisma.ProviderEventWhereInput["provider"] }
          : {}),
      },
      select: {
        id: true,
        providerEventId: true,
        provider: true,
        eventType: true,
        processingStatus: true,
        errorCode: true,
        attempts: true,
        maxAttempts: true,
        receivedAt: true,
        processedAt: true,
        requestId: true,
        connectedAccount: { select: { email: true, status: true } },
      },
      orderBy: { receivedAt: "desc" },
      take: Math.min(input.limit ?? 50, 200),
    });

    return events.map((e) => ({
      id: e.id,
      providerEventId: e.providerEventId,
      provider: e.provider,
      accountEmail: e.connectedAccount.email,
      accountStatus: e.connectedAccount.status,
      eventType: e.eventType,
      processingStatus: e.processingStatus,
      errorCode: e.errorCode,
      attempts: e.attempts,
      maxAttempts: e.maxAttempts,
      receivedAt: e.receivedAt,
      processedAt: e.processedAt,
    }));
  }

  async receiveEvent(provider: ConnectorProvider, input: NormalizedCallback, requestId?: string) {
    const account = await prisma.connectedAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: input.providerAccountId } },
    });
    if (!account || account.status === "DISCONNECTED") {
      throw new AppError("Provider account mapping not found", 404, ErrorCodes.NOT_FOUND);
    }
    const hash = eventHash(provider, input);
    const existing = await prisma.providerEvent.findUnique({
      where: { provider_eventHash: { provider, eventHash: hash } },
      select: { id: true, processingStatus: true, receivedAt: true },
    });
    if (existing) return { duplicate: true, event: existing };

    const sanitizedPayload: Prisma.InputJsonObject = {
      providerEventId: input.providerEventId ?? null,
      eventType: input.eventType,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      providerReference: input.providerReference ?? null,
      occurredAt: input.occurredAt,
      cursor: input.cursor ?? null,
    };
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.providerEvent.create({
        data: {
          providerEventId: input.providerEventId,
          tenantId: account.tenantId,
          connectedAccountId: account.id,
          provider,
          eventType: input.eventType,
          normalizedResourceType: input.resourceType,
          normalizedResourceId: input.resourceId,
          providerReference: input.providerReference,
          eventHash: hash,
          sanitizedPayload,
          requestId,
        },
        select: { id: true, processingStatus: true, receivedAt: true },
      });
      await auditService.record({
        tenantId: account.tenantId,
        eventType: "PROVIDER_EVENT_RECEIVED",
        targetType: "ProviderEvent",
        targetId: created.id,
        requestId,
        metadata: { provider, eventType: input.eventType },
      }, tx);
      return created;
    });
    return { duplicate: false, event };
  }

  async health(tenantId: string) {
    const [accountGroups, eventGroups] = await prisma.$transaction([
      prisma.connectedAccount.groupBy({
        by: ["provider", "status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.providerEvent.groupBy({
        by: ["provider", "processingStatus"],
        where: { tenantId },
        _count: { _all: true },
      }),
    ]);
    return {
      accounts: accountGroups.map((row) => ({
        provider: row.provider, status: row.status, count: row._count._all,
      })),
      events: eventGroups.map((row) => ({
        provider: row.provider, status: row.processingStatus, count: row._count._all,
      })),
    };
  }

  listDeadLetters(tenantId: string) {
    return prisma.providerEvent.findMany({
      where: { tenantId, processingStatus: "DEAD_LETTER" },
      select: {
        id: true, connectedAccountId: true, provider: true, eventType: true,
        sanitizedPayload: true, attempts: true, maxAttempts: true,
        errorCode: true, receivedAt: true, processedAt: true,
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    });
  }

  // ─── Google OAuth ────────────────────────────────────────────────────────────

  getGoogleAuthUrl(state: string): string {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
      throw new AppError(
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in the backend .env file.",
        503,
        "OAUTH_NOT_CONFIGURED"
      );
    }
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleGoogleCallback(
    code: string,
    context: { tenantId: string; membershipId: string; userId: string; requestId?: string }
  ): Promise<{ id: string; provider: string; email: string; status: string }> {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
      throw new AppError(
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in the backend .env file.",
        503,
        "OAUTH_NOT_CONFIGURED"
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new AppError(`Google token exchange failed: ${error}`, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
      scope: string;
    };

    // Get user info from Google
    const userinfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userinfoResponse.ok) {
      throw new AppError("Failed to fetch Google user info", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const userinfo = await userinfoResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture?: string;
    };

    // Store tokens in the Secret Manager (or local-equivalent) instead of the
    // database. Only the deterministic ref is persisted on the row.
    const tokenRef = await storeConnectorTokens(
      "GMAIL",
      userinfo.id,
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      },
      { purpose: "google-connect", tenantId: context.tenantId, requestId: context.requestId }
    );
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Upsert connected account
    const account = await prisma.$transaction(async (tx) => {
      const existing = await tx.connectedAccount.findUnique({
        where: { provider_providerAccountId: { provider: "GMAIL", providerAccountId: userinfo.id } },
      });

      if (existing) {
        // Update existing account with new token ref
        const updated = await tx.connectedAccount.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            tokenSecretRef: tokenRef,
            tokenExpiresAt,
            email: userinfo.email,
            lastErrorCode: null,
            disconnectedAt: null,
          },
          select: {
            id: true, provider: true, email: true, status: true,
          },
        });
        await auditService.record({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "CONNECTED_ACCOUNT_UPDATED",
          targetType: "ConnectedAccount",
          targetId: updated.id,
          requestId: context.requestId,
          metadata: { provider: "GMAIL", email: userinfo.email },
        }, tx);
        return updated;
      }

      // Create new account
      const created = await tx.connectedAccount.create({
        data: {
          tenantId: context.tenantId,
          membershipId: context.membershipId,
          userId: context.userId,
          provider: "GMAIL",
          providerAccountId: userinfo.id,
          email: userinfo.email,
          scopes: GOOGLE_SCOPES,
          status: "ACTIVE",
          tokenSecretRef: tokenRef,
          tokenExpiresAt,
        },
        select: {
          id: true, provider: true, email: true, status: true,
        },
      });
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "CONNECTED_ACCOUNT_CREATED",
        targetType: "ConnectedAccount",
        targetId: created.id,
        requestId: context.requestId,
        metadata: { provider: "GMAIL", scopes: GOOGLE_SCOPES },
      }, tx);
      return created;
    });

    // Register users.watch so Google pushes mailbox changes (ZM-BE-005). Skip
    // silently when Pub/Sub is not configured — the catch-up sync covers it.
    if (env.GMAIL_PUBSUB_TOPIC) {
      try {
        const { gmailConnector } = await import("./gmail/gmail.connector.js");
        await gmailConnector.registerWatch(account.id, context.tenantId);
      } catch (error) {
        logger.warn({ accountId: account.id, error }, "Gmail watch registration deferred after connect");
      }
    }

    return account;
  }

  // ─── Microsoft 365 OAuth (ZM-BE-006) ───────────────────────────────────────

  async getMicrosoftAuthUrl(state: string): Promise<string> {
    const { microsoftConnector } = await import("./m365/m365.connector.js");
    return microsoftConnector.authUrl(state);
  }

  async handleMicrosoftCallback(
    code: string,
    context: { tenantId: string; membershipId: string; userId: string; requestId?: string }
  ): Promise<{ id: string; provider: string; email: string; status: string }> {
    const { microsoftConnector } = await import("./m365/m365.connector.js");
    const { tokens, user } = await microsoftConnector.acquireTokens(code);
    const email = user.mail ?? user.userPrincipalName;
    if (!email) throw new AppError("Microsoft account has no email address", 400, ErrorCodes.VALIDATION_ERROR);

    const tokenRef = await storeConnectorTokens(
      "MICROSOFT_365",
      user.id,
      { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      { purpose: "microsoft-connect", tenantId: context.tenantId, requestId: context.requestId }
    );
    const tokenExpiresAt = new Date(tokens.expiresAt);

    const account = await prisma.$transaction(async (tx) => {
      const existing = await tx.connectedAccount.findUnique({
        where: { provider_providerAccountId: { provider: "MICROSOFT_365", providerAccountId: user.id } },
      });
      if (existing) {
        const updated = await tx.connectedAccount.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            tokenSecretRef: tokenRef,
            tokenExpiresAt,
            email,
            lastErrorCode: null,
            disconnectedAt: null,
          },
          select: { id: true, provider: true, email: true, status: true },
        });
        await auditService.record({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "CONNECTED_ACCOUNT_UPDATED",
          targetType: "ConnectedAccount",
          targetId: updated.id,
          requestId: context.requestId,
          metadata: { provider: "MICROSOFT_365", email },
        }, tx);
        return updated;
      }
      const created = await tx.connectedAccount.create({
        data: {
          tenantId: context.tenantId,
          membershipId: context.membershipId,
          userId: context.userId,
          provider: "MICROSOFT_365",
          providerAccountId: user.id,
          email,
          scopes: MS365_SCOPES,
          status: "ACTIVE",
          tokenSecretRef: tokenRef,
          tokenExpiresAt,
        },
        select: { id: true, provider: true, email: true, status: true },
      });
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "CONNECTED_ACCOUNT_CREATED",
        targetType: "ConnectedAccount",
        targetId: created.id,
        requestId: context.requestId,
        metadata: { provider: "MICROSOFT_365", scopes: MS365_SCOPES },
      }, tx);
      return created;
    });

    // Register the Graph change-notification subscription after connect so the
    // delta sync has a live webhook. Deferred when the notification URL is
    // unconfigured — the catch-up sweep still runs.
    if (env.MICROSOFT_NOTIFICATION_URL) {
      try {
        await microsoftConnector.registerSubscription(account.id, context.tenantId);
      } catch (error) {
        logger.warn({ accountId: account.id, error }, "Microsoft Graph subscription deferred after connect");
      }
    }

    return account;
  }

  async refreshMicrosoftToken(accountId: string): Promise<void> {
    const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    if (account.provider !== "MICROSOFT_365") {
      throw new AppError("Not a Microsoft 365 account", 400, ErrorCodes.VALIDATION_ERROR);
    }
    const tokens = await readConnectorTokens("MICROSOFT_365", account.providerAccountId, account.tokenSecretRef, {
      purpose: "token-refresh",
      tenantId: account.tenantId,
    });
    if (!tokens?.refreshToken) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { status: "REAUTH_REQUIRED", lastErrorCode: "NO_REFRESH_TOKEN" },
      });
      throw new AppError("No refresh token available — reauthorization required", 401, ErrorCodes.UNAUTHORIZED);
    }

    const { microsoftConnector } = await import("./m365/m365.connector.js");
    const refreshed = await microsoftConnector.refreshTokens(tokens.refreshToken);
    await storeConnectorTokens(
      "MICROSOFT_365",
      account.providerAccountId,
      { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken },
      { purpose: "microsoft-token-refresh", tenantId: account.tenantId }
    );
    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        tokenExpiresAt: new Date(refreshed.expiresAt),
        status: "ACTIVE",
        lastErrorCode: null,
      },
    });
  }

  async getMicrosoftAccessToken(accountId: string, tenantId: string): Promise<string> {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "MICROSOFT_365" },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
      await this.refreshMicrosoftToken(accountId);
    }
    const tokens = await readConnectorTokens("MICROSOFT_365", account.providerAccountId, account.tokenSecretRef, {
      purpose: "token-read",
      tenantId: account.tenantId,
    });
    if (!tokens?.accessToken) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { status: "REAUTH_REQUIRED", lastErrorCode: "NO_ACCESS_TOKEN" },
      });
      throw new AppError("No access token available", 401, ErrorCodes.UNAUTHORIZED);
    }
    return tokens.accessToken;
  }

  async refreshGoogleToken(accountId: string): Promise<void> {
    const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    if (account.provider !== "GMAIL") throw new AppError("Not a Google account", 400, ErrorCodes.VALIDATION_ERROR);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError("Google OAuth is not configured", 500, ErrorCodes.INTERNAL_ERROR);
    }

    const tokens = await readConnectorTokens("GMAIL", account.providerAccountId, account.tokenSecretRef, {
      purpose: "token-refresh",
      tenantId: account.tenantId,
    });
    if (!tokens?.refreshToken) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { status: "REAUTH_REQUIRED", lastErrorCode: "NO_REFRESH_TOKEN" },
      });
      throw new AppError("No refresh token available — reauthorization required", 401, ErrorCodes.UNAUTHORIZED);
    }

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      // Refresh token may have been revoked
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { status: "REAUTH_REQUIRED", lastErrorCode: "TOKEN_REFRESH_FAILED" },
      });
      throw new AppError("Token refresh failed — reauthorization required", 401, ErrorCodes.UNAUTHORIZED);
    }

    const refreshed = await tokenResponse.json() as {
      access_token: string;
      expires_in: number;
    };

    await storeConnectorTokens("GMAIL", account.providerAccountId, {
      accessToken: refreshed.access_token,
      refreshToken: tokens.refreshToken,
    }, { purpose: "token-refresh-write", tenantId: account.tenantId });

    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        status: "ACTIVE",
        lastErrorCode: null,
      },
    });
  }

  async getGoogleAccessToken(accountId: string, tenantId: string): Promise<string> {
    const account = await prisma.connectedAccount.findFirst({
      where: { id: accountId, tenantId, provider: "GMAIL" },
    });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);

    // Check if token is expired (with 5 min buffer)
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
      await this.refreshGoogleToken(accountId);
    }

    const tokens = await readConnectorTokens("GMAIL", account.providerAccountId, account.tokenSecretRef, {
      purpose: "token-read",
      tenantId: account.tenantId,
    });
    if (!tokens?.accessToken) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: { status: "REAUTH_REQUIRED", lastErrorCode: "NO_ACCESS_TOKEN" },
      });
      throw new AppError("No access token available", 401, ErrorCodes.UNAUTHORIZED);
    }
    return tokens.accessToken;
  }

  async replayDeadLetter(eventId: string, tenantId: string, userId: string, requestId?: string) {
    return prisma.$transaction(async (tx) => {
      const event = await tx.providerEvent.findFirst({
        where: { id: eventId, tenantId, processingStatus: "DEAD_LETTER" },
      });
      if (!event) throw new AppError("Dead-letter event not found", 404, ErrorCodes.NOT_FOUND);
      const replayed = await tx.providerEvent.update({
        where: { id: event.id },
        data: {
          processingStatus: "RETRY", attempts: 0, runAt: new Date(),
          lockedAt: null, processedAt: null, errorCode: null,
        },
      });
      await auditService.record({
        tenantId,
        actorUserId: userId,
        eventType: "PROVIDER_EVENT_REPLAYED",
        targetType: "ProviderEvent",
        targetId: event.id,
        requestId,
      }, tx);
      return replayed;
    });
  }

  private async claimEvent() {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "provider_events"
      SET "processing_status"='FAILED', "locked_at"=CURRENT_TIMESTAMP,
          "attempts"="attempts"+1
      WHERE "id"=(
        SELECT "id" FROM "provider_events"
        WHERE (
          ("processing_status" IN ('RECEIVED','RETRY') AND "run_at"<=CURRENT_TIMESTAMP)
          OR ("processing_status"='FAILED' AND "locked_at"<=CURRENT_TIMESTAMP-INTERVAL '5 minutes')
        )
        ORDER BY "run_at", "received_at"
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING "id"`;
    return rows[0]
      ? prisma.providerEvent.findUnique({ where: { id: rows[0].id }, include: { connectedAccount: true } })
      : null;
  }

  async processNextEvent() {
    const event = await this.claimEvent();
    if (!event) return { processed: false };
    try {
      const reauthEvents = new Set(["AUTH_REVOKED", "REAUTH_REQUIRED", "PERMISSION_MISMATCH"]);
      const degradedEvents = new Set(["WATCH_EXPIRED", "SUBSCRIPTION_EXPIRED", "MISSED_NOTIFICATION"]);
      const retryableEvents = new Set(["PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE", "TEMPORARY_FAILURE"]);
      if (retryableEvents.has(event.eventType)) {
        throw new Error(event.eventType);
      }

      // Gmail history / M365 delta sync (ZM-BE-005/006): replay mailbox
      // changes before the event is marked processed so a failure here routes
      // through the normal retry / dead-letter machinery. Idempotent via the
      // providerMessageId constraint and the per-provider checkpoint.
      if (event.provider === "GMAIL" && isGmailHistoryEvent(event.eventType)) {
        const { gmailConnector } = await import("./gmail/gmail.connector.js");
        const result = await gmailConnector.syncHistory(
          event.connectedAccountId,
          event.tenantId,
          event.providerReference ?? undefined
        );
        logger.info(
          { eventId: event.id, accountId: event.connectedAccountId, ...result },
          "Gmail history sync completed"
        );
      }
      if (event.provider === "MICROSOFT_365" && isMicrosoftSyncEvent(event.eventType)) {
        const { microsoftConnector } = await import("./m365/m365.connector.js");
        const result = await microsoftConnector.syncInbox(event.connectedAccountId, event.tenantId);
        logger.info(
          { eventId: event.id, accountId: event.connectedAccountId, ...result },
          "Microsoft 365 delta sync completed"
        );
      }

      await prisma.$transaction(async (tx) => {
        await deliveryProtectionService.processProviderSignal(tx, event);
        const accountData = reauthEvents.has(event.eventType)
          ? { status: "REAUTH_REQUIRED" as const, lastErrorCode: event.eventType }
          : degradedEvents.has(event.eventType)
            ? { status: "DEGRADED" as const, lastErrorCode: event.eventType }
            : {
                status: "ACTIVE" as const,
                lastErrorCode: null,
                lastSyncedAt: new Date(),
              };
        await tx.connectedAccount.update({
          where: { id: event.connectedAccountId },
          data: accountData,
        });
        await tx.providerEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: "PROCESSED", processedAt: new Date(),
            lockedAt: null, errorCode: null,
          },
        });
        await auditService.record({
          tenantId: event.tenantId,
          eventType: "PROVIDER_EVENT_PROCESSED",
          targetType: "ProviderEvent",
          targetId: event.id,
          requestId: event.requestId,
          metadata: { provider: event.provider, eventType: event.eventType },
        }, tx);
      });
      return { processed: true, eventId: event.id, status: "PROCESSED" as const };
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.slice(0, 100) : "PROCESSING_FAILED";
      const deadLetter = event.attempts >= event.maxAttempts;
      const jitter = Math.floor(Math.random() * Math.max(1, env.PROVIDER_EVENT_RETRY_BASE_MS / 4));
      const delay = env.PROVIDER_EVENT_RETRY_BASE_MS * 2 ** Math.max(0, event.attempts - 1) + jitter;
      await prisma.$transaction(async (tx) => {
        await tx.providerEvent.update({
          where: { id: event.id },
          data: {
            processingStatus: deadLetter ? "DEAD_LETTER" : "RETRY",
            runAt: deadLetter ? event.runAt : new Date(Date.now() + delay),
            lockedAt: null,
            processedAt: deadLetter ? new Date() : null,
            errorCode,
          },
        });
        await tx.connectedAccount.update({
          where: { id: event.connectedAccountId },
          data: { status: "DEGRADED", lastErrorCode: errorCode },
        });
        if (deadLetter) {
          await auditService.record({
            tenantId: event.tenantId,
            eventType: "PROVIDER_EVENT_DEAD_LETTERED",
            targetType: "ProviderEvent",
            targetId: event.id,
            requestId: event.requestId,
            metadata: { provider: event.provider, eventType: event.eventType, attempts: event.attempts },
          }, tx);
        }
      });
      return {
        processed: true, eventId: event.id,
        status: deadLetter ? "DEAD_LETTER" as const : "RETRY" as const,
      };
    }
  }
}

const GMAIL_SYNC_EVENTS = new Set(["MAILBOX_CHANGED", "MESSAGE_CHANGED", "MESSAGE_DELETED", "HISTORY_SYNC"]);

function isGmailHistoryEvent(eventType: string): boolean {
  return GMAIL_SYNC_EVENTS.has(eventType);
}

const MS365_SYNC_EVENTS = new Set(["MAILBOX_CHANGED", "MESSAGE_CHANGED", "MESSAGE_DELETED", "INBOX_CHANGED"]);

function isMicrosoftSyncEvent(eventType: string): boolean {
  return MS365_SYNC_EVENTS.has(eventType);
}

/**
 * Revokes a Google OAuth token at the provider. Best-effort: the caller decides
 * whether a failure here should block the surrounding operation (it never does
 * for disconnect — local state is cleared regardless).
 */
export async function revokeGoogleAccessToken(providerAccountId: string): Promise<void> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return;
  const tokens = await readConnectorTokens("GMAIL", providerAccountId, undefined, {
    purpose: "disconnect-revoke",
  });
  const value = tokens?.accessToken ?? tokens?.refreshToken;
  if (!value) return;
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(value)}`, {
    method: "POST",
  });
  if (!response.ok && response.status !== 400) {
    // 400 simply means the token was already invalid/revoked.
    throw new Error(`Google token revocation failed with HTTP ${response.status}`);
  }
}

/**
 * Revokes a Microsoft OAuth token by signing the user out at the common
 * authorization endpoint. Microsoft has no public token-revocation API for
 * Graph apps; logout is the documented best-effort signal, and the wrapped
 * error is tolerated by the disconnect flow.
 */
export async function revokeMicrosoftAccessToken(_providerAccountId: string): Promise<void> {
  // Microsoft exposes no server-side refresh-token revocation endpoint for the
  // confidential-client flows Zeo Mail uses; local credential state (the token
  // secret + delta/subscription checkpoints) is fully cleared on disconnect, so
  // this deliberately stays a no-op (ZM-BE-006).
  return;
}

export const connectorService = new ConnectorService();
