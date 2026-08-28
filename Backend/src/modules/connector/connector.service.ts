import { createHash } from "node:crypto";
import { Prisma, type ConnectorProvider } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { env } from "../../config/env.js";
import { deliveryProtectionService } from "../delivery-protection/delivery-protection.service.js";
import { encrypt, decrypt } from "../../common/utils/encryption.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

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
    return prisma.$transaction(async (tx) => {
      const account = await tx.connectedAccount.findFirst({
        where: { id: accountId, tenantId: context.tenantId, membershipId: context.membershipId },
      });
      if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
      const updated = await tx.connectedAccount.update({
        where: { id: account.id },
        data: { status: "DISCONNECTED", disconnectedAt: new Date() },
        select: { id: true, provider: true, email: true, status: true, disconnectedAt: true },
      });
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        eventType: "CONNECTED_ACCOUNT_DISCONNECTED",
        targetType: "ConnectedAccount",
        targetId: account.id,
        requestId: context.requestId,
        metadata: { provider: account.provider },
      }, tx);
      return updated;
    });
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

    // Encrypt tokens before storage
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Upsert connected account
    const account = await prisma.$transaction(async (tx) => {
      const existing = await tx.connectedAccount.findUnique({
        where: { provider_providerAccountId: { provider: "GMAIL", providerAccountId: userinfo.id } },
      });

      if (existing) {
        // Update existing account with new tokens
        const updated = await tx.connectedAccount.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken ?? existing.refreshToken,
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
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
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

    return account;
  }

  async refreshGoogleToken(accountId: string): Promise<void> {
    const account = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError("Connected account not found", 404, ErrorCodes.NOT_FOUND);
    if (account.provider !== "GMAIL") throw new AppError("Not a Google account", 400, ErrorCodes.VALIDATION_ERROR);
    if (!account.refreshToken) throw new AppError("No refresh token available", 400, ErrorCodes.VALIDATION_ERROR);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError("Google OAuth is not configured", 500, ErrorCodes.INTERNAL_ERROR);
    }

    const refreshToken = decrypt(account.refreshToken);
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
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

    const tokens = await tokenResponse.json() as {
      access_token: string;
      expires_in: number;
    };

    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: {
        accessToken: encrypt(tokens.access_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
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
    if (!account.accessToken) throw new AppError("No access token available", 400, ErrorCodes.VALIDATION_ERROR);

    // Check if token is expired (with 5 min buffer)
    if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000) {
      await this.refreshGoogleToken(accountId);
      // Re-fetch after refresh
      const refreshed = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
      if (!refreshed?.accessToken) throw new AppError("Token refresh failed", 500, ErrorCodes.INTERNAL_ERROR);
      return decrypt(refreshed.accessToken);
    }

    return decrypt(account.accessToken);
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

export const connectorService = new ConnectorService();
