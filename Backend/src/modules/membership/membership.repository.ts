import type { MembershipRole, Prisma, TenantMembership } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export interface MembershipWithRelations extends TenantMembership {
  tenant: {
    id: string;
    name: string;
    status: string;
    planCode: string;
  };
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
  };
}

export class MembershipRepository {
  async findActiveByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<MembershipWithRelations[]> {
    return tx.tenantMembership.findMany({
      where: {
        userId,
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
      },
      include: {
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
            email: true,
            displayName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findActiveByUserAndTenant(
    userId: string,
    tenantId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<MembershipWithRelations | null> {
    return tx.tenantMembership.findFirst({
      where: {
        userId,
        tenantId,
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
      },
      include: {
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
            email: true,
            displayName: true,
            status: true,
          },
        },
      },
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
