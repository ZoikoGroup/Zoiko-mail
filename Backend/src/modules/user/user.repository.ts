import type { AppUser, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

export class UserRepository {
  async findByEmail(
    email: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<AppUser | null> {
    return tx.appUser.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async findById(
    userId: string,
    tx: Prisma.TransactionClient = prisma
  ): Promise<AppUser | null> {
    return tx.appUser.findUnique({
      where: { id: userId },
    });
  }

  async create(
    data: Prisma.AppUserCreateInput,
    tx: Prisma.TransactionClient = prisma
  ): Promise<AppUser> {
    return tx.appUser.create({ data });
  }
}

export const userRepository = new UserRepository();
