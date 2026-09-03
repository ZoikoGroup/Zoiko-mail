import type { MembershipRole, PlatformRole } from "@prisma/client";

export type TokenType = "access" | "refresh" | "pending" | "platform" | "selection";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  /**
   * Phase 4: carried alongside the tenant-scoped role so downstream
   * authorization (support access grants, admin actions) can check
   * platform-level privilege even on a tenant-scoped session. NONE for
   * the overwhelming majority of users. Does NOT enable login without a
   * membership — that's the separate "platform" token type below.
   */
  platformRole: PlatformRole;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  type: "refresh";
  jti: string;
}

/**
 * Issued by /register once identity is created but before a workspace
 * (Tenant + TenantMembership) exists. Deliberately thin — no tenantId,
 * no role — since neither exists yet. Valid for /create-workspace,
 * /verify-otp, and /resend-otp.
 */
export interface PendingTokenPayload {
  sub: string;
  type: "pending";
}

/**
 * Issued during login when a user has multiple selectable workspaces. Lets
 * the client show a workspace picker and then complete auth without asking
 * for the password again. Short-lived (15 min), single-purpose — the only
 * endpoint that accepts it is /auth/select-workspace. Deliberately thin
 * like PendingTokenPayload: no tenant, no role — those are decided when
 * the user picks a workspace.
 */
export interface SelectionTokenPayload {
  sub: string;
  type: "selection";
}

/**
 * Phase 4 (staff): a platform-scoped session for Support / Super-admin.
 * Staff are NOT tenant members, so this carries no tenantId/membershipId/
 * role — only the platform privilege. `Exclude<PlatformRole, "NONE">`
 * makes it a compile error to ever mint one for a normal user, who must
 * always go through the tenant-scoped access token instead.
 */
export interface PlatformTokenPayload {
  sub: string;
  platformRole: Exclude<PlatformRole, "NONE">;
  type: "platform";
}

/**
 * Refresh counterpart for a platform session. NOTE: persisting this hits
 * the RefreshToken table, whose tenantId column is currently required —
 * so staff refresh isn't wired yet. See the note below; staff sessions
 * start access-only until that's resolved.
 */
export interface PlatformRefreshTokenPayload {
  sub: string;
  platformRole: Exclude<PlatformRole, "NONE">;
  type: "platform-refresh";
  jti: string;
}

/** Populated on req.auth by `authenticate` — always a tenant-scoped access token. */
export interface AuthContext {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  platformRole: PlatformRole;
  type: "access";
}

/** Populated on req.platformAuth by `authenticatePlatform` — staff, no tenant. */
export interface PlatformAuthContext {
  sub: string;
  platformRole: Exclude<PlatformRole, "NONE">;
  type: "platform";
}

/**
 * Normalized staff context set by `requireSupportAccess` for the support
 * console, regardless of which token type authenticated the request.
 * `membershipId` is only present for tenant-scoped access-token sessions.
 */
export interface StaffAuthContext {
  userId: string;
  platformRole: PlatformRole;
  membershipId?: string;
  type: "access" | "platform";
}

export interface TenantContextData {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: MembershipRole;
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
    platformRole: PlatformRole;
  };
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      platformAuth?: PlatformAuthContext;
      tenantContext?: TenantContextData;
      staffAuth?: StaffAuthContext;
    }
  }
}
