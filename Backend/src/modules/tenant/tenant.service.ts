import type { MembershipRole, Prisma } from "@prisma/client";
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