import jwt from "jsonwebtoken";
import type { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { Prisma, type MembershipRole, type PlatformRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { hashToken } from "../../common/utils/tokenHash.js";
import type {
  AccessTokenPayload,
  PendingTokenPayload,
  PlatformTokenPayload,
  RefreshTokenPayload,
  SelectionTokenPayload,
} from "../../common/types/jwt.js";
import { auditService } from "../audit/audit.service.js";
import { resolveGoogleIdentity } from "./google.service.js";
import { membershipRepository } from "../membership/membership.repository.js";
import type { MembershipWithRelations } from "../membership/membership.repository.js";
import { userRepository } from "../user/user.repository.js";
import { tenantService } from "../tenant/tenant.service.js";
import { otpService } from "./otp.service.js";
import type { AuthState, PublicUser, WorkspaceOption } from "./auth.states.js";
import type { PendingInvitationSummary, VerifyOtpResponse } from "./auth.types.js";
import type {
  LoginInput,
  LogoutInput,
  ChangePasswordInput,
  CreateWorkspaceInput,
  RefreshInput,
  RegisterInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  SelectWorkspaceInput,
} from "./auth.schema.js";
import {
  AuditEventTypes,
  SYSTEM_TENANT_ID,
} from "./auth.types.js";
import type {
  AuthSessionResponse,
  JoinWorkspaceInput,
  RegisterResponse,
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

function isSelectionTokenPayload(value: unknown): value is SelectionTokenPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "sub" in value &&
    typeof (value as { sub: unknown }).sub === "string" &&
    "type" in value &&
    (value as { type: unknown }).type === "selection"
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
    platformRole: membership.user.platformRole,
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

/**
 * Issued during login when the user needs to pick a workspace. Short-lived
 * (15 min) — enough time to show the picker and click. Only /auth/select-
 * workspace accepts it, so leakage is bounded to swapping workspaces on
 * an account the attacker already has *some* way to hit login for.
 */
const SELECTION_TOKEN_EXPIRES_IN = "15m";

function buildSelectionToken(userId: string): {
  token: string;
  expiresIn: string;
} {
  const payload: SelectionTokenPayload = {
    sub: userId,
    type: "selection",
  };

  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: SELECTION_TOKEN_EXPIRES_IN,
  });

  return { token, expiresIn: SELECTION_TOKEN_EXPIRES_IN };
}

/**
 * Phase 4 (staff): a platform-scoped session token for Support / Super-admin.
 * Access-only for now — no refresh counterpart, because RefreshToken.tenantId
 * is required and a staff session has no tenant to point at.
 */
function buildPlatformToken(
  userId: string,
  platformRole: Exclude<PlatformRole, "NONE">
): { token: string; expiresIn: string } {
  const payload: PlatformTokenPayload = {
    sub: userId,
    platformRole,
    type: "platform",
  };

  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

  return { token, expiresIn: env.JWT_ACCESS_EXPIRES_IN };
}

function toWorkspaceOption(m: MembershipWithRelations): WorkspaceOption {
  return {
    id: m.tenant.id,
    name: m.tenant.name,
    planCode: m.tenant.planCode,
    role: m.role,
    membershipId: m.id,
    membershipStatus: m.status,
    tenantStatus: m.tenant.status,
    selectable: m.status === "ACTIVE" && m.tenant.status === "ACTIVE",
  };
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

    // Status INVITED marks a placeholder identity created when someone was
    // invited before signing up. Registering claims it — the invitee sets
    // their own password here, then joins the inviting workspace after
    // email verification (see joinWorkspace). Any other existing account
    // is a real registration conflict.
    const isClaimingInvite = existingUser?.status === "INVITED";
    if (existingUser && !isClaimingInvite) {
      throw new AppError(
        "Email is already registered",
        409,
        ErrorCodes.CONFLICT
      );
    }

    const passwordHash = await hashPassword(input.password);

    let otpCode = "";
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.appUser.upsert({
        where: { email: input.email },
        update: {
          passwordHash,
          displayName: input.displayName,
          status: "PENDING_VERIFICATION",
        },
        create: {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          status: "PENDING_VERIFICATION",
        },
      });

      await ensureSystemTenant();
      await auditService.record(
        {
          tenantId: SYSTEM_TENANT_ID,
          actorUserId: u.id,
          eventType: AuditEventTypes.USER_REGISTERED,
          targetType: "AppUser",
          targetId: u.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { email: u.email },
        },
        tx
      );

      const { code } = await otpService.issue(u.id, tx);
      otpCode = code;
      await auditService.record(
        {
          tenantId: SYSTEM_TENANT_ID,
          actorUserId: u.id,
          eventType: AuditEventTypes.OTP_SENT,
          targetType: "AppUser",
          targetId: u.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx
      );

      return u;
    });

    // Deliver the code only after the transaction has committed — a slow SMTP
    // connection must never hold a DB transaction open past its timeout.
    await otpService.sendOtpEmail(user.email, otpCode);

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

    // In non-production environments we allow workspace creation without email verification to simplify testing.
    if (!user.emailVerifiedAt && process.env.NODE_ENV === "production") {
      throw new AppError(
        "Email must be verified before creating a workspace",
        403,
        ErrorCodes.EMAIL_NOT_VERIFIED
      );
    }
    if (user.status !== "PENDING_VERIFICATION" && user.status !== "ACTIVE") {
      throw new AppError(
        "Account is not eligible to create a workspace",
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    if (user.status === "PENDING_VERIFICATION") {
      await prisma.appUser.update({
        where: { id: user.id },
        data: { status: "ACTIVE", emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      });
    }

    // findByUserId now returns every membership regardless of status, so
    // this check is a reliable "does this account already belong
    // somewhere" guard — including a reused pending token racing itself.
    const existingMemberships = await membershipRepository.findByUserId(
      user.id
    );
    if (existingMemberships.length > 0) {
      throw new AppError(
        existingMemberships.some((m) => m.status === "INVITED")
          ? "This account has a pending workspace invitation — accept it from your invitation email instead of creating a new workspace"
          : "This account already belongs to a workspace",
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
   * Alternative end of onboarding for invited users: instead of creating a
   * workspace (→ OWNER), accept a pending invitation and join the existing
   * workspace under the invited role (ADMIN/MEMBER). Authenticated with the
   * same pending token as createWorkspace — there is no tenant session yet.
   * The whole accept+session runs in one transaction so tokens are only
   * issued when the acceptance actually commits.
   */
  async joinWorkspace(
    input: JoinWorkspaceInput,
    pendingToken: string,
    context: RequestContext
  ): Promise<AuthSessionResponse> {
    const userId = this.verifyPendingToken(pendingToken);

    const session = await prisma.$transaction(async (tx) => {
      const invitation = await tx.tenantMembership.findFirst({
        where: { id: input.membershipId, userId, status: "INVITED" },
        include: { tenant: true },
      });
      if (!invitation) {
        throw new AppError("Invitation not found", 404, ErrorCodes.NOT_FOUND);
      }
      if (
        !invitation.inviteExpiresAt ||
        invitation.inviteExpiresAt <= new Date()
      ) {
        throw new AppError(
          "Invitation has expired",
          410,
          ErrorCodes.INVITATION_EXPIRED
        );
      }
      if (invitation.tenant.status !== "ACTIVE") {
        throw new AppError(
          "Tenant is not active",
          403,
          ErrorCodes.FORBIDDEN
        );
      }

      const user = await tx.appUser.findUnique({ where: { id: userId } });
      if (!user) {
        throw new AppError("Account not found", 401, ErrorCodes.UNAUTHORIZED);
      }
      // Same activation rule as createWorkspace: verifying the OTP plus a
      // successful join promotes a pending account to ACTIVE.
      if (user.status === "PENDING_VERIFICATION") {
        await tx.appUser.update({
          where: { id: userId },
          data: {
            status: "ACTIVE",
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          },
        });
      }

      await tx.tenantMembership.update({
        where: { id: invitation.id },
        data: { status: "ACTIVE", inviteExpiresAt: null },
      });
      await auditService.record(
        {
          tenantId: invitation.tenantId,
          actorUserId: userId,
          eventType: "MEMBERSHIP_INVITATION_ACCEPTED",
          targetType: "TenantMembership",
          targetId: invitation.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        tx
      );

      const membershipWithRelations = await membershipRepository.findByUserAndTenant(
        userId,
        invitation.tenantId,
        tx
      );
      if (!membershipWithRelations) {
        throw new AppError(
          "Failed to establish membership after joining the workspace",
          500,
          ErrorCodes.INTERNAL_ERROR
        );
      }

      return issueSession(membershipWithRelations, tx);
    });

    return session;
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
  ): Promise<VerifyOtpResponse> {
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

    // Surface any workspace invitations waiting on this email. A non-empty
    // list tells the client to join an existing workspace (ADMIN/MEMBER)
    // instead of creating a new one as OWNER.
    const memberships = await membershipRepository.findByUserId(userId);
    const now = new Date();
    const pendingInvitations: PendingInvitationSummary[] = memberships
      .filter(
        (m) =>
          m.status === "INVITED" &&
          m.tenant.status === "ACTIVE" &&
          m.inviteExpiresAt !== null &&
          m.inviteExpiresAt > now
      )
      .map((m) => ({
        membershipId: m.id,
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        role: m.role,
      }));

    const pending = buildPendingToken(userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      emailVerified: true,
      pendingInvitations,
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

  async forgotPassword(input: ForgotPasswordInput, context: RequestContext): Promise<{ message: string }> {
    const genericMessage = "If an account exists for that email, a password reset code has been sent.";
    const user = await userRepository.findByEmail(input.email);
    if (!user || user.status === "DISABLED") return { message: genericMessage };
    try {
      await otpService.issuePasswordReset(user.id, user.email);
    } catch (error) {
      // Cooldown / hourly-cap must not reveal that the account exists.
      if (error instanceof AppError &&
        (error.code === ErrorCodes.OTP_COOLDOWN || error.code === ErrorCodes.OTP_RESEND_LIMIT)) {
        return { message: genericMessage };
      }
      throw error;
    }
    await ensureSystemTenant();
    await auditService.record({
      tenantId: SYSTEM_TENANT_ID, actorUserId: user.id,
      eventType: AuditEventTypes.PASSWORD_RESET_REQUESTED,
      targetType: "AppUser", targetId: user.id,
      requestId: context.requestId, ipAddress: context.ipAddress, userAgent: context.userAgent,
    });
    return { message: genericMessage };
  }

  async resetPassword(input: ResetPasswordInput, context: RequestContext): Promise<{ message: string }> {
    const user = await userRepository.findByEmail(input.email);
    if (!user || user.status === "DISABLED") {
      throw new AppError("Invalid or expired code", 400, ErrorCodes.OTP_INVALID);
    }
    await otpService.verifyPasswordReset(user.id, input.code);
    if (await verifyPassword(input.newPassword, user.passwordHash)) {
      throw new AppError("New password must be different from your current password", 409, ErrorCodes.CONFLICT);
    }
    const passwordHash = await hashPassword(input.newPassword);
    await ensureSystemTenant();
    await prisma.$transaction(async (tx) => {
      await tx.appUser.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditService.record({
        tenantId: SYSTEM_TENANT_ID, actorUserId: user.id,
        eventType: AuditEventTypes.PASSWORD_RESET_COMPLETED,
        targetType: "AppUser", targetId: user.id,
        requestId: context.requestId, ipAddress: context.ipAddress, userAgent: context.userAgent,
      }, tx);
    });
    return { message: "Password has been reset. You can now sign in with your new password." };
  }

  async login(input: LoginInput, context: RequestContext): Promise<AuthState> {
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

    // Credentials are valid — from here we return typed states, never generic
    // errors, so the client can render the right screen.
    return this.resolveAuthState(user, input.tenantId, context);
  }

  /**
   * Sign in with Google.
   *
   * Only the proof of identity differs from `login`. Once the email is known
   * and verified, this hands off to the same guard chain, so suspension,
   * pending invitations, workspace selection and every other state behave
   * identically however the person authenticated. Duplicating that chain for a
   * second sign-in route is how the two drift apart and one of them ends up
   * missing a guard.
   *
   * Deliberately does **not** provision anything. An unknown Google address is
   * refused rather than turned into a new user or a new tenant: access to this
   * product comes from an invitation, and a sign-in button that silently
   * creates accounts is a self-service door nobody chose to open.
   */
  async loginWithGoogle(
    code: string,
    context: RequestContext,
    tenantId?: string
  ): Promise<AuthState> {
    const identity = await resolveGoogleIdentity(code);

    const user = await userRepository.findByEmail(identity.email);
    if (!user) {
      await this.recordLoginFailure(null, identity.email, "google_unknown_email", context);
      throw new AppError(
        "No Zoiko Mail account exists for this Google address. Ask an administrator for an invitation.",
        401,
        ErrorCodes.UNAUTHORIZED
      );
    }

    // A local account with no password is not possible today, but if one ever
    // is, Google having verified the address is enough — the point of this
    // branch is that we never compare against passwordHash here at all.
    return this.resolveAuthState(user, tenantId, context);
  }

  /** Ordered guard chain. First matching guard decides the state. */
  private async resolveAuthState(
    user: Awaited<ReturnType<typeof userRepository.findByEmail>> & {},
    selectedTenantId: string | undefined,
    context: RequestContext
  ): Promise<AuthState> {
    const publicUser: PublicUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    };

    // 1. Account status (evaluated before any tenant concern).
    if (user.status === "PENDING_VERIFICATION") {
      const pending = buildPendingToken(user.id);
      return {
        state: "EMAIL_VERIFICATION_REQUIRED",
        user: publicUser,
        pendingToken: pending.token,
        expiresIn: pending.expiresIn,
      };
    }
    if (user.status === "SUSPENDED") {
      await this.recordLoginFailure(user.id, user.email, "account_suspended", context);
      return { state: "ACCOUNT_SUSPENDED", user: publicUser };
    }
    if (user.status === "DISABLED") {
      await this.recordLoginFailure(user.id, user.email, "account_disabled", context);
      return { state: "ACCOUNT_DISABLED", user: publicUser };
    }
    // ACTIVE and INVITED fall through to membership resolution.

    // 2. Platform-staff branch — staff resolve to a console, not a tenant.
    if (user.platformRole !== "NONE") {
      const platform = buildPlatformToken(user.id, user.platformRole);
      await ensureSystemTenant();
      await auditService.record({
        tenantId: SYSTEM_TENANT_ID,
        actorUserId: user.id,
        eventType: AuditEventTypes.LOGIN_SUCCESS,
        targetType: "AppUser",
        targetId: user.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { platformRole: user.platformRole },
      });
      return {
        state: "STAFF_CONSOLE",
        user: publicUser,
        platformRole: user.platformRole,
        platformToken: platform.token,
        expiresIn: platform.expiresIn,
      };
    }

    // 3. Resolve every membership (repository no longer hides non-active ones).
    const memberships = await membershipRepository.findByUserId(user.id);
    const nonRemoved = memberships.filter((m) => m.status !== "REMOVED");
    const invited = nonRemoved.filter((m) => m.status === "INVITED");

    if (nonRemoved.length === 0) {
      if (invited.length > 0) {
        const pending = buildPendingToken(user.id);
        return {
          state: "INVITATION_PENDING",
          user: publicUser,
          invitations: invited.map(toWorkspaceOption),
          pendingToken: pending.token,
        };
      }
      return { state: "NO_WORKSPACE", user: publicUser };
    }

    // 4. Explicit selection, or auto-resolve a single workspace.
    if (selectedTenantId) {
      const chosen = nonRemoved.find((m) => m.tenantId === selectedTenantId);
      // if (!chosen) {
      //   return { state: "WORKSPACE_SELECTION", user: publicUser, workspaces: nonRemoved.map(toWorkspaceOption) };
      // }
      if (!chosen) {
        const selection = buildSelectionToken(user.id);
        return {
          state: "WORKSPACE_SELECTION",
          user: publicUser,
          workspaces: nonRemoved.map(toWorkspaceOption),
          selectionToken: selection.token,
          expiresIn: selection.expiresIn,
        };
      }
      return this.resolveSelectedWorkspace(user, chosen, publicUser, context);
    }

    if (nonRemoved.length === 1) {
      return this.resolveSelectedWorkspace(user, nonRemoved[0]!, publicUser, context);
    }

    // 5. Multiple workspaces — let the client pick (statuses drive greying-out).
    // return { state: "WORKSPACE_SELECTION", user: publicUser, workspaces: nonRemoved.map(toWorkspaceOption) };

    // Issue a short-lived selection token so the client can call /auth/select-
    // workspace without asking the user for their password again.
    const selection = buildSelectionToken(user.id);
    return {
      state: "WORKSPACE_SELECTION",
      user: publicUser,
      workspaces: nonRemoved.map(toWorkspaceOption),
      selectionToken: selection.token,
      expiresIn: selection.expiresIn,
    };
  }
  
  /**
  * Second half of the split login flow. Called after /auth/login returned
  * WORKSPACE_SELECTION with a selectionToken; the client picked a workspace
  * and now we complete auth without asking for the password again.
  */
  async selectWorkspace(
    input: SelectWorkspaceInput,
    context: RequestContext
  ): Promise<AuthState> {
    // 1. Verify the selection token and extract userId.
    const userId = this.verifySelectionToken(input.selectionToken);

    // 2. Fetch the user record.
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new AppError("User not found", 404, ErrorCodes.NOT_FOUND);
    }

    // 3. Delegate to the shared resolver with the chosen tenantId. All the
    //    membership-lookup, account-status, tenant-status, and membership-
    //    status logic lives there — we just point it at the picked workspace.
    return this.resolveAuthState(user, input.tenantId, context);
  }

  /** Evaluate one chosen workspace: tenant status first, then membership status. */
  private async resolveSelectedWorkspace(
    user: { id: string; email: string; displayName: string },
    membership: MembershipWithRelations,
    publicUser: PublicUser,
    context: RequestContext
  ): Promise<AuthState> {
    const workspace = toWorkspaceOption(membership);

    if (membership.tenant.status === "DELETED_PENDING") {
      return { state: "WORKSPACE_DELETING", user: publicUser, workspace };
    }
    if (membership.tenant.status === "SUSPENDED") {
      return { state: "WORKSPACE_SUSPENDED", user: publicUser, workspace };
    }
    if (membership.status === "INVITED") {
      const pending = buildPendingToken(user.id);
      return {
        state: "INVITATION_PENDING",
        user: publicUser,
        invitations: [workspace],
        pendingToken: pending.token,
      };
    }
    if (membership.status === "SUSPENDED") {
      return { state: "MEMBERSHIP_SUSPENDED", user: publicUser, workspace };
    }
    if (membership.status === "REMOVED") {
      return { state: "NO_WORKSPACE", user: publicUser };
    }

    // ACTIVE membership + ACTIVE tenant → sign in.
    const session = await issueSession(membership);
    await auditService.record({
      tenantId: membership.tenantId,
      actorUserId: user.id,
      eventType: AuditEventTypes.LOGIN_SUCCESS,
      targetType: "AppUser",
      targetId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return { state: "SIGNED_IN", session };
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
    // The token is verified for its side effect only — logout is resolved by
    // hash lookup below, so the decoded payload is not needed.
    try {
      const decoded = jwt.verify(input.refreshToken, env.JWT_REFRESH_SECRET);
      if (!isRefreshTokenPayload(decoded)) {
        throw new AppError("Invalid refresh token", 401, ErrorCodes.TOKEN_INVALID);
      }
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

  private verifySelectionToken(token: string): string {
    let payload: unknown;

    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(
          "Workspace selection expired, please sign in again",
          401,
          ErrorCodes.TOKEN_EXPIRED
        );
      }
      throw new AppError("Invalid selection token", 401, ErrorCodes.TOKEN_INVALID);
    }

    if (!isSelectionTokenPayload(payload)) {
      throw new AppError("Invalid selection token", 401, ErrorCodes.TOKEN_INVALID);
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