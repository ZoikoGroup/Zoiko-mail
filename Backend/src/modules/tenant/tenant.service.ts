import { Prisma, type MembershipRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { auditService } from "../audit/audit.service.js";
import { membershipRepository } from "../membership/membership.repository.js";
import { tenantRepository } from "./tenant.repository.js";
import { AuditEventTypes } from "../auth/auth.types.js";
import type { UpdateTenantInput } from "./tenant.schema.js";

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
      apiVolume,
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
          SELECT DATE("createdAt") as date, COUNT(*) as count
          FROM "EmailMessage"
          WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${since}
          GROUP BY DATE("createdAt")
          ORDER BY date ASC
        `
      ),
      prisma.$queryRaw<{ date: Date; count: bigint }[]>(
        Prisma.sql`
          SELECT DATE("createdAt") as date, COUNT(*) as count
          FROM "AuditEvent"
          WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${since}
          GROUP BY DATE("createdAt")
          ORDER BY date ASC
        `
      ),
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
    };
    for (const row of emailStats) {
      const count = Number(row._count.id);
      if (row.status === "SENT") emailCounts.sent += count;
      else if (row.status === "RECEIVED") emailCounts.received += count;
      else if (row.status === "FAILED") emailCounts.failed += count;
      else if (row.status === "DRAFT") emailCounts.draft += count;
    }

    return {
      period: { days, since: since.toISOString() },
      storage: {
        used: totalStorageUsed,
        limit: totalStorageLimit,
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
      apiUsage: apiVolume.map((r) => ({
        date: r.date.toISOString().split("T")[0],
        count: Number(r.count),
      })),
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