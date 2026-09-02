import type { MembershipRole, PlatformRole } from "@prisma/client";

// export type TokenType = "access" | "refresh" | "pending" | "platform";
export type TokenType = "access" | "refresh" | "pending" | "platform" | "selection";

/**
 * The one workspace a session may act in.
 *
 * A workspace here is a console — the member mailbox, the admin console, the
 * owner console, the support console — not a tenant. A session is bound to
 * exactly one, decided when it is issued, and moving to another requires
 * signing in again. Without this a session was bound only to a tenant, so an
 * Admin who signed into the admin console could open /owner by typing the
 * URL and the owner console would render.
 *
 * It is not the same thing as the membership role. The role is the most a
 * user could do; the scope is what this particular session is doing. A
 * Google sign-in is always issued MEMBER scope however senior the account
 * is, so reaching a console takes a deliberate sign-in.
 */
export type WorkspaceScope = "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";

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
  /**
   * The console this session may act in. Absent on tokens minted before
   * scoping existed, which are refused rather than trusted — those users
   * sign in once more and are then unaffected.
   */
  workspace?: WorkspaceScope;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  membershipId: string;
  role: MembershipRole;
  /**
   * Carried so a refresh renews the same scope. Without it, refreshing would
   * re-derive the scope from the role and quietly promote a MEMBER-scoped
   * Google session into the owner console.
   */
  workspace?: WorkspaceScope;
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
  /**
   * Identifies this token so it can be spent exactly once. Without it the
   * token is pure bearer data and stays valid for its whole window, which
   * would let one sign-in open a session in every workspace the user
   * belongs to.
   */
  jti: string;
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
  /** The console this session is bound to; see WorkspaceScope. */
  workspace: WorkspaceScope;
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
  /**
   * The authority this request actually acts with: the lesser of the
   * membership role and the session's workspace scope. A senior account on a
   * MEMBER-scoped session (every Google sign-in) acts as a member, and a
   * demoted user acts as their new role rather than the one their token was
   * minted with.
   */
  role: MembershipRole;
  /** What the membership permits at most, before the session scope narrows it. */
  membershipRole: MembershipRole;
  /** The console this session is bound to. */
  workspace: WorkspaceScope;
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
