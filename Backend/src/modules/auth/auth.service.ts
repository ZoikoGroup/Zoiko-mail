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
  PendingTokenPayload,
  RefreshTokenPayload,
} from "../../common/types/jwt.js";
import { auditService } from "../audit/audit.service.js";
import { membershipRepository } from "../membership/membership.repository.js";
import type { MembershipWithRelations } from "../membership/membership.repository.js";
import { userRepository } from "../user/user.repository.js";
import { tenantService } from "../tenant/tenant.service.js";
import { otpService } from "./otp.service.js";
import type {
  LoginInput,
  LogoutInput,
  ChangePasswordInput,
  CreateWorkspaceInput,
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

// Short-lived: only needs to survive the gap between /register and
// /create-workspace (and, from Phase 3, /verify-otp / /resend-otp).
const PENDING_TOKEN_EXPIRES_IN = "12h";

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

function isPendingTokenPayload(value: unknown): value is PendingTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.sub === "string" && payload.type === "pending";
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

/**
 * Signed with the same secret as access tokens, but never confusable with
 * one: isPendingTokenPayload requires `type === "pending"`, and access
 * tokens always carry `type: "access"`. Kept on the same secret so we're
 * not managing a third JWT secret for a token this narrow in scope.
 */
function buildPendingToken(userId: string): {
  token: string;
  expiresIn: string;
} {
  const payload: PendingTokenPayload = {
    sub: userId,
    type: "pending",
  };

  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: PENDING_TOKEN_EXPIRES_IN,
  });

  return { token, expiresIn: PENDING_TOKEN_EXPIRES_IN };
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

/**
 * Ensures the sentinel "System" tenant row exists. AuditEvent.tenantId is
 * a required FK, so any audit entry recorded before a real tenant exists
 * (registration, pre-membership login failures) needs somewhere to point.
 */
async function ensureSystemTenant(): Promise<void> {
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

export class AuthService {
  /**
   * Identity-only. Creates the AppUser (status: PENDING_VERIFICATION) and
   * returns a short-lived pending token — no tenant, no membership, no
   * session, since none exist yet. Workspace creation is a separate step
   * (see createWorkspace).
   */
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

    let user: Awaited<ReturnType<typeof userRepository.create>>;
    try {
      user = await userRepository.create({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        status: "PENDING_VERIFICATION",
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

    await ensureSystemTenant();
    await auditService.record({
      tenantId: SYSTEM_TENANT_ID,
      actorUserId: user.id,
      eventType: AuditEventTypes.USER_REGISTERED,
      targetType: "AppUser",
      targetId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { email: user.email },
    });

    await otpService.issue(user.id, user.email);
    await auditService.record({
      tenantId: SYSTEM_TENANT_ID,
      actorUserId: user.id,
      eventType: AuditEventTypes.OTP_SENT,
      targetType: "AppUser",
      targetId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const pending = buildPendingToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      pendingToken: pending.token,
      expiresIn: pending.expiresIn,
    };
  }

  /**
   * Second step of onboarding. Authenticates via the pending token from
   * register (not the normal authenticate/tenantContext middleware, since
   * there's no tenant to attach yet), creates the Tenant + OWNER
   * membership, then issues a full session exactly like login does.
   */
  async createWorkspace(
    input: CreateWorkspaceInput,
    pendingToken: string,
    context: RequestContext
  ): Promise<AuthSessionResponse> {
    const userId = this.verifyPendingToken(pendingToken);

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError("Account not found", 401, ErrorCodes.UNAUTHORIZED);
    }

    // if (user.status !== "PENDING_VERIFICATION" && user.status !== "ACTIVE") {
    //   throw new AppError(
    //     "Account is not eligible to create a workspace",
    //     403,
    //     ErrorCodes.FORBIDDEN
    //   );
    // }

    if (!user.emailVerifiedAt) {
      throw new AppError(
        "Email must be verified before creating a workspace",
        403,
        ErrorCodes.EMAIL_NOT_VERIFIED
      );
    }
    if (user.status !== "ACTIVE") {
      throw new AppError(
        "Account is not eligible to create a workspace",
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    // findByUserId now returns every membership regardless of status, so
    // this check is a reliable "does this account already belong
    // somewhere" guard — including a reused pending token racing itself.
    const existingMemberships = await membershipRepository.findByUserId(
      user.id
    );
    if (existingMemberships.length > 0) {
      throw new AppError(
        "This account already belongs to a workspace",
        409,
        ErrorCodes.CONFLICT
      );
    }

    const { tenantId } = await tenantService.createWorkspace(
      { tenantName: input.tenantName, planCode: input.planCode },
      user.id,
      context
    );

    const membershipWithRelations = await membershipRepository.findByUserAndTenant(
      user.id,
      tenantId
    );

    if (!membershipWithRelations) {
      throw new AppError(
        "Failed to establish membership after workspace creation",
        500,
        ErrorCodes.INTERNAL_ERROR
      );
    }

    return issueSession(membershipWithRelations);
  }

  /**
   * Phase 3: verify the email OTP for a pending user. On success the user is
   * promoted to ACTIVE with emailVerifiedAt set (inside otpService.verify),
   * and a refreshed pending token is returned so they can proceed to
   * createWorkspace or invitation acceptance.
   */
  async verifyEmailOtp(
    pendingToken: string,
    code: string,
    context: RequestContext
  ): Promise<RegisterResponse & { emailVerified: boolean }> {
    const userId = this.verifyPendingToken(pendingToken);
    await otpService.verify(userId, code);

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError("Account not found", 401, ErrorCodes.UNAUTHORIZED);
    }

    await ensureSystemTenant();
    await auditService.record({
      tenantId: SYSTEM_TENANT_ID,
      actorUserId: userId,
      eventType: AuditEventTypes.EMAIL_VERIFIED,
      targetType: "AppUser",
      targetId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const pending = buildPendingToken(userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      emailVerified: true,
      pendingToken: pending.token,
      expiresIn: pending.expiresIn,
    };
  }

  /** Phase 3: resend the email OTP (cooldown + hourly cap enforced in otpService). */
  async resendEmailOtp(
    pendingToken: string,
    context: RequestContext
  ): Promise<{ message: string; cooldownMs: number }> {
    const userId = this.verifyPendingToken(pendingToken);
    const { cooldownMs } = await otpService.resend(userId);

    await ensureSystemTenant();
    await auditService.record({
      tenantId: SYSTEM_TENANT_ID,
      actorUserId: userId,
      eventType: AuditEventTypes.OTP_SENT,
      targetType: "AppUser",
      targetId: userId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { message: "Verification code sent", cooldownMs };
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

    // TODO(Phase 4): this ACTIVE-only filter is the guard-chain resolver's
    // job. For now it reproduces the old query-level filtering explicitly,
    // so behavior is unchanged while the underlying repository now exposes
    // the full picture (INVITED/SUSPENDED/REMOVED memberships) to callers
    // that need it.
    const memberships = (
      await membershipRepository.findByUserId(user.id)
    ).filter(
      (membership) =>
        membership.status === "ACTIVE" && membership.tenant.status === "ACTIVE"
    );

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

    const membership = await membershipRepository.findByUserAndTenant(
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

    // TODO(Phase 4): fold into the guard-chain resolver.
    if (membership.status !== "ACTIVE" || membership.tenant.status !== "ACTIVE") {
      throw new AppError(
        "Tenant membership is not active",
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

  private verifyPendingToken(token: string): string {
    let payload: unknown;

    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(
          "Pending session expired, please register again",
          401,
          ErrorCodes.TOKEN_EXPIRED
        );
      }
      throw new AppError("Invalid pending session", 401, ErrorCodes.TOKEN_INVALID);
    }

    if (!isPendingTokenPayload(payload)) {
      throw new AppError("Invalid pending session", 401, ErrorCodes.TOKEN_INVALID);
    }

    return payload.sub;
  }

  private async recordLoginFailure(
    userId: string | null,
    email: string,
    reason: string,
    context: RequestContext
  ): Promise<void> {
    let tenantId = SYSTEM_TENANT_ID;

    if (userId) {
      const memberships = await membershipRepository.findByUserId(userId);
      const activeMembership = memberships.find(
        (membership) =>
          membership.status === "ACTIVE" && membership.tenant.status === "ACTIVE"
      );
      if (activeMembership) {
        tenantId = activeMembership.tenantId;
      }
    }

    if (tenantId === SYSTEM_TENANT_ID) {
      await ensureSystemTenant();
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