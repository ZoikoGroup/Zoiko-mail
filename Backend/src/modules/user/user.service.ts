import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { auditService } from "../audit/audit.service.js";
import type { UpdateProfileInput } from "./user.schema.js";

interface UserContext {
  tenantId: string;
  userId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const profileSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  phoneNumber: true,
  timezone: true,
  language: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppUserSelect;

export class UserService {
  async getProfile(context: UserContext) {
    return prisma.appUser.findUniqueOrThrow({
      where: { id: context.userId },
      select: profileSelect,
    });
  }

  async updateProfile(input: UpdateProfileInput, context: UserContext) {
    return prisma.$transaction(async (tx) => {
      const profile = await tx.appUser.update({
        where: { id: context.userId },
        data: input,
        select: profileSelect,
      });
      await auditService.record(
        {
          tenantId: context.tenantId,
          actorUserId: context.userId,
          eventType: "USER_PROFILE_UPDATED",
          targetType: "AppUser",
          targetId: context.userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { changedFields: Object.keys(input) },
        },
        tx
      );
      return profile;
    });
  }
}

export const userService = new UserService();
