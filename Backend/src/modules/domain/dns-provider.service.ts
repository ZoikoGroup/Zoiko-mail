import { randomUUID } from "node:crypto";
import type { DnsProviderKind, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { deleteSecret, getSecret, setSecret } from "../../common/secrets/secrets.js";
import { auditService } from "../audit/audit.service.js";
import {
  DnsProviderError,
  dnsProviderAdapter,
  type DnsZoneClient,
  type ProviderSecret,
  type ProviderSettings,
} from "./providers/index.js";

/**
 * API credentials for a workspace's DNS host.
 *
 * Handled like connector OAuth tokens (Security §15): the secret goes to the
 * secret store, the row keeps a ref, and nothing that leaves this module —
 * responses, audit metadata, logs — carries the value. A credential is proved
 * against the provider before it is stored, so a typo is an error on the form
 * and not a failure discovered hours later by the synchronizer.
 */

export interface AuditContext {
  tenantId: string;
  userId: string;
  requestId?: string;
}

export interface ConnectProviderInput {
  provider: Exclude<DnsProviderKind, "MANUAL">;
  label: string;
  apiToken?: string;
  apiKey?: string;
  apiSecret?: string;
  environment?: "PRODUCTION" | "OTE";
}

const PUBLIC_FIELDS = {
  id: true,
  provider: true,
  label: true,
  settings: true,
  status: true,
  lastValidatedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DnsProviderCredentialSelect;

const MISSING_SECRET_MESSAGE =
  "The stored API token for this connection is missing. Enter the token again (Domains → DNS providers → Update token) to reconnect.";

function secretRef(credentialId: string): string {
  return `dns-provider/${credentialId}`;
}

function toSecret(input: ConnectProviderInput): ProviderSecret {
  if (input.provider === "CLOUDFLARE") {
    if (!input.apiToken) throw new AppError("A Cloudflare API token is required", 400, ErrorCodes.VALIDATION_ERROR);
    return { provider: "CLOUDFLARE", apiToken: input.apiToken };
  }
  if (!input.apiKey || !input.apiSecret) {
    throw new AppError("A GoDaddy API key and secret are required", 400, ErrorCodes.VALIDATION_ERROR);
  }
  return { provider: "GODADDY", apiKey: input.apiKey, apiSecret: input.apiSecret };
}

/** Maps a provider failure to the status a client should see. */
export function providerFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DnsProviderError) {
    // 422 for "your credential or zone is wrong", 502 for "the provider
    // failed": only the first is something the user can fix on this form.
    const status = error.isAuthFailure || error.status === 404 ? 422 : 502;
    return new AppError(error.message, status, ErrorCodes.DNS_PROVIDER_ERROR, { providerStatus: error.status });
  }
  return new AppError("The DNS provider request failed", 502, ErrorCodes.DNS_PROVIDER_ERROR);
}

export class DnsProviderService {
  list(tenantId: string) {
    return prisma.dnsProviderCredential.findMany({
      where: { tenantId },
      select: { ...PUBLIC_FIELDS, _count: { select: { domains: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async connect(input: ConnectProviderInput, context: AuditContext) {
    const adapter = dnsProviderAdapter(input.provider);
    if (!adapter) throw new AppError(`${input.provider} is not supported`, 400, ErrorCodes.VALIDATION_ERROR);
    const secret = toSecret(input);
    const settings: ProviderSettings = input.provider === "GODADDY" ? { environment: input.environment ?? "PRODUCTION" } : {};

    try {
      await adapter.verify(secret, settings);
    } catch (error) {
      throw providerFailure(error);
    }

    // The row id names the secret, so the id is chosen before either write.
    const id = randomUUID();
    const ref = secretRef(id);
    await setSecret(ref, JSON.stringify(secret), { purpose: "DNS provider credential (connect)", tenantId: context.tenantId, requestId: context.requestId });
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.dnsProviderCredential.create({
          data: {
            id,
            tenantId: context.tenantId,
            provider: input.provider,
            label: input.label,
            secretRef: ref,
            settings: settings as Prisma.InputJsonValue,
            status: "ACTIVE",
            lastValidatedAt: new Date(),
            createdByUserId: context.userId,
          },
          select: PUBLIC_FIELDS,
        });
        await auditService.record({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          actorType: "ADMIN",
          eventType: "DNS_PROVIDER_CONNECTED",
          targetType: "DnsProviderCredential",
          targetId: id,
          requestId: context.requestId,
          metadata: { provider: input.provider, label: input.label },
        }, tx);
        return created;
      });
    } catch (error) {
      await deleteSecret(ref, { purpose: "DNS provider credential (rollback)", tenantId: context.tenantId }).catch(() => undefined);
      throw error;
    }
  }

  private async load(credentialId: string, tenantId: string) {
    const credential = await prisma.dnsProviderCredential.findFirst({ where: { id: credentialId, tenantId } });
    if (!credential) throw new AppError("DNS provider credential not found", 404, ErrorCodes.NOT_FOUND);
    return credential;
  }

  /**
   * The stored API token, or a clear refusal when it is gone.
   *
   * The row and the secret live in different places — the database and the
   * secret store — so the row can outlive its secret (a local .secrets folder
   * wiped, a vault restored from an older snapshot). That used to surface as
   * "Secret not available: dns-provider/<id>" on every publish while the
   * credential still read ACTIVE, so domains sat unverified with nothing on
   * screen saying why. Now the credential is marked INVALID with an
   * instruction the admin can act on, and replaceSecret() restores it.
   */
  private async secretOf(credential: {
    id: string;
    secretRef: string;
    tenantId: string;
    provider: DnsProviderKind;
    status?: string;
  }): Promise<ProviderSecret> {
    let raw: string;
    try {
      raw = await getSecret(credential.secretRef, { purpose: "DNS provider credential (use)", tenantId: credential.tenantId });
    } catch (error) {
      if (!(error instanceof AppError && error.message.startsWith("Secret not available"))) throw error;
      await this.markInvalid(credential, MISSING_SECRET_MESSAGE);
      throw new DnsProviderError(MISSING_SECRET_MESSAGE, 403);
    }
    return JSON.parse(raw) as ProviderSecret;
  }

  /** Records that a credential cannot be used, once, with the reason. */
  private async markInvalid(
    credential: { id: string; tenantId: string; provider: DnsProviderKind; status?: string },
    reason: string
  ): Promise<void> {
    const updated = await prisma.dnsProviderCredential.updateMany({
      where: { id: credential.id, tenantId: credential.tenantId, status: "ACTIVE" },
      data: { status: "INVALID", lastError: reason, lastValidatedAt: new Date() },
    });
    if (updated.count === 0) return;
    await auditService.record({
      tenantId: credential.tenantId,
      actorType: "SYSTEM",
      eventType: "DNS_PROVIDER_INVALID",
      targetType: "DnsProviderCredential",
      targetId: credential.id,
      metadata: { provider: credential.provider, error: reason },
    });
  }

  /**
   * Replace the API token of an existing credential, keeping its id — and so
   * every domain that publishes through it. The new token is proved against
   * the provider first; a wrong one changes nothing.
   */
  async replaceSecret(
    credentialId: string,
    input: { apiToken?: string; apiKey?: string; apiSecret?: string },
    context: AuditContext
  ) {
    const credential = await this.load(credentialId, context.tenantId);
    const adapter = dnsProviderAdapter(credential.provider);
    if (!adapter) throw new AppError(`${credential.provider} is not supported`, 400, ErrorCodes.VALIDATION_ERROR);
    const secret = toSecret({
      provider: credential.provider as ConnectProviderInput["provider"],
      label: credential.label,
      ...input,
    });
    try {
      await adapter.verify(secret, (credential.settings ?? {}) as ProviderSettings);
    } catch (error) {
      throw providerFailure(error);
    }

    // Same ref: the row already names it, and nothing else has to change.
    await setSecret(credential.secretRef, JSON.stringify(secret), {
      purpose: "DNS provider credential (replace)",
      tenantId: context.tenantId,
      requestId: context.requestId,
    });
    return prisma.$transaction(async (tx) => {
      const updated = await tx.dnsProviderCredential.update({
        where: { id: credential.id, tenantId: context.tenantId },
        data: { status: "ACTIVE", lastError: null, lastValidatedAt: new Date() },
        select: PUBLIC_FIELDS,
      });
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorType: "ADMIN",
        eventType: "DNS_PROVIDER_SECRET_REPLACED",
        targetType: "DnsProviderCredential",
        targetId: credential.id,
        requestId: context.requestId,
        // Never the token.
        metadata: { provider: credential.provider, label: credential.label, wasStatus: credential.status },
      }, tx);
      return updated;
    });
  }

  /** Re-proves a stored credential and records the outcome. */
  async revalidate(credentialId: string, context: AuditContext) {
    const credential = await this.load(credentialId, context.tenantId);
    const adapter = dnsProviderAdapter(credential.provider);
    if (!adapter) throw new AppError(`${credential.provider} is not supported`, 400, ErrorCodes.VALIDATION_ERROR);
    let lastError: string | null = null;
    try {
      await adapter.verify(await this.secretOf(credential), (credential.settings ?? {}) as ProviderSettings);
    } catch (error) {
      lastError = providerFailure(error).message;
    }
    const updated = await prisma.dnsProviderCredential.update({
      where: { id: credential.id, tenantId: context.tenantId },
      data: { status: lastError ? "INVALID" : "ACTIVE", lastValidatedAt: new Date(), lastError },
      select: PUBLIC_FIELDS,
    });
    if ((credential.status === "ACTIVE") !== !lastError) {
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorType: "ADMIN",
        eventType: lastError ? "DNS_PROVIDER_INVALID" : "DNS_PROVIDER_RESTORED",
        targetType: "DnsProviderCredential",
        targetId: credential.id,
        requestId: context.requestId,
        metadata: { provider: credential.provider, error: lastError },
      });
    }
    return updated;
  }

  async remove(credentialId: string, context: AuditContext) {
    const credential = await this.load(credentialId, context.tenantId);
    const inUse = await prisma.mailDomain.findMany({
      where: { tenantId: context.tenantId, dnsCredentialId: credential.id, dnsProvider: { not: "MANUAL" } },
      select: { domainName: true },
    });
    if (inUse.length) {
      throw new AppError(
        `Switch ${inUse.map((domain) => domain.domainName).join(", ")} to manual DNS before removing this credential`,
        409,
        ErrorCodes.CONFLICT,
        { domains: inUse.map((domain) => domain.domainName) }
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.dnsProviderCredential.delete({ where: { id: credential.id } });
      await auditService.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorType: "ADMIN",
        eventType: "DNS_PROVIDER_REMOVED",
        targetType: "DnsProviderCredential",
        targetId: credential.id,
        requestId: context.requestId,
        metadata: { provider: credential.provider, label: credential.label },
      }, tx);
    });
    await deleteSecret(credential.secretRef, { purpose: "DNS provider credential (remove)", tenantId: context.tenantId }).catch(() => undefined);
    return { id: credential.id };
  }

  /** A zone client for one domain, or a provider error explaining why not. */
  async zoneFor(credentialId: string, tenantId: string, domainName: string): Promise<DnsZoneClient> {
    const credential = await this.load(credentialId, tenantId);
    if (credential.status !== "ACTIVE") {
      throw new DnsProviderError(`The ${credential.provider} credential "${credential.label}" is marked invalid: ${credential.lastError ?? "re-verify it"}`, 403);
    }
    const adapter = dnsProviderAdapter(credential.provider);
    if (!adapter) throw new DnsProviderError(`${credential.provider} is not supported`);
    return adapter.connect(await this.secretOf(credential), (credential.settings ?? {}) as ProviderSettings, domainName);
  }

  /** Ensures a credential exists in the tenant and matches the provider. */
  async assertUsable(credentialId: string, tenantId: string, provider: DnsProviderKind) {
    const credential = await this.load(credentialId, tenantId);
    if (credential.provider !== provider) {
      throw new AppError(`That credential is for ${credential.provider}, not ${provider}`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    return credential;
  }
}

export const dnsProviderService = new DnsProviderService();
