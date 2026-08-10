import type {
  AppUserStatus,
  MembershipRole,
  PlatformRole,
  Prisma,
  TenantMembership,
  TenantStatus,
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export interface MembershipWithRelations extends TenantMembership {
  tenant: {
    id: string;
    name: string;
    status: TenantStatus;
    planCode: string;
  };
  user: {
    platformRole: PlatformRole;
    id: string;
    email: string;
    displayName: string;
    status: AppUserStatus;
  };
}

const membershipInclude = {
  tenant: {
    select: {
      id: true,
      name: true,
      status: true,
      planCode: true,
    },
  },
  user: {
    select: {
      id: true,
      platformRole: true,
      email: true,
      displayName: true,
      status: true,
    },
  },
} satisfies Prisma.TenantMembershipInclude;

export class MembershipRepository {
  /**
   * Returns every membership for the user, regardless of status — INVITED,
   * ACTIVE, SUSPENDED, REMOVED, and regardless of the parent tenant's
   * status. Previously this filtered to ACTIVE-only at the query level,
   * which meant a suspended membership and "no membership at all" were
   * indistinguishable to callers.
   *
   * Callers must interpret `status` / `tenant.status` / `user.status`
   * themselves. Phase 4's guard-chain resolver centralizes that
   * interpretation for login; until then, filter explicitly at the call
   * site (see auth.service.ts).
   */
  async findByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<MembershipWithRelations[]> {
    return tx.tenantMembership.findMany({
      where: { userId },
      include: membershipInclude,
      orderBy: { createdAt: "asc" },
    });
  }

  async findByUserAndTenant(
    userId: string,
    tenantId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<MembershipWithRelations | null> {
    return tx.tenantMembership.findFirst({
      where: { userId, tenantId },
      include: membershipInclude,
    });
  }

  async findByIdForTenant(
    membershipId: string,
    tenantId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<TenantMembership | null> {
    return tx.tenantMembership.findFirst({
      where: {
        id: membershipId,
        tenantId,
      },
    });
  }

  async create(
    data: {
      tenantId: string;
      userId: string;
      role: MembershipRole;
    },
    tx: Prisma.TransactionClient = prisma
  ): Promise<TenantMembership> {
    return tx.tenantMembership.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        role: data.role,
        status: "ACTIVE",
      },
    });
  }
}

export const membershipRepository = new MembershipRepository();