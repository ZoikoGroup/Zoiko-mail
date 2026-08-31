import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { auditService } from "../audit/audit.service.js";
import { membershipRepository } from "../membership/membership.repository.js";
import { tenantRepository } from "./tenant.repository.js";
import { AuditEventTypes } from "../auth/auth.types.js";
import type { UpdateTenantInput, UpdateGeneralSettingsInput } from "./tenant.schema.js";
import type { PolicyRules } from "../policy/policy.schema.js";

interface TenantContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface WorkspaceCreationInput {
  tenantName: string;
  planCode: string;
}

interface RequestContext {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface WorkspaceCreationResult {
  tenantId: string;
  membershipId: string;
}

/**
 * Policy evaluation fails closed: policyService.evaluate() returns DENY with
 * reason NO_ACTIVE_POLICY when a tenant has no active policy of that type.
 * A workspace created without these cannot send mail at all.
 *
 * These are permissive at the policy layer on purpose. Abuse, rate limiting
 * and deliverability are handled by deliveryProtectionService and mailbox
 * warm-up; having two systems act as the anti-spam gate causes bugs that are
 * hard to trace.
 */
const DEFAULT_POLICIES: Array<{
  type: "SENDING" | "AI";
  name: string;
  description: string;
  rules: PolicyRules;
}> = [
    {
      type: "SENDING",
      name: "Default sending policy",
      description: "Allows outbound sending. Add conditions to restrict.",
      rules: { defaultEffect: "ALLOW", conditions: [] },
    },
    {
      type: "AI",
      name: "Default AI policy",
      description: "Allows AI extraction and drafting.",
      rules: { defaultEffect: "ALLOW", conditions: [] },
    },
  ];

const tenantSelect = {
  id: true,
  name: true,
  status: true,
  planCode: true,
  timezone: true,
  language: true,
  logoUrl: true,
  allowedDomains: true,
  settings: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

export class TenantService {
  async getCurrent(context: TenantContext) {
    return prisma.tenant.findFirstOrThrow({
      where: { id: context.tenantId },
      select: tenantSelect,
    });
  }

  async getUsage(context: TenantContext, days: number = 30) {
    const tenantId = context.tenantId;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [
      tenant,
      mailboxes,
      emailStats,
      emailVolume,
      emailVolumeByStatusRows,
      apiVolume,
      deliveryStats,
      attachmentsAggregate,
      topMailboxActivity,
      activeMembers,
      totalDomains,
      connectedAccounts,
    ] = await Promise.all([
      prisma.tenant.findFirstOrThrow({
        where: { id: tenantId },
        select: { planCode: true, createdAt: true },
      }),
      prisma.mailbox.findMany({
        where: { tenantId },
        select: {
          id: true,
          storageUsed: true,
          storageLimit: true,
          address: true,
        },
      }),
      prisma.emailMessage.groupBy({
        by: ["status"],
        where: { tenantId, createdAt: { gte: since } },
        _count: { id: true },
      }),
      prisma.$queryRaw<{ date: Date; count: bigint }[]>(
        Prisma.sql`
          SELECT DATE("created_at") as date, COUNT(*) as count
          FROM "email_messages"
          WHERE "tenant_id" = ${tenantId}::uuid AND "created_at" >= ${since}
          GROUP BY DATE("created_at")
          ORDER BY date ASC
        `
      ),
      prisma.$queryRaw<{ date: Date; status: string; count: bigint }[]>(
        Prisma.sql`
          SELECT DATE("created_at") as date, "status"::text as status, COUNT(*) as count
          FROM "email_messages"
          WHERE "tenant_id" = ${tenantId}::uuid AND "created_at" >= ${since}
            AND "status" IN ('SENT', 'RECEIVED', 'FAILED')
          GROUP BY DATE("created_at"), "status"
          ORDER BY date ASC
        `
      ),
      prisma.$queryRaw<{ date: Date; count: bigint }[]>(
        Prisma.sql`
          SELECT DATE("created_at") as date, COUNT(*) as count
          FROM "audit_events"
          WHERE "tenant_id" = ${tenantId}::uuid AND "created_at" >= ${since}
          GROUP BY DATE("created_at")
          ORDER BY date ASC
        `
      ),
      prisma.deliveryEvent.groupBy({
        by: ["type"],
        where: { tenantId, createdAt: { gte: since } },
        _count: { id: true },
      }),
      prisma.messageAttachment.aggregate({
        where: { tenantId },
        _sum: { sizeBytes: true },
      }),
      prisma.mailboxMessage.groupBy({
        by: ["mailboxId"],
        where: { tenantId, createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { mailboxId: "desc" } },
        take: 5,
      }),
      prisma.tenantMembership.count({
        where: { tenantId, status: "ACTIVE" },
      }),
      prisma.mailDomain.count({
        where: { tenantId },
      }),
      prisma.connectedAccount.findMany({
        where: { tenantId },
        select: { status: true, provider: true },
      }),
    ]);

    const totalStorageUsed = mailboxes.reduce(
      (acc, m) => acc + Number(m.storageUsed),
      0
    );
    const totalStorageLimit = mailboxes.reduce(
      (acc, m) => acc + Number(m.storageLimit),
      0
    );

    const emailCounts = {
      sent: 0,
      received: 0,
      failed: 0,
      draft: 0,
      scheduled: 0,
    };
    for (const row of emailStats) {
      const count = Number(row._count.id);
      if (row.status === "SENT") emailCounts.sent += count;
      else if (row.status === "RECEIVED") emailCounts.received += count;
      else if (row.status === "FAILED") emailCounts.failed += count;
      else if (row.status === "DRAFT") emailCounts.draft += count;
      else if (row.status === "SCHEDULED" || row.status === "SENDING")
        emailCounts.scheduled += count;
    }

    const volumeByStatus = new Map<
      string,
      { date: string; sent: number; received: number; failed: number }
    >();
    for (const row of emailVolumeByStatusRows) {
      const date = row.date.toISOString().split("T")[0];
      const entry = volumeByStatus.get(date) ?? {
        date,
        sent: 0,
        received: 0,
        failed: 0,
      };
      const count = Number(row.count);
      if (row.status === "SENT") entry.sent += count;
      else if (row.status === "RECEIVED") entry.received += count;
      else if (row.status === "FAILED") entry.failed += count;
      volumeByStatus.set(date, entry);
    }

    const deliveryCounts = {
      delivered: 0,
      bounced: 0,
      failed: 0,
      rejected: 0,
      blocked: 0,
      complained: 0,
      deferred: 0,
      rateLimited: 0,
      providerErrors: 0,
    };
    for (const row of deliveryStats) {
      const count = Number(row._count.id);
      switch (row.type) {
        case "DELIVERED":
          deliveryCounts.delivered += count;
          break;
        case "BOUNCED":
          deliveryCounts.bounced += count;
          break;
        case "FAILED":
          deliveryCounts.failed += count;
          break;
        case "REJECTED":
          deliveryCounts.rejected += count;
          break;
        case "BLOCKED":
          deliveryCounts.blocked += count;
          break;
        case "COMPLAINED":
          deliveryCounts.complained += count;
          break;
        case "DEFERRED":
          deliveryCounts.deferred += count;
          break;
        case "RATE_LIMITED":
          deliveryCounts.rateLimited += count;
          break;
        case "PROVIDER_ERROR":
          deliveryCounts.providerErrors += count;
          break;
      }
    }
    const deliveryAttempts =
      deliveryCounts.delivered +
      deliveryCounts.bounced +
      deliveryCounts.failed +
      deliveryCounts.rejected +
      deliveryCounts.blocked;
    const deliverySuccessRate =
      deliveryAttempts > 0 ? deliveryCounts.delivered / deliveryAttempts : null;

    const addressById = new Map(mailboxes.map((m) => [m.id, m.address]));
    const topMailboxes = topMailboxActivity
      .map((row) => ({
        address: addressById.get(row.mailboxId),
        messageCount: Number(row._count.id),
      }))
      .filter((m): m is { address: string; messageCount: number } =>
        Boolean(m.address)
      );

    return {
      period: { days, since: since.toISOString() },
      planCode: tenant.planCode,
      storage: {
        used: totalStorageUsed,
        limit: totalStorageLimit,
        attachmentsBytes: attachmentsAggregate._sum.sizeBytes ?? 0,
        mailboxes: mailboxes.map((m) => ({
          address: m.address,
          used: Number(m.storageUsed),
          limit: Number(m.storageLimit),
        })),
      },
      mailboxes: {
        count: mailboxes.length,
      },
      emails: emailCounts,
      emailVolume: emailVolume.map((r) => ({
        date: r.date.toISOString().split("T")[0],
        count: Number(r.count),
      })),
      emailVolumeByStatus: [...volumeByStatus.values()],
      apiUsage: apiVolume.map((r) => ({
        date: r.date.toISOString().split("T")[0],
        count: Number(r.count),
      })),
      delivery: { ...deliveryCounts, successRate: deliverySuccessRate },
      topMailboxes,
      activeMembers,
      totalDomains,
      connectedAccounts: {
        total: connectedAccounts.length,
        active: connectedAccounts.filter((a) => a.status === "ACTIVE").length,
        providers: connectedAccounts.reduce(
          (acc, a) => {
            acc[a.provider] = (acc[a.provider] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
      },
    };
  }

  async getOnboardingStatus(context: TenantContext) {
    const tenantId = context.tenantId;

    const [domains, mailboxes, connectedAccounts, members] = await Promise.all([
      prisma.mailDomain.findMany({
        where: { tenantId },
        select: { id: true, verificationStatus: true, sendingEnabled: true },
      }),
      prisma.mailbox.findMany({
        where: { tenantId },
        select: { id: true },
      }),
      prisma.connectedAccount.findMany({
        where: { tenantId, status: "ACTIVE" },
        select: { id: true, provider: true },
      }),
      prisma.tenantMembership.findMany({
        where: { tenantId, status: { in: ["ACTIVE", "INVITED"] } },
        select: { id: true },
      }),
    ]);

    const steps = {
      workspaceCreated: true,
      domainAdded: domains.length > 0,
      domainVerified: domains.some((d) => d.verificationStatus === "VERIFIED"),
      mailboxCreated: mailboxes.length > 0,
      providerConnected: connectedAccounts.length > 0,
      teamInvited: members.length > 1,
    };

    const completedCount = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;
    const isComplete = completedCount === totalSteps;

    return {
      steps,
      completedCount,
      totalSteps,
      isComplete,
    };
  }

  async updateCurrent(input: UpdateTenantInput, context: TenantContext) {
    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: context.tenantId },
        data: input as Prisma.TenantUpdateInput,
        select: tenantSelect,
      });
      await auditService.record(
        {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "TENANT_SETTINGS_UPDATED",
          targetType: "Tenant",
          targetId: context.tenantId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { changedFields: Object.keys(input) },
        },
        tx
      );
      return tenant;
    });
  }

  async getGeneralSettings(context: TenantContext) {
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: context.tenantId },
      select: { settings: true, timezone: true, language: true },
    });
    const stored = (tenant.settings ?? {}) as Record<string, unknown>;
    const general = (stored.general ?? {}) as Record<string, unknown>;
    return {
      emailNotifications:
        typeof general.emailNotifications === "boolean" ? general.emailNotifications : true,
      digestFrequency:
        general.digestFrequency === "weekly" || general.digestFrequency === "none"
          ? general.digestFrequency
          : "daily",
      theme:
        general.theme === "light" || general.theme === "dark" || general.theme === "system"
          ? general.theme
          : "system",
      timezone: tenant.timezone ?? "UTC",
      language: tenant.language ?? "en",
    };
  }

  async updateGeneralSettings(input: UpdateGeneralSettingsInput, context: TenantContext) {
    return prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: context.tenantId },
        select: { settings: true },
      });
      const stored = (tenant.settings ?? {}) as Record<string, unknown>;
      const merged = {
        ...stored,
        general: { ...((stored.general ?? {}) as Record<string, unknown>), ...input },
      };
      const updated = await tx.tenant.update({
        where: { id: context.tenantId },
        data: { settings: merged as Prisma.InputJsonValue },
        select: tenantSelect,
      });
      await auditService.record(
        {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "TENANT_SETTINGS_UPDATED",
          targetType: "Tenant",
          targetId: context.tenantId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { changedFields: Object.keys(input).map((k) => `general.${k}`) },
        },
        tx
      );
      return updated;
    });
  }

  /**
   * Creates a Tenant + an OWNER TenantMembership for `ownerUserId` in a
   * single transaction, plus the audit trail entry. Extracted out of
   * auth.service.register, which used to do identity + tenant + membership
   * creation all at once. The caller (auth.service.createWorkspace) is
   * responsible for confirming the user doesn't already belong to a
   * workspace before calling this, and for issuing a session afterward.
   */
  async createWorkspace(
    input: WorkspaceCreationInput,
    ownerUserId: string,
    context: RequestContext
  ): Promise<WorkspaceCreationResult> {
    return prisma.$transaction(async (tx) => {
      const tenant = await tenantRepository.create(
        {
          name: input.tenantName,
          status: "ACTIVE",
          planCode: input.planCode,
        },
        tx
      );

      const membership = await membershipRepository.create(
        {
          tenantId: tenant.id,
          userId: ownerUserId,
          role: "OWNER",
        },
        tx
      );

      // Bootstrap default policies inside the same transaction, so a
      // workspace can never exist in a state where it cannot send.
      for (const policy of DEFAULT_POLICIES) {
        await tx.tenantPolicy.create({
          data: {
            tenantId: tenant.id,
            type: policy.type,
            name: policy.name,
            description: policy.description,
            version: 1,
            status: "ACTIVE",
            rules: policy.rules as Prisma.InputJsonValue,
            createdByUserId: ownerUserId,
            activatedAt: new Date(),
          },
        });
      }

      await auditService.record(
        {
          tenantId: tenant.id,
          actorUserId: ownerUserId,
          eventType: AuditEventTypes.WORKSPACE_CREATED,
          targetType: "Tenant",
          targetId: tenant.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            tenantName: tenant.name,
            planCode: tenant.planCode,
          },
        },
        tx
      );

      return { tenantId: tenant.id, membershipId: membership.id };
    });
  }
}

export const tenantService = new TenantService();