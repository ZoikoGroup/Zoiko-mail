import type { MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { auditService } from "../audit/audit.service.js";
import type { UpdateTenantInput } from "./tenant.schema.js";

interface TenantContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
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
}

export const tenantService = new TenantService();
