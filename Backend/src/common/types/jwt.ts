import type { MembershipRole, PlatformRole } from "@prisma/client";

export type TokenType = "access" | "refresh" | "pending" | "platform" | "selection" | "step-up";

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

/**
 * Proof that the caller re-entered their password just now — Security §5,
 * AC-003, RBAC §2 "fresh step-up authentication required at action time".
 *
 * Separate from the access token and deliberately short-lived, because the
 * point is freshness: an access token proves who you are for hours, and the
 * high-risk actions in §5 want evidence that the person at the keyboard is
 * still the account holder. Bound to the tenant as well as the user, so a
 * step-up performed in one workspace cannot authorise a destructive action
 * in another.
 */
export interface StepUpTokenPayload {
  sub: string;
  tenantId: string;
  type: "step-up";
  jti: string;
}

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
  /**
   * The session this token belongs to — AC-001, which requires every
   * authenticated request to resolve user_id, tenant_id, session_id and role.
   *
   * It is the refresh token's `jti`, so "session" means the same thing on
   * both halves of the pair and survives a rotation: refreshing carries the
   * id forward rather than minting a new one, because the person did not
   * start a new session by staying signed in.
   *
   * Optional only for tokens minted before this existed. Those resolve to a
   * null session id rather than being refused, since refusing them would sign
   * every active user out to add a field to an audit row.
   */
  sid?: string;
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
  /**
   * The session, as distinct from this particular token.
   *
   * `jti` rotates on every refresh — that is what makes reuse detectable —
   * so it cannot be the session id: a user who stays signed in all day would
   * produce a new "session" every few hours and the audit trail could not be
   * followed across them. `sid` is seeded from the first token's jti and
   * carried forward through every rotation.
   */
  sid?: string;
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

/**
 * Issued when a privileged sign-in still owes a second factor — AC-002.
 *
 * Carries the sign-in it will complete, so answering the challenge issues
 * exactly the session the password already earned: no wider, and no need to
 * re-resolve which workspace was being entered. `enrolment` distinguishes the
 * account that has an authenticator from the one that has to set one up,
 * which are two different screens and two different next calls.
 */
export interface MfaChallengeTokenPayload {
  sub: string;
  type: "mfa";
  jti: string;
  enrolment: boolean;
  intent:
    | { kind: "tenant"; tenantId: string; membershipId: string; workspace: WorkspaceScope }
    | { kind: "platform"; platformRole: Exclude<PlatformRole, "NONE"> };
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
  /** AC-001. Null for a token minted before session ids were carried. */
  sessionId: string | null;
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
  /**
   * AC-001. Carried through to audit so an event can be attributed to one
   * sign-in rather than only to a person — which is what makes "this was me,
   * but not from that laptop" answerable.
   */
  sessionId: string | null;
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

/** Set by requireTenantGrant; read by the support access log. */
export interface SupportGrantContext {
  id: string | null;
  ticketId: string | null;
  breakGlass: boolean;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      platformAuth?: PlatformAuthContext;
      tenantContext?: TenantContextData;
      staffAuth?: StaffAuthContext;
      /**
       * The support access grant this request is being served under, set by
       * requireTenantGrant. `id` is null only for a SUPER_ADMIN break-glass
       * read, which the access log records as such so §7's "reviewed after
       * use" has something to review.
       */
      supportGrant?: SupportGrantContext;
    }
  }
}
