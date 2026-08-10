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

export interface AuditEventFilters {
  page: number;
  limit: number;
  eventType?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

const sensitiveMetadataKey = /password|token|secret|authorization|cookie/i;

function redactMetadata(value: unknown): unknown {
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

  async list(tenantId: string, filters: AuditEventFilters) {
    const where: Prisma.AuditEventWhereInput = {
      tenantId,
      eventType: filters.eventType,
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
    };

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

  async getById(tenantId: string, eventId: string) {
    const event = await prisma.auditEvent.findFirst({
      where: { id: eventId, tenantId },
      include: {
        actor: { select: { id: true, email: true, displayName: true } },
      },
    });
    return event ? { ...event, metadata: redactMetadata(event.metadata) } : null;
  }
}

export const auditService = new AuditService();
