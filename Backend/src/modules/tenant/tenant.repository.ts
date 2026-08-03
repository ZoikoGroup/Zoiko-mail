import type { Prisma, Tenant } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export class TenantRepository {
  async findById(
    tenantId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<Tenant | null> {
    return tx.tenant.findFirst({
      where: { id: tenantId },
    });
  }

  async create(
    data: Prisma.TenantCreateInput,
    tx: Prisma.TransactionClient = prisma
  ): Promise<Tenant> {
    return tx.tenant.create({ data });
  }
}

export const tenantRepository = new TenantRepository();
