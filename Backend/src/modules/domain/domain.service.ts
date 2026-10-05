import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Prisma,
  type DmarcPolicy,
  type DnsCheckTrigger,
  type DnsProviderKind,
  type DnsRecordPurpose,
  type DnsRecordState,
  type DnsRecordStatus,
  type DomainDnsRecord,
  type NotificationType,
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";
import { cursorArgs, toPage } from "../../common/utils/pagination.js";
import { dkimService, type GeneratedDkimKey } from "./dkim.service.js";
import { dnsProviderService, type AuditContext } from "./dns-provider.service.js";
import { publishRecord, unpublishRecord } from "./dns.publisher.js";
import {
  expectedRecords,
  platformDnsConfig,
  platformOwnedDomains,
  zoneFile,
  type DnsRecordSpec,
} from "./dns.records.js";
import { createDnsLookup, type DnsLookup } from "./dns.resolver.js";
import { evaluateRecord, lookupAll, outcomeFor, type RecordEvaluation } from "./dns.verifier.js";
import { nextCheckDelayMs, readiness, transition, type LifecycleEvent } from "./domain.lifecycle.js";

/**
 * Custom-domain lifecycle: creation → record generation → publication →
 * verification → activation → ongoing synchronization → removal.
 *
 * The one method that matters is `synchronize`. Creation, configuration
 * changes, DKIM rotation, the admin's "re-check" button and the background
 * scheduler all end up there, so there is exactly one path by which a
 * domain's records are reconciled, published, looked up and turned into a
 * status — and no way for two screens to disagree about what a domain needs.
 */

const DETAIL_INCLUDE = {
  records: true,
  dkimKeys: { where: { status: { not: "RETIRED" } }, orderBy: { createdAt: "asc" } },
  dnsCredential: { select: { id: true, provider: true, label: true, status: true } },
} satisfies Prisma.MailDomainInclude;

type DomainDetail = Prisma.MailDomainGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const PURPOSE_ORDER: DnsRecordPurpose[] = ["OWNERSHIP", "MX", "SPF", "DKIM", "DMARC", "AUTODISCOVER", "AUTOCONFIG"];
const HOUR = 3_600_000;

export interface DomainConfigInput {
  dnsProvider?: DnsProviderKind;
  dnsCredentialId?: string | null;
  receivingEnabled?: boolean;
  replaceExistingMx?: boolean;
  autoActivateSending?: boolean;
  dmarcPolicy?: DmarcPolicy;
  dmarcReportEmail?: string | null;
}

export interface AddDomainInput extends DomainConfigInput {
  domainName: string;
}

interface SyncOptions {
  trigger: DnsCheckTrigger;
  actorUserId?: string | null;
  requestId?: string;
}

/** The old per-record status columns, derived from record states. */
function legacyStatus(states: DnsRecordState[]): DnsRecordStatus {
  if (states.length === 0 || states.every((state) => state === "PENDING")) return "PENDING";
  return states.every((state) => state === "VERIFIED") ? "VALID" : "INVALID";
}

function toSpec(record: DomainDnsRecord): DnsRecordSpec {
  return {
    recordKey: record.recordKey,
    purpose: record.purpose,
    type: record.type,
    name: record.name,
    fqdn: record.fqdn,
    value: record.value,
    priority: record.priority,
    ttl: record.ttl,
    required: record.required,
    dkimKeyId: record.dkimKeyId,
  };
}

function sortRecords<T extends { purpose: DnsRecordPurpose; recordKey: string }>(records: T[]): T[] {
  return [...records].sort((a, b) =>
    PURPOSE_ORDER.indexOf(a.purpose) - PURPOSE_ORDER.indexOf(b.purpose) || a.recordKey.localeCompare(b.recordKey));
}

/**
 * What a client sees. The DKIM private-key ref and the credential's secret
 * ref are internal and stay here; the public key is already in `records`.
 */
export function serializeDomain(domain: DomainDetail) {
  const { records, dkimKeys, dnsCredential, ...rest } = domain;
  const sorted = sortRecords(records);
  const ready = readiness(sorted.map((record) => ({ purpose: record.purpose, required: record.required, state: record.state })));
  return {
    ...rest,
    dnsCredential,
    records: sorted.map((record) => ({
      id: record.id,
      recordKey: record.recordKey,
      purpose: record.purpose,
      type: record.type,
      name: record.name,
      fqdn: record.fqdn,
      value: record.value,
      priority: record.priority,
      ttl: record.ttl,
      required: record.required,
      state: record.state,
      status: legacyStatus([record.state]),
      observed: record.observed,
      diagnosis: record.diagnosis,
      lastErrorCode: record.lastErrorCode,
      lastCheckedAt: record.lastCheckedAt,
      lastVerifiedAt: record.lastVerifiedAt,
      publishState: record.publishState,
      publishedAt: record.publishedAt,
      publishError: record.publishError,
    })),
    dkimKeys: dkimKeys.map((key) => ({
      id: key.id,
      selector: key.selector,
      keyBits: key.keyBits,
      status: key.status,
      activatedAt: key.activatedAt,
      retiringAt: key.retiringAt,
      createdAt: key.createdAt,
    })),
    readiness: { sendReady: ready.sendReady, fullyReady: ready.fullyReady, blocking: ready.blocking },
  };
}

export type SerializedDomain = ReturnType<typeof serializeDomain>;

function configSnapshot(domain: Pick<DomainDetail, "dnsProvider" | "dnsCredentialId" | "receivingEnabled" | "replaceExistingMx" | "autoActivateSending" | "dmarcPolicy" | "dmarcReportEmail">) {
  return {
    dnsProvider: domain.dnsProvider,
    dnsCredentialId: domain.dnsCredentialId,
    receivingEnabled: domain.receivingEnabled,
    replaceExistingMx: domain.replaceExistingMx,
    autoActivateSending: domain.autoActivateSending,
    dmarcPolicy: domain.dmarcPolicy,
    dmarcReportEmail: domain.dmarcReportEmail,
  };
}

const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Where a failed lookup is reported in the legacy `errorDetails` map. */
function errorKey(record: DomainDnsRecord): string {
  switch (record.purpose) {
    case "OWNERSHIP":
    case "SPF": return "txt";
    case "MX": return "mx";
    case "DKIM": return record.required ? "dkim" : record.recordKey.toLowerCase();
    case "DMARC": return "dmarc";
    default: return record.recordKey.toLowerCase();
  }
}

const EVENT_AUDIT: Record<LifecycleEvent, string> = {
  VERIFIED: "DOMAIN_VERIFIED",
  AUTO_ACTIVATED: "DOMAIN_SENDING_ACTIVATED",
  AT_RISK: "DOMAIN_SENDING_AT_RISK",
  SUSPENDED: "DOMAIN_SENDING_SUSPENDED",
  RESUMED: "DOMAIN_SENDING_RESUMED",
  VERIFICATION_FAILED: "DOMAIN_VERIFICATION_FAILED",
  VERIFICATION_LOST: "DOMAIN_VERIFICATION_LOST",
};

export class DomainService {
  private lookupFactory: () => DnsLookup = createDnsLookup;

  /** Test seam: answer DNS lookups from a fake. */
  setLookupFactory(factory: () => DnsLookup): () => void {
    const previous = this.lookupFactory;
    this.lookupFactory = factory;
    return () => {
      this.lookupFactory = previous;
    };
  }

  private async load(domainId: string, tenantId: string): Promise<DomainDetail> {
    const domain = await prisma.mailDomain.findFirst({ where: { id: domainId, tenantId }, include: DETAIL_INCLUDE });
    if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
    return domain;
  }

  async list(tenantId: string, options: { limit?: number; cursor?: string } = {}) {
    const limit = options.limit ?? 50;
    const rows = await prisma.mailDomain.findMany({
      where: { tenantId },
      include: DETAIL_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorArgs(limit, options.cursor),
    });
    const page = toPage(rows, limit);
    return { items: page.items.map(serializeDomain), nextCursor: page.nextCursor };
  }

  async get(domainId: string, tenantId: string) {
    return serializeDomain(await this.load(domainId, tenantId));
  }

  // ── creation ─────────────────────────────────────────────────────────────

  private async assertProvider(tenantId: string, provider: DnsProviderKind, credentialId: string | null | undefined) {
    if (provider === "MANUAL") return;
    if (!credentialId) {
      throw new AppError(`Choose a ${provider} credential to publish records automatically`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    await dnsProviderService.assertUsable(credentialId, tenantId, provider);
  }

  async add(input: AddDomainInput, context: AuditContext) {
    const { tenantId, userId } = context;
    const domainName = input.domainName;

    const owned = platformOwnedDomains().find((root) => domainName === root || domainName.endsWith(`.${root}`));
    if (owned) {
      throw new AppError(`${domainName} belongs to the Zoiko Mail platform and cannot be added as a custom domain`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (await prisma.mailDomain.findFirst({ where: { tenantId, domainName }, select: { id: true } })) {
      throw new AppError("Domain already exists", 409, ErrorCodes.CONFLICT);
    }
    // Unverified claims elsewhere do not block, or anyone could squat a
    // domain by adding it first. A verified one does: two workspaces able to
    // send as the same domain is a spoofing primitive.
    if (await prisma.mailDomain.findFirst({ where: { domainName, tenantId: { not: tenantId }, verificationStatus: "VERIFIED" }, select: { id: true } })) {
      throw new AppError("This domain is already verified by another workspace", 409, ErrorCodes.CONFLICT);
    }

    const dnsProvider = input.dnsProvider ?? "MANUAL";
    const dnsCredentialId = dnsProvider === "MANUAL" ? null : input.dnsCredentialId ?? null;
    await this.assertProvider(tenantId, dnsProvider, dnsCredentialId);

    const id = randomUUID();
    const now = new Date();
    // Generated before the transaction because it writes to the secret
    // store; discarded again if the transaction does not commit.
    const key = await dkimService.generate(id, tenantId, []);
    try {
      await prisma.$transaction(async (tx) => {
        const domain = await tx.mailDomain.create({
          data: {
            id,
            tenantId,
            domainName,
            verificationToken: `zoiko-mail-verification=${randomBytes(24).toString("hex")}`,
            dnsProvider,
            dnsCredentialId,
            receivingEnabled: input.receivingEnabled ?? true,
            replaceExistingMx: input.replaceExistingMx ?? false,
            autoActivateSending: input.autoActivateSending ?? true,
            dmarcPolicy: input.dmarcPolicy ?? "NONE",
            dmarcReportEmail: input.dmarcReportEmail ?? null,
            status: "PENDING_VERIFICATION",
            // The first check is due immediately; the scheduler picks it up
            // on its next pass.
            nextCheckAt: now,
            verificationDeadlineAt: new Date(now.getTime() + env.DNS_VERIFICATION_WINDOW_HOURS * HOUR),
          },
        });
        const keyRow = await dkimService.createRow(tx, { ...key, domainId: id, tenantId, active: true });
        const specs = expectedRecords(domain, [keyRow]);
        await tx.domainDnsRecord.createMany({
          data: specs.map((spec) => ({
            ...spec,
            tenantId,
            domainId: id,
            publishState: dnsProvider === "MANUAL" ? "NOT_APPLICABLE" : "PENDING",
          })),
        });
        await auditService.record({
          tenantId, actorUserId: userId, actorType: "ADMIN", eventType: "DOMAIN_ADDED",
          targetType: "MailDomain", targetId: id, requestId: context.requestId,
          metadata: { domainName, dnsProvider },
        }, tx);
        await auditService.record({
          tenantId, actorUserId: userId, actorType: "ADMIN", eventType: "DOMAIN_DNS_RECORDS_GENERATED",
          targetType: "MailDomain", targetId: id, requestId: context.requestId,
          metadata: { records: specs.map((spec) => spec.recordKey), dkimSelector: key.selector, keyBits: key.keyBits },
        }, tx);
      });
    } catch (error) {
      await dkimService.discard(key.privateKeySecretRef, tenantId);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("Domain already exists", 409, ErrorCodes.CONFLICT);
      }
      throw error;
    }

    if (dnsProvider !== "MANUAL") {
      // Publishing is best-effort here: the domain exists either way, and a
      // failure is recorded on the records and retried by the scheduler.
      await this.publishRecords(await this.load(id, tenantId), context, "pending").catch((error: unknown) => {
        logger.warn({ error, domainId: id }, "Initial DNS publish failed; the synchronizer will retry");
      });
    }
    return this.get(id, tenantId);
  }

  // ── configuration ────────────────────────────────────────────────────────

  async updateConfig(domainId: string, patch: DomainConfigInput, context: AuditContext) {
    const domain = await this.load(domainId, context.tenantId);
    if (domain.type === "ZOIKO") throw new AppError("Zoiko-owned domains are managed by the platform", 409, ErrorCodes.CONFLICT);

    const dnsProvider = patch.dnsProvider ?? domain.dnsProvider;
    const dnsCredentialId = dnsProvider === "MANUAL"
      ? null
      : patch.dnsCredentialId !== undefined ? patch.dnsCredentialId : domain.dnsCredentialId;
    await this.assertProvider(context.tenantId, dnsProvider, dnsCredentialId);

    const before = configSnapshot(domain);
    const after = {
      ...before,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      dnsProvider,
      dnsCredentialId,
    };
    const changed = (Object.keys(before) as Array<keyof typeof before>).filter((key) => before[key] !== after[key]);
    if (changed.length === 0) return serializeDomain(domain);

    await prisma.$transaction(async (tx) => {
      await tx.mailDomain.update({
        where: { id: domain.id, tenantId: context.tenantId },
        data: {
          dnsProvider: after.dnsProvider,
          dnsCredentialId: after.dnsCredentialId,
          receivingEnabled: after.receivingEnabled,
          replaceExistingMx: after.replaceExistingMx,
          autoActivateSending: after.autoActivateSending,
          dmarcPolicy: after.dmarcPolicy,
          dmarcReportEmail: after.dmarcReportEmail,
          configVersion: { increment: 1 },
          nextCheckAt: new Date(),
        },
      });
      await auditService.record({
        tenantId: context.tenantId, actorUserId: context.userId, actorType: "ADMIN",
        eventType: "DOMAIN_CONFIG_UPDATED", targetType: "MailDomain", targetId: domain.id,
        requestId: context.requestId,
        metadata: { changed, before: Object.fromEntries(changed.map((key) => [key, before[key]])), after: Object.fromEntries(changed.map((key) => [key, after[key]])) },
        beforeHash: hashOf(before),
        afterHash: hashOf(after),
      }, tx);
    });

    // Regenerate and publish now so the screen shows the new records at once;
    // verification follows on the scheduler's next pass (nextCheckAt = now).
    const reconciled = await this.reconcile(await this.load(domain.id, context.tenantId), context);
    if (reconciled.removed.length) await this.unpublishSpecs(reconciled.domain, reconciled.removed, context, "Records no longer expected");
    if (reconciled.domain.dnsProvider !== "MANUAL") {
      // These change how records are written, not what they contain, so
      // nothing is marked pending by reconciliation — re-assert them all.
      const rewrite = changed.some((key) => key === "replaceExistingMx" || key === "dnsProvider" || key === "dnsCredentialId");
      await this.publishRecords(reconciled.domain, context, rewrite ? "all" : "pending");
    }
    return this.get(domain.id, context.tenantId);
  }

  // ── reconciliation ───────────────────────────────────────────────────────

  /**
   * Makes the stored records match what the domain should publish now.
   *
   * Runs on every synchronization, which is what makes infrastructure
   * changes self-applying: change DNS_MX_HOSTS and every domain's MX record
   * is regenerated, marked for republishing, and re-verified, with a grace
   * window so sending domains are not suspended while owners catch up.
   *
   * A domain with no active or pending DKIM key gets one — the upgrade path
   * for domains created before keys were generated.
   */
  private async reconcile(domain: DomainDetail, context: { tenantId: string; userId?: string | null; requestId?: string }) {
    let generated: GeneratedDkimKey | null = null;
    if (domain.type === "CUSTOM" && !domain.dkimKeys.some((key) => key.status === "ACTIVE" || key.status === "PENDING")) {
      const selectors = await prisma.domainDkimKey.findMany({ where: { domainId: domain.id, tenantId: domain.tenantId }, select: { selector: true } });
      generated = await dkimService.generate(domain.id, domain.tenantId, selectors.map((row) => row.selector));
    }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const keys = [...domain.dkimKeys];
        if (generated) {
          keys.push(await dkimService.createRow(tx, { ...generated, domainId: domain.id, tenantId: domain.tenantId, active: true }));
        }
        const specs = expectedRecords(domain, keys);
        const auto = domain.dnsProvider !== "MANUAL";
        const existing = new Map(domain.records.map((record) => [record.recordKey, record]));
        const created: DnsRecordSpec[] = [];
        const changed: DnsRecordSpec[] = [];

        for (const spec of specs) {
          const current = existing.get(spec.recordKey);
          existing.delete(spec.recordKey);
          if (!current) {
            await tx.domainDnsRecord.create({
              data: { ...spec, tenantId: domain.tenantId, domainId: domain.id, publishState: auto ? "PENDING" : "NOT_APPLICABLE" },
            });
            created.push(spec);
            continue;
          }
          const contentChanged = current.value !== spec.value || current.type !== spec.type
            || current.fqdn !== spec.fqdn || current.priority !== spec.priority;
          const metaChanged = current.required !== spec.required || current.ttl !== spec.ttl
            || current.dkimKeyId !== spec.dkimKeyId || current.name !== spec.name;
          const publishState = !auto
            ? "NOT_APPLICABLE"
            : contentChanged || current.publishState === "NOT_APPLICABLE" ? "PENDING" : current.publishState;
          if (!contentChanged && !metaChanged && publishState === current.publishState) continue;
          await tx.domainDnsRecord.update({
            where: { id: current.id },
            data: {
              ...spec,
              publishState,
              ...(contentChanged
                ? { state: "PENDING", observed: Prisma.DbNull, diagnosis: null, lastErrorCode: null, lastVerifiedAt: null, publishedAt: null, publishError: null }
                : {}),
            },
          });
          if (contentChanged) changed.push(spec);
        }

        const removed = [...existing.values()];
        if (removed.length) await tx.domainDnsRecord.deleteMany({ where: { id: { in: removed.map((record) => record.id) } } });

        const touchedRequired = [...created, ...changed].some((spec) => spec.required);
        const firstGeneration = domain.records.length === 0;
        if (created.length || changed.length || removed.length) {
          await tx.mailDomain.update({
            where: { id: domain.id },
            data: {
              ...(firstGeneration ? {} : { configVersion: { increment: 1 } }),
              // Owners need time to publish a record that did not exist before.
              ...(touchedRequired && domain.sendingEnabled && env.DNS_CHANGE_GRACE_HOURS > 0
                ? { graceUntil: new Date(Date.now() + env.DNS_CHANGE_GRACE_HOURS * HOUR) }
                : {}),
            },
          });
          await auditService.record({
            tenantId: domain.tenantId,
            actorUserId: context.userId ?? null,
            actorType: context.userId ? "ADMIN" : "SYSTEM",
            eventType: firstGeneration ? "DOMAIN_DNS_RECORDS_GENERATED" : "DOMAIN_DNS_RECORDS_UPDATED",
            targetType: "MailDomain",
            targetId: domain.id,
            requestId: context.requestId,
            metadata: {
              created: created.map((spec) => spec.recordKey),
              changed: changed.map((spec) => spec.recordKey),
              removed: removed.map((record) => record.recordKey),
              ...(generated ? { dkimSelector: generated.selector } : {}),
            },
          }, tx);
        }
        return { removed: removed.map(toSpec), created: created.length, changed: changed.length };
      });
      return { ...outcome, domain: await this.load(domain.id, domain.tenantId) };
    } catch (error) {
      if (generated) await dkimService.discard(generated.privateKeySecretRef, domain.tenantId);
      throw error;
    }
  }

  // ── publication ──────────────────────────────────────────────────────────

  /**
   * Pushes records to the domain's DNS host. `pending` publishes what has
   * not been published (or failed last time); `all` re-asserts every record,
   * which repairs one somebody deleted by hand.
   */
  private async publishRecords(domain: DomainDetail, context: { tenantId: string; userId?: string | null; requestId?: string }, mode: "pending" | "all") {
    if (domain.dnsProvider === "MANUAL" || !domain.dnsCredentialId) return { published: [], failed: [], skipped: true as const };
    const targets = domain.records.filter((record) => mode === "all" || record.publishState === "PENDING" || record.publishState === "FAILED");
    if (targets.length === 0) return { published: [], failed: [], skipped: false as const };

    const published: string[] = [];
    const failed: Array<{ recordKey: string; error: string }> = [];
    const notes: Array<{ recordKey: string; note: string }> = [];
    const now = new Date();

    let zone;
    try {
      zone = await dnsProviderService.zoneFor(domain.dnsCredentialId, domain.tenantId, domain.domainName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The DNS provider could not be reached";
      for (const record of targets) failed.push({ recordKey: record.recordKey, error: message });
    }

    if (zone) {
      const platformMx = platformDnsConfig().mxHosts;
      for (const record of targets) {
        const outcome = await publishRecord(zone, toSpec(record), { replaceExistingMx: domain.replaceExistingMx, platformMx });
        if (outcome.status === "FAILED") failed.push({ recordKey: record.recordKey, error: outcome.error });
        else {
          published.push(record.recordKey);
          if (outcome.note) notes.push({ recordKey: record.recordKey, note: outcome.note });
        }
      }
    }

    const failedKeys = new Map(failed.map((entry) => [entry.recordKey, entry.error]));
    await prisma.$transaction(async (tx) => {
      for (const record of targets) {
        const error = failedKeys.get(record.recordKey);
        await tx.domainDnsRecord.update({
          where: { id: record.id },
          data: error
            ? { publishState: "FAILED", publishError: error.slice(0, 1000) }
            : { publishState: "PUBLISHED", publishedAt: now, publishError: null },
        });
      }
      await tx.mailDomain.update({
        where: { id: domain.id },
        data: {
          lastPublishedAt: published.length ? now : domain.lastPublishedAt,
          lastSyncError: failed.length ? `Publishing failed: ${failed[0]!.error}`.slice(0, 1000) : null,
          // A just-published record needs a moment to propagate; look soon.
          ...(published.length ? { nextCheckAt: new Date(now.getTime() + 60_000) } : {}),
        },
      });
      await auditService.record({
        tenantId: domain.tenantId,
        actorUserId: context.userId ?? null,
        actorType: context.userId ? "ADMIN" : "SYSTEM",
        eventType: failed.length ? "DOMAIN_DNS_PUBLISH_FAILED" : "DOMAIN_DNS_PUBLISHED",
        targetType: "MailDomain",
        targetId: domain.id,
        requestId: context.requestId,
        metadata: { provider: domain.dnsProvider, mode, published, failed, notes },
      }, tx);
    });
    return { published, failed, skipped: false as const };
  }

  /** Best-effort removal from the DNS host; failures are audited, not thrown. */
  private async unpublishSpecs(domain: DomainDetail, specs: DnsRecordSpec[], context: { tenantId: string; userId?: string | null; requestId?: string }, reason: string) {
    if (domain.dnsProvider === "MANUAL" || !domain.dnsCredentialId || specs.length === 0) return { removed: [], failed: [] };
    const removed: string[] = [];
    const failed: Array<{ recordKey: string; error: string }> = [];
    try {
      const zone = await dnsProviderService.zoneFor(domain.dnsCredentialId, domain.tenantId, domain.domainName);
      for (const spec of specs) {
        const outcome = await unpublishRecord(zone, spec);
        if (outcome.status === "FAILED") failed.push({ recordKey: spec.recordKey, error: outcome.error });
        else removed.push(spec.recordKey);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The DNS provider could not be reached";
      for (const spec of specs) failed.push({ recordKey: spec.recordKey, error: message });
    }
    await auditService.record({
      tenantId: domain.tenantId,
      actorUserId: context.userId ?? null,
      actorType: context.userId ? "ADMIN" : "SYSTEM",
      eventType: "DOMAIN_DNS_UNPUBLISHED",
      targetType: "MailDomain",
      targetId: domain.id,
      requestId: context.requestId,
      metadata: { reason, removed, failed },
    });
    return { removed, failed };
  }

  async publish(domainId: string, context: AuditContext) {
    const domain = await this.load(domainId, context.tenantId);
    if (domain.dnsProvider === "MANUAL") {
      throw new AppError("This domain uses manual DNS. Connect a DNS provider to publish automatically, or download the zone file.", 409, ErrorCodes.CONFLICT);
    }
    const result = await this.publishRecords(domain, context, "all");
    return { ...(await this.get(domainId, context.tenantId)), publishResult: { published: result.published, failed: result.failed } };
  }

  // ── verification ─────────────────────────────────────────────────────────

  async diagnostics(domainId: string, context: AuditContext) {
    const domain = await this.load(domainId, context.tenantId);
    const cooldown = env.DNS_MANUAL_CHECK_COOLDOWN_MS;
    if (cooldown > 0 && domain.lastCheckedAt && Date.now() - domain.lastCheckedAt.getTime() < cooldown) {
      throw new AppError("This domain was checked a moment ago. Wait a few seconds before checking again.", 429, ErrorCodes.RATE_LIMIT_EXCEEDED, {
        retryAfterMs: cooldown - (Date.now() - domain.lastCheckedAt.getTime()),
      });
    }
    // An admin re-checking a domain that timed out is working on it right
    // now, which is exactly when daily checks are too slow. Give it a fresh
    // window and the fast schedule; if the records are already there, the
    // check below verifies it on the spot.
    if (domain.status === "FAILED") {
      await prisma.$transaction(async (tx) => {
        await tx.mailDomain.update({
          where: { id: domain.id, tenantId: context.tenantId },
          data: {
            status: "PENDING_VERIFICATION",
            verificationDeadlineAt: new Date(Date.now() + env.DNS_VERIFICATION_WINDOW_HOURS * HOUR),
          },
        });
        await auditService.record({
          tenantId: context.tenantId, actorUserId: context.userId, actorType: "ADMIN",
          eventType: "DOMAIN_VERIFICATION_RESTARTED", targetType: "MailDomain", targetId: domain.id,
          requestId: context.requestId, metadata: { windowHours: env.DNS_VERIFICATION_WINDOW_HOURS },
        }, tx);
      });
    }
    return serializeDomain(await this.synchronize(domainId, context.tenantId, { trigger: "MANUAL", actorUserId: context.userId, requestId: context.requestId }));
  }

  /**
   * The whole pipeline for one domain: retire expired keys, reconcile the
   * expected records, publish what is unpublished, look everything up,
   * promote a verified DKIM rotation, apply the lifecycle transition, and
   * schedule the next check. Idempotent — running it twice in a row changes
   * nothing the second time except timestamps.
   */
  async synchronize(domainId: string, tenantId: string, options: SyncOptions): Promise<DomainDetail> {
    const started = Date.now();
    const context = { tenantId, userId: options.actorUserId ?? null, requestId: options.requestId };
    let domain = await this.load(domainId, tenantId);
    if (domain.type === "ZOIKO") {
      await prisma.mailDomain.update({ where: { id: domain.id }, data: { nextCheckAt: null } });
      return domain;
    }

    await this.retireExpiredKeys(domain);
    const reconciled = await this.reconcile(await this.load(domainId, tenantId), context);
    domain = reconciled.domain;
    if (reconciled.removed.length) await this.unpublishSpecs(domain, reconciled.removed, context, "Records no longer expected");
    if (domain.dnsProvider !== "MANUAL" && domain.records.some((record) => record.publishState === "PENDING" || record.publishState === "FAILED")) {
      await this.publishRecords(domain, context, "pending");
      domain = await this.load(domainId, tenantId);
    }

    const specs = domain.records.map(toSpec);
    const config = platformDnsConfig();
    const results = await lookupAll(specs, this.lookupFactory());
    const verification = { platformMxHosts: config.mxHosts.map((mx) => mx.host) };
    const evaluations = new Map<string, RecordEvaluation>(
      domain.records.map((record) => [record.recordKey, evaluateRecord(toSpec(record), outcomeFor(results, toSpec(record)), record.state, verification)])
    );

    // A rotation completes once the new key's record is live: it becomes the
    // signing key, and the old one keeps its record for mail in flight.
    const pendingKey = domain.dkimKeys.find((key) => key.status === "PENDING");
    const pendingRecord = pendingKey && domain.records.find((record) => record.dkimKeyId === pendingKey.id);
    const promotion = pendingKey && pendingRecord && evaluations.get(pendingRecord.recordKey)?.state === "VERIFIED"
      ? { newKey: pendingKey, oldKeys: domain.dkimKeys.filter((key) => key.status === "ACTIVE") }
      : null;
    const requiredFor = (record: DomainDnsRecord) => {
      if (!promotion || record.purpose !== "DKIM") return record.required;
      if (record.dkimKeyId === promotion.newKey.id) return true;
      if (promotion.oldKeys.some((key) => key.id === record.dkimKeyId)) return false;
      return record.required;
    };

    const stateOf = (record: DomainDnsRecord) => evaluations.get(record.recordKey)!.state;
    const ready = readiness(domain.records.map((record) => ({ purpose: record.purpose, required: requiredFor(record), state: stateOf(record) })));
    const now = new Date();
    const suspendedByDns = !domain.sendingEnabled && domain.status === "DEGRADED" && domain.sendingSuspendedAt !== null;
    const next = transition({
      status: domain.status,
      sendingEnabled: domain.sendingEnabled,
      suspendedByDns,
      autoActivateSending: domain.autoActivateSending,
      consecutiveFailures: domain.consecutiveFailures,
      readiness: ready,
      now,
      graceUntil: domain.graceUntil,
      verificationDeadlineAt: domain.verificationDeadlineAt,
      threshold: env.DNS_FAILURE_THRESHOLD,
    });
    // "At risk" is worth saying once, when the first failure happens, not
    // on every check of the grace window.
    const events = next.events.filter((event) => event !== "AT_RISK" || domain.consecutiveFailures === 0);

    const statesFor = (purpose: DnsRecordPurpose) =>
      domain.records.filter((record) => record.purpose === purpose && requiredFor(record)).map(stateOf);
    const ownership = statesFor("OWNERSHIP")[0] ?? "PENDING";
    const aggregates = {
      verificationStatus: ownership === "VERIFIED" ? "VERIFIED" as const : ownership === "PENDING" ? "PENDING" as const : "FAILED" as const,
      mxStatus: domain.receivingEnabled ? legacyStatus(statesFor("MX")) : "PENDING" as const,
      spfStatus: legacyStatus(statesFor("SPF")),
      dkimStatus: legacyStatus(statesFor("DKIM")),
      dmarcStatus: legacyStatus(statesFor("DMARC")),
    };

    const errorDetails: Record<string, { code: string; message: string }> = {};
    for (const record of domain.records) {
      const outcome = outcomeFor(results, toSpec(record));
      if (outcome && !outcome.ok) errorDetails[errorKey(record)] ??= { code: outcome.code, message: outcome.message };
    }
    const lookupErrors = [...results.values()].some((outcome) => !outcome.ok && outcome.kind === "ERROR");
    const delay = nextCheckDelayMs({
      status: next.status,
      fullyReady: ready.fullyReady,
      lookupErrors,
      rotationPending: Boolean(pendingKey && !promotion),
      createdAt: domain.createdAt,
      now,
      verifiedIntervalMs: env.DNS_RECHECK_VERIFIED_MS,
    });
    const changes = domain.records
      .filter((record) => record.state !== stateOf(record))
      .map((record) => ({ recordKey: record.recordKey, from: record.state, to: stateOf(record) }));
    const resultRows = domain.records.map((record) => {
      const evaluation = evaluations.get(record.recordKey)!;
      return {
        recordKey: record.recordKey,
        purpose: record.purpose,
        required: requiredFor(record),
        state: evaluation.state,
        observed: evaluation.observed,
        diagnosis: evaluation.diagnosis,
        errorCode: evaluation.errorCode,
      };
    });
    const manual = options.trigger === "MANUAL";

    await prisma.$transaction(async (tx) => {
      for (const record of domain.records) {
        const evaluation = evaluations.get(record.recordKey)!;
        await tx.domainDnsRecord.update({
          where: { id: record.id },
          data: {
            state: evaluation.state,
            observed: evaluation.observed,
            diagnosis: evaluation.diagnosis,
            lastErrorCode: evaluation.errorCode,
            lastCheckedAt: now,
            required: requiredFor(record),
            ...(evaluation.state === "VERIFIED" ? { lastVerifiedAt: now } : {}),
          },
        });
      }
      if (promotion) {
        await tx.domainDkimKey.update({ where: { id: promotion.newKey.id }, data: { status: "ACTIVE", activatedAt: now } });
        for (const key of promotion.oldKeys) {
          await tx.domainDkimKey.update({ where: { id: key.id }, data: { status: "RETIRING", retiringAt: now } });
        }
      }
      await tx.mailDomain.update({
        where: { id: domain.id },
        data: {
          ...aggregates,
          status: next.status,
          sendingEnabled: next.sendingEnabled,
          consecutiveFailures: next.consecutiveFailures,
          errorDetails,
          firstCheckedAt: domain.firstCheckedAt ?? now,
          lastCheckedAt: now,
          nextCheckAt: new Date(now.getTime() + delay),
          ...(ready.sendReady ? { lastVerifiedAt: now } : {}),
          ...(events.includes("SUSPENDED")
            ? { sendingSuspendedAt: now, activatedAt: null, suspensionReason: `Required DNS records failing: ${ready.blocking.join(", ")}` }
            : {}),
          ...(events.includes("RESUMED") || events.includes("AUTO_ACTIVATED")
            ? { sendingSuspendedAt: null, suspensionReason: null, activatedAt: now }
            : {}),
        },
      });
      await tx.domainDnsCheck.create({
        data: {
          tenantId,
          domainId: domain.id,
          ...aggregates,
          errorDetails,
          trigger: options.trigger,
          resultStatus: next.status,
          results: resultRows as Prisma.InputJsonValue,
          durationMs: Date.now() - started,
          checkedAt: now,
        },
      });

      if (manual) {
        await auditService.record({
          tenantId, actorUserId: context.userId, actorType: "ADMIN", eventType: "DOMAIN_DNS_CHECKED",
          targetType: "MailDomain", targetId: domain.id, requestId: context.requestId,
          metadata: { readyForSending: ready.sendReady, status: next.status, changes },
        }, tx);
      } else if (changes.length) {
        await auditService.record({
          tenantId, actorType: "SYSTEM", eventType: "DOMAIN_DNS_RECORD_CHANGED",
          targetType: "MailDomain", targetId: domain.id,
          metadata: { trigger: options.trigger, changes },
        }, tx);
      }
      if (promotion) {
        await auditService.record({
          tenantId, actorType: "SYSTEM", eventType: "DOMAIN_DKIM_ROTATED",
          targetType: "MailDomain", targetId: domain.id,
          metadata: { activeSelector: promotion.newKey.selector, retiringSelectors: promotion.oldKeys.map((key) => key.selector) },
        }, tx);
      }
      for (const event of events) {
        await auditService.record({
          tenantId, actorType: "SYSTEM", eventType: EVENT_AUDIT[event],
          targetType: "MailDomain", targetId: domain.id,
          metadata: { automatic: true, blocking: ready.blocking, consecutiveFailures: next.consecutiveFailures, trigger: options.trigger },
        }, tx);
        // Both are audited, but "verified" and "ready to send" in the same
        // instant is one piece of news to a person.
        if (event === "VERIFIED" && events.includes("AUTO_ACTIVATED")) continue;
        await this.notifyForEvent(tx, domain, event, ready.blocking);
      }
    });

    return this.load(domainId, tenantId);
  }

  private async notifyForEvent(tx: Prisma.TransactionClient, domain: DomainDetail, event: LifecycleEvent, blocking: DnsRecordPurpose[]) {
    const failing = blocking.join(", ") || "DNS";
    const messages: Partial<Record<LifecycleEvent, { type: NotificationType; title: string; body: string }>> = {
      AUTO_ACTIVATED: { type: "INFO", title: `${domain.domainName} is ready`, body: "Every required DNS record is verified, and sending from this domain is now enabled." },
      VERIFIED: { type: "INFO", title: `${domain.domainName} verified`, body: "Every required DNS record is verified. Enable sending when you are ready." },
      AT_RISK: { type: "WARNING", title: `DNS problem on ${domain.domainName}`, body: `${failing} failed verification. Sending continues for now, but it will be suspended if the records are not fixed.` },
      SUSPENDED: { type: "WARNING", title: `Sending suspended for ${domain.domainName}`, body: `${failing} kept failing verification, so sending was suspended to protect deliverability. It resumes by itself once the records pass.` },
      RESUMED: { type: "INFO", title: `Sending resumed for ${domain.domainName}`, body: "The DNS records pass again, and sending has resumed." },
      VERIFICATION_FAILED: { type: "ACTION_REQUIRED", title: `${domain.domainName} could not be verified`, body: `The ownership record was not found within ${env.DNS_VERIFICATION_WINDOW_HOURS} hours. Checks continue daily; publish the records to finish setup.` },
      VERIFICATION_LOST: { type: "WARNING", title: `${domain.domainName} no longer verifies`, body: `${failing} stopped passing verification.` },
    };
    const message = messages[event];
    if (!message) return;
    const admins = await tx.tenantMembership.findMany({
      where: { tenantId: domain.tenantId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    });
    if (admins.length === 0) return;
    await tx.notification.createMany({
      data: admins.map((admin) => ({ tenantId: domain.tenantId, userId: admin.userId, ...message, linkPath: "/admin/domains" })),
    });
  }

  // ── DKIM rotation ────────────────────────────────────────────────────────

  async rotateDkim(domainId: string, context: AuditContext) {
    const domain = await this.load(domainId, context.tenantId);
    if (domain.type === "ZOIKO") throw new AppError("Zoiko-owned domains are managed by the platform", 409, ErrorCodes.CONFLICT);
    const pending = domain.dkimKeys.find((key) => key.status === "PENDING");
    if (pending) {
      throw new AppError(`A rotation is already waiting for ${pending.selector}._domainkey to be published`, 409, ErrorCodes.CONFLICT);
    }
    const selectors = await prisma.domainDkimKey.findMany({ where: { domainId: domain.id, tenantId: context.tenantId }, select: { selector: true } });
    const key = await dkimService.generate(domain.id, context.tenantId, selectors.map((row) => row.selector));
    try {
      await prisma.$transaction(async (tx) => {
        await dkimService.createRow(tx, { ...key, domainId: domain.id, tenantId: context.tenantId, active: false });
        await tx.mailDomain.update({ where: { id: domain.id }, data: { nextCheckAt: new Date() } });
        await auditService.record({
          tenantId: context.tenantId, actorUserId: context.userId, actorType: "ADMIN",
          eventType: "DOMAIN_DKIM_ROTATION_STARTED", targetType: "MailDomain", targetId: domain.id,
          requestId: context.requestId, metadata: { selector: key.selector, keyBits: key.keyBits },
        }, tx);
      });
    } catch (error) {
      await dkimService.discard(key.privateKeySecretRef, context.tenantId);
      throw error;
    }
    const reconciled = await this.reconcile(await this.load(domain.id, context.tenantId), context);
    if (reconciled.domain.dnsProvider !== "MANUAL") await this.publishRecords(reconciled.domain, context, "pending");
    return this.get(domain.id, context.tenantId);
  }

  /** Removes keys whose post-rotation grace has passed, record and secret both. */
  private async retireExpiredKeys(domain: DomainDetail) {
    const cutoff = new Date(Date.now() - env.DNS_DKIM_RETIRE_GRACE_MS);
    const expired = domain.dkimKeys.filter((key) => key.status === "RETIRING" && key.retiringAt && key.retiringAt <= cutoff);
    if (expired.length === 0) return;
    await prisma.$transaction(async (tx) => {
      for (const key of expired) {
        await tx.domainDkimKey.update({ where: { id: key.id }, data: { status: "RETIRED", retiredAt: new Date() } });
      }
      await auditService.record({
        tenantId: domain.tenantId, actorType: "SYSTEM", eventType: "DOMAIN_DKIM_KEY_RETIRED",
        targetType: "MailDomain", targetId: domain.id,
        metadata: { selectors: expired.map((key) => key.selector) },
      }, tx);
    });
    for (const key of expired) await dkimService.discard(key.privateKeySecretRef, domain.tenantId);
  }

  // ── sending ──────────────────────────────────────────────────────────────

  async activate(domainId: string, context: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const domain = await tx.mailDomain.findFirst({ where: { id: domainId, tenantId: context.tenantId } });
      if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
      const activeKey = await tx.domainDkimKey.findFirst({ where: { domainId, tenantId: context.tenantId, status: "ACTIVE" }, select: { id: true } });
      const failures = [
        domain.verificationStatus !== "VERIFIED" ? "TXT ownership verification" : null,
        domain.spfStatus !== "VALID" ? "SPF" : null,
        domain.dkimStatus !== "VALID" || !activeKey ? "DKIM" : null,
        domain.dmarcStatus !== "VALID" ? "DMARC (minimum p=none)" : null,
      ].filter(Boolean);
      if (failures.length) {
        throw new AppError(`Domain cannot send until these checks pass: ${failures.join(", ")}`, 409, ErrorCodes.CONFLICT);
      }
      const activated = await tx.mailDomain.update({
        where: { id: domain.id, tenantId: context.tenantId },
        data: {
          sendingEnabled: true,
          activatedAt: new Date(),
          status: "ACTIVE",
          consecutiveFailures: 0,
          sendingSuspendedAt: null,
          suspensionReason: null,
        },
      });
      await auditService.record({
        tenantId: context.tenantId, actorUserId: context.userId, actorType: "ADMIN",
        eventType: "DOMAIN_SENDING_ACTIVATED", targetType: "MailDomain", targetId: domain.id,
        requestId: context.requestId, metadata: { automatic: false },
      }, tx);
      return activated;
    });
  }

  /**
   * Switches sending off by hand. Also turns off auto-activation, or the
   * next passing check would switch it straight back on.
   */
  async deactivate(domainId: string, context: AuditContext) {
    const domain = await this.load(domainId, context.tenantId);
    if (!domain.sendingEnabled && domain.status !== "DEGRADED") {
      throw new AppError("Sending is not enabled for this domain", 409, ErrorCodes.CONFLICT);
    }
    await prisma.$transaction(async (tx) => {
      await tx.mailDomain.update({
        where: { id: domain.id, tenantId: context.tenantId },
        data: {
          sendingEnabled: false,
          autoActivateSending: false,
          activatedAt: null,
          sendingSuspendedAt: null,
          suspensionReason: null,
          status: domain.verificationStatus === "VERIFIED" ? "VERIFIED" : "PENDING_VERIFICATION",
        },
      });
      await auditService.record({
        tenantId: context.tenantId, actorUserId: context.userId, actorType: "ADMIN",
        eventType: "DOMAIN_SENDING_DEACTIVATED", targetType: "MailDomain", targetId: domain.id,
        requestId: context.requestId,
      }, tx);
    });
    return this.get(domain.id, context.tenantId);
  }

  // ── history and export ───────────────────────────────────────────────────

  async listChecks(domainId: string, tenantId: string) {
    const domain = await prisma.mailDomain.findFirst({ where: { id: domainId, tenantId }, select: { id: true } });
    if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.domainDnsCheck.findMany({
      where: { tenantId, domainId },
      orderBy: { checkedAt: "desc" },
      take: 100,
    });
  }

  async zoneFile(domainId: string, tenantId: string) {
    const domain = await this.load(domainId, tenantId);
    return { domainName: domain.domainName, content: zoneFile(domain.domainName, sortRecords(domain.records)) };
  }

  // ── removal ──────────────────────────────────────────────────────────────

  async remove(domainId: string, context: AuditContext) {
    const domain = await this.load(domainId, context.tenantId);
    if (domain.sendingEnabled) {
      throw new AppError("Domain is active for sending and cannot be deleted", 409, ErrorCodes.CONFLICT);
    }
    const mailboxes = await prisma.mailbox.count({ where: { tenantId: context.tenantId, domainId: domain.id } });
    if (mailboxes > 0) {
      throw new AppError(`${mailboxes} mailbox(es) still use ${domain.domainName}. Move or delete them first.`, 409, ErrorCodes.CONFLICT, { mailboxes });
    }

    // Take our records back out of the customer's DNS before forgetting
    // which ones they were. Best-effort: a provider outage must not make a
    // domain impossible to remove, and whatever failed is in the audit event.
    const unpublished = await this.unpublishSpecs(domain, domain.records.map(toSpec), context, "Domain removed");
    const keys = await prisma.domainDkimKey.findMany({ where: { domainId: domain.id, tenantId: context.tenantId }, select: { privateKeySecretRef: true } });

    await prisma.$transaction(async (tx) => {
      await tx.mailDomain.delete({ where: { id: domain.id } });
      await auditService.record({
        tenantId: context.tenantId, actorUserId: context.userId, actorType: "ADMIN",
        eventType: "DOMAIN_REMOVED", targetType: "MailDomain", targetId: domain.id,
        requestId: context.requestId,
        metadata: { domainName: domain.domainName, unpublished: unpublished.removed.length, unpublishFailures: unpublished.failed },
      }, tx);
    });
    for (const key of keys) await dkimService.discard(key.privateKeySecretRef, context.tenantId);
    return { id: domain.id, domainName: domain.domainName };
  }
}

export const domainService = new DomainService();
