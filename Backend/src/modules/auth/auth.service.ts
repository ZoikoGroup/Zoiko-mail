import jwt from "jsonwebtoken";
import type { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { Prisma, type MembershipRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { hashToken } from "../../common/utils/tokenHash.js";
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from "../../common/types/jwt.js";
import { auditService } from "../audit/audit.service.js";
import { membershipRepository } from "../membership/membership.repository.js";
import type { MembershipWithRelations } from "../membership/membership.repository.js";
import { userRepository } from "../user/user.repository.js";
import type {
  LoginInput,
  LogoutInput,
  ChangePasswordInput,
  RefreshInput,
  RegisterInput,
} from "./auth.schema.js";
import {
  AuditEventTypes,
  SYSTEM_TENANT_ID,
} from "./auth.types.js";
import type {
  AuthSessionResponse,
  RegisterResponse,
  TenantSelectionResponse,
} from "./auth.types.js";

interface RequestContext {
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const membershipRoles = new Set<MembershipRole>([
  "OWNER",
  "ADMIN",
  "MEMBER",
  "SUPPORT",
]);

function isRefreshTokenPayload(value: unknown): value is RefreshTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === "string" &&
    typeof payload.tenantId === "string" &&
    typeof payload.membershipId === "string" &&
    typeof payload.role === "string" &&
    membershipRoles.has(payload.role as MembershipRole) &&
    payload.type === "refresh" &&
    typeof payload.jti === "string"
  );
}

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * multipliers[unit]!;
}

function buildAccessToken(membership: MembershipWithRelations): string {
  const payload: AccessTokenPayload = {
    sub: membership.userId,
    tenantId: membership.tenantId,
    membershipId: membership.id,
    role: membership.role,
    type: "access",
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

function buildRefreshToken(membership: MembershipWithRelations): {
  token: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = uuidv4();
  const payload: RefreshTokenPayload = {
    sub: membership.userId,
    tenantId: membership.tenantId,
    membershipId: membership.id,
    role: membership.role,
    type: "refresh",
    jti,
  };

  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  const expiresAt = new Date(
    Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN)
  );

  return { token, jti, expiresAt };
}

async function persistRefreshToken(
  membership: MembershipWithRelations,
  refreshToken: string,
  expiresAt: Date,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await tx.refreshToken.create({
    data: {
      userId: membership.userId,
      tenantId: membership.tenantId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  });
}

async function issueSession(
  membership: MembershipWithRelations,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<AuthSessionResponse> {
  const accessToken = buildAccessToken(membership);
  const refresh = buildRefreshToken(membership);

  await persistRefreshToken(membership, refresh.token, refresh.expiresAt, tx);

  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    user: {
      id: membership.user.id,
      email: membership.user.email,
      displayName: membership.user.displayName,
    },
    tenant: {
      id: membership.tenant.id,
      name: membership.tenant.name,
      planCode: membership.tenant.planCode,
    },
    membership: {
      id: membership.id,
      role: membership.role,
    },
  };
}

export class AuthService {
  async register(
    input: RegisterInput,
    context: RequestContext
  ): Promise<RegisterResponse> {
    const existingUser = await userRepository.findByEmail(input.email);
    if (existingUser) {
      throw new AppError(
        "Email is already registered",
        409,
        ErrorCodes.CONFLICT
      );
    }

    const passwordHash = await hashPassword(input.password);

    let result: {
      user: Awaited<ReturnType<typeof userRepository.create>>;
      tenant: Awaited<ReturnType<typeof prisma.tenant.create>>;
      membership: Awaited<ReturnType<typeof membershipRepository.create>>;
    };

    try {
      result = await prisma.$transaction(async (tx) => {
      const user = await userRepository.create(
        {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          status: "ACTIVE",
        },
        tx
      );

      const tenant = await tx.tenant.create({
        data: {
          name: input.tenantName,
          status: "ACTIVE",
          planCode: input.planCode,
        },
      });

      const membership = await membershipRepository.create(
        {
          tenantId: tenant.id,
          userId: user.id,
          role: "OWNER",
        },
        tx
      );

      await auditService.record(
        {
          tenantId: tenant.id,
          actorUserId: user.id,
          eventType: AuditEventTypes.USER_REGISTERED,
          targetType: "AppUser",
          targetId: user.id,
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

        return { user, tenant, membership };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          "Email is already registered",
          409,
          ErrorCodes.CONFLICT
        );
      }
      throw error;
    }

    const membershipWithRelations =
      await membershipRepository.findActiveByUserAndTenant(
        result.user.id,
        result.tenant.id
      );

    if (!membershipWithRelations) {
      throw new AppError(
        "Failed to establish membership after registration",
        500,
        ErrorCodes.INTERNAL_ERROR
      );
    }

    const session = await issueSession(membershipWithRelations);

    return {
      user: session.user,
      tenant: session.tenant,
      membership: session.membership,
      tokens: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresIn: session.expiresIn,
      },
    };
  }

  async login(
    input: LoginInput,
    context: RequestContext
  ): Promise<AuthSessionResponse | TenantSelectionResponse> {
    const user = await userRepository.findByEmail(input.email);

    if (!user) {
      await this.recordLoginFailure(null, input.email, "unknown_email", context);
      throw new AppError("Invalid email or password", 401, ErrorCodes.UNAUTHORIZED);
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);
    if (!passwordValid) {
      await this.recordLoginFailure(user.id, input.email, "invalid_password", context);
      throw new AppError("Invalid email or password", 401, ErrorCodes.UNAUTHORIZED);
    }

    if (user.status !== "ACTIVE") {
      await this.recordLoginFailure(user.id, input.email, "user_disabled", context);
      throw new AppError("User account is disabled", 403, ErrorCodes.FORBIDDEN);
    }

    const memberships = await membershipRepository.findActiveByUserId(user.id);

    if (memberships.length === 0) {
      await this.recordLoginFailure(user.id, input.email, "no_active_membership", context);
      throw new AppError(
        "No active tenant membership found",
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    if (memberships.length > 1 && !input.tenantId) {
      return {
        requiresTenantSelection: true,
        tenants: memberships.map((membership) => ({
          id: membership.tenant.id,
          name: membership.tenant.name,
          planCode: membership.tenant.planCode,
          role: membership.role,
          membershipId: membership.id,
        })),
      };
    }

    const selectedMembership = input.tenantId
      ? memberships.find((membership) => membership.tenantId === input.tenantId)
      : memberships[0];

    if (!selectedMembership) {
      await this.recordLoginFailure(user.id, input.email, "invalid_tenant", context);
      throw new AppError(
        "Invalid tenant selection",
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    const session = await issueSession(selectedMembership);

    await auditService.record({
      tenantId: selectedMembership.tenantId,
      actorUserId: user.id,
      eventType: AuditEventTypes.LOGIN_SUCCESS,
      targetType: "AppUser",
      targetId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return session;
  }

  async refresh(
    input: RefreshInput,
    context: RequestContext
  ): Promise<AuthSessionResponse> {
    let payload: RefreshTokenPayload;

    try {
      const decoded = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET);
      if (!isRefreshTokenPayload(decoded)) {
        throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
      }
      payload = decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError("Refresh token expired", 401, ErrorCodes.TOKEN_EXPIRED);
      }
      throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
    }

    const tokenHash = hashToken(input.refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken) {
      throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
    }

    if (storedToken.revokedAt) {
      await this.handleRefreshTokenReuse(storedToken, context);
    }

    if (storedToken.expiresAt.getTime() <= Date.now()) {
      throw new AppError("Refresh token expired", 401, ErrorCodes.TOKEN_EXPIRED);
    }

    if (
      storedToken.userId !== payload.sub ||
      storedToken.tenantId !== payload.tenantId
    ) {
      throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
    }

    const membership = await membershipRepository.findActiveByUserAndTenant(
      payload.sub,
      payload.tenantId
    );

    if (!membership || membership.id !== payload.membershipId) {
      throw new AppError(
        "Active tenant membership not found",
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    if (membership.user.status !== "ACTIVE") {
      throw new AppError("User account is disabled", 403, ErrorCodes.FORBIDDEN);
    }

    const session = await prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (claimed.count !== 1) return null;

      const nextSession = await issueSession(membership, tx);
      await auditService.record(
        {
          tenantId: membership.tenantId,
          actorUserId: membership.userId,
          eventType: AuditEventTypes.REFRESH_TOKEN,
          targetType: "RefreshToken",
          targetId: storedToken.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx
      );
      return nextSession;
    });

    if (session === null) {
      return this.handleRefreshTokenReuse(storedToken, context);
    }

    return session;
  }

  async logout(input: LogoutInput, context: RequestContext): Promise<void> {
    let payload: RefreshTokenPayload;

    try {
      const decoded = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET);
      if (!isRefreshTokenPayload(decoded)) {
        throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
      }
      payload = decoded;
    } catch {
      throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
    }

    const tokenHash = hashToken(input.refreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (storedToken && !storedToken.revokedAt) {
      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });

      await auditService.record({
        tenantId: storedToken.tenantId,
        actorUserId: storedToken.userId,
        eventType: AuditEventTypes.LOGOUT,
        targetType: "RefreshToken",
        targetId: storedToken.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  }

  async changePassword(
    input: ChangePasswordInput,
    userId: string,
    tenantId: string,
    context: RequestContext
  ): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AppError("Current password is incorrect", 401, ErrorCodes.UNAUTHORIZED);
    }
    if (await verifyPassword(input.newPassword, user.passwordHash)) {
      throw new AppError(
        "New password must be different from the current password",
        409,
        ErrorCodes.CONFLICT
      );
    }

    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.appUser.update({ where: { id: userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: userId,
          eventType: AuditEventTypes.PASSWORD_CHANGED,
          targetType: "AppUser",
          targetId: userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx
      );
    });
  }

  async logoutAll(
    userId: string,
    tenantId: string,
    context: RequestContext
  ): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { userId, tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditService.record(
        {
          tenantId,
          actorUserId: userId,
          eventType: AuditEventTypes.LOGOUT_ALL,
          targetType: "AppUser",
          targetId: userId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { revokedSessionCount: revoked.count },
        },
        tx
      );
      return revoked.count;
    });
  }

  getCurrentUser(req: Request): AuthSessionResponse["user"] & {
    tenant: AuthSessionResponse["tenant"];
    membership: AuthSessionResponse["membership"];
  } {
    if (!req.tenantContext) {
      throw new AppError("Tenant context required", 403, ErrorCodes.FORBIDDEN);
    }

    const { user, tenant, membershipId, role } = req.tenantContext;

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        planCode: tenant.planCode,
      },
      membership: {
        id: membershipId,
        role,
      },
    };
  }

  private async recordLoginFailure(
    userId: string | null,
    email: string,
    reason: string,
    context: RequestContext
  ): Promise<void> {
    let tenantId = SYSTEM_TENANT_ID;

    if (userId) {
      const memberships = await membershipRepository.findActiveByUserId(userId);
      if (memberships.length > 0) {
        tenantId = memberships[0]!.tenantId;
      }
    }

    if (tenantId === SYSTEM_TENANT_ID) {
      await prisma.tenant.upsert({
        where: { id: SYSTEM_TENANT_ID },
        update: {},
        create: {
          id: SYSTEM_TENANT_ID,
          name: "System",
          status: "ACTIVE",
          planCode: "system",
        },
      });
    }

    await auditService.record({
      tenantId,
      actorUserId: userId,
      eventType: AuditEventTypes.LOGIN_FAILED,
      targetType: "AppUser",
      targetId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: {
        email,
        reason,
      },
    });
  }

  private async handleRefreshTokenReuse(
    token: { id: string; userId: string; tenantId: string },
    context: RequestContext
  ): Promise<never> {
    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: {
          userId: token.userId,
          tenantId: token.tenantId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      await auditService.record(
        {
          tenantId: token.tenantId,
          actorUserId: token.userId,
          eventType: AuditEventTypes.REFRESH_TOKEN_REUSE,
          targetType: "RefreshToken",
          targetId: token.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx
      );
    });

    throw new AppError(
      "Refresh token reuse detected",
      401,
      ErrorCodes.TOKEN_REUSED
    );
  }
}

export const authService = new AuthService();
