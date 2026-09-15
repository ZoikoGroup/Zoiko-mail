import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export interface RecordAuditEventInput {
  tenantId: string;
  actorUserId?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface AuditExportFilters {
  eventType?: string;
  eventTypePrefix?: string[];
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

export interface AuditEventFilters extends AuditExportFilters {
  page: number;
  limit: number;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

const sensitiveMetadataKey = /password|token|secret|authorization|cookie/i;

/**
 * What "Limited" means for an Admin reading the audit log.
 *
 * RBAC §2 records "View audit log" as Owner = Yes, Admin = **Limited**, and
 * leaves the word undefined. The reading that follows from the rest of the
 * matrix: an Admin may audit everything they could have done, and may not
 * audit the governance decisions taken over their head. Those are exactly the
 * capabilities the matrix withholds from Admin — billing, tenant lifecycle,
 * ownership transfer and support-grant approval.
 *
 * This is a withholding, not a security boundary: the events still exist and
 * the Owner sees them. It stops an Admin from reading, for example, the
 * commercial terms of the tenancy or the deliberations around their own
 * removal. Prefix matching keeps it stable as event names are added.
 *
 * Deliberately still visible to an Admin: support access events. Audit §11
 * requires support-access evidence to be "available to Owner/Admin", and the
 * Admin holds `support.grant.end`, so hiding those would break a capability
 * they do have.
 */
export const ADMIN_AUDIT_EXCLUDED_PREFIXES = [
  "BILLING_",
  "PLAN_",
  "SUBSCRIPTION_",
  "INVOICE_",
  "TENANT_DELETION",
  "TENANT_SUSPENDED",
  "TENANT_OWNERSHIP",
  "OWNERSHIP_TRANSFER",
] as const;

/** Roles that read the whole tenant log. Everyone else is scoped. */
type AuditReaderRole = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";

/**
 * The exclusion clause for a reader, or undefined when they see everything.
 * Kept separate from `list` so the same rule can be applied to exports and to
 * any future audit surface without being reimplemented.
 */
export function auditScopeFor(
  role: AuditReaderRole | null | undefined
): Prisma.AuditEventWhereInput | undefined {
  if (role !== "ADMIN") return undefined;
  return {
    NOT: ADMIN_AUDIT_EXCLUDED_PREFIXES.map((prefix) => ({
      eventType: { startsWith: prefix },
    })),
  };
}


/**
 * The row filter for a reader, shared by `list` and `exportRows`.
 *
 * Extracted because the export must return exactly what the screen would show
 * with the same filters. Two copies of this clause would eventually disagree,
 * and the direction that matters is an export widening past the scope — an
 * Admin downloading the billing events the screen withholds from them.
 */

/** One exported row: the event plus the actor columns the CSV names. */
const auditExportInclude = {
  actor: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.AuditEventInclude;

type AuditExportRow = Prisma.AuditEventGetPayload<{
  include: typeof auditExportInclude;
}>;

export function auditWhere(
  tenantId: string,
  filters: AuditExportFilters,
  readerRole?: AuditReaderRole | null
): Prisma.AuditEventWhereInput {
  const scope = auditScopeFor(readerRole);
  const prefixes = filters.eventTypePrefix ?? [];
  return {
    tenantId,
    eventType: filters.eventType,
    // OR-ed with each other, AND-ed with everything else — a category is a set
    // of prefixes, and narrowing by category must not widen anything.
    ...(prefixes.length
      ? { OR: prefixes.map((prefix) => ({ eventType: { startsWith: prefix } })) }
      : {}),
    actorUserId: filters.actorUserId,
    targetType: filters.targetType,
    targetId: filters.targetId,
    createdAt:
      filters.from || filters.to
        ? {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(filters.to) } : {}),
          }
        : undefined,
    // Applied after the caller's filters so an explicit eventType filter
    // cannot be used to reach past the scope.
    ...(scope ?? {}),
  };
}

export function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveMetadataKey.test(key) ? "[REDACTED]" : redactMetadata(child),
      ])
    );
  }
  return value;
}

export class AuditService {
  async record(
    input: RecordAuditEventInput,
    tx: Prisma.TransactionClient = prisma
  ): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        eventType: input.eventType,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async list(
    tenantId: string,
    filters: AuditEventFilters,
    readerRole?: AuditReaderRole | null
  ) {
    const where = auditWhere(tenantId, filters, readerRole);

    const [events, total] = await prisma.$transaction([
      prisma.auditEvent.findMany({
        where,
        include: {
          actor: { select: { id: true, email: true, displayName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return {
      events: events.map((event) => ({
        ...event,
        metadata: redactMetadata(event.metadata),
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * Every row matching the filters, in batches, oldest-last like the screen.
   *
   * A generator rather than one findMany because an audit log has no natural
   * ceiling: a year of a busy tenant is a lot of rows, and materialising them
   * to build a string would decide how much memory the process needs based on
   * how long the workspace has existed. Batches keep that flat however large
   * the answer is.
   *
   * Keyset pagination, not skip/take. With skip, a row written while the
   * export is running shifts every later page by one and the download silently
   * repeats or drops rows. Ordering by (createdAt desc, id desc) and carrying
   * the last pair forward is stable under concurrent writes, which an audit
   * log has by definition — this very export records one.
   */
  async *exportRows(
    tenantId: string,
    filters: AuditExportFilters,
    readerRole?: AuditReaderRole | null,
    batchSize = 500
  ) {
    const where = auditWhere(tenantId, filters, readerRole);
    let cursor: { createdAt: Date; id: string } | null = null;

    for (;;) {
      const page: AuditExportRow[] = await prisma.auditEvent.findMany({
        where: cursor
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : where,
        include: auditExportInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: batchSize,
      });

      if (page.length === 0) return;
      yield page.map((event) => ({ ...event, metadata: redactMetadata(event.metadata) }));
      if (page.length < batchSize) return;

      const last: AuditExportRow = page[page.length - 1]!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }

  async getById(
    tenantId: string,
    eventId: string,
    readerRole?: AuditReaderRole | null
  ) {
    // Same scope as `list`, or an Admin could read a withheld event by id.
    const event = await prisma.auditEvent.findFirst({
      where: { id: eventId, tenantId, ...(auditScopeFor(readerRole) ?? {}) },
      include: {
        actor: { select: { id: true, email: true, displayName: true } },
      },
    });
    return event ? { ...event, metadata: redactMetadata(event.metadata) } : null;
  }
}

export const auditService = new AuditService();
