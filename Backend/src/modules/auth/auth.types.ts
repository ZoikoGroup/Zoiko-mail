export const AuditEventTypes = {
  USER_REGISTERED: "USER_REGISTERED",
  WORKSPACE_CREATED: "WORKSPACE_CREATED",
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  REFRESH_TOKEN: "REFRESH_TOKEN",
  REFRESH_TOKEN_REUSE: "REFRESH_TOKEN_REUSE",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  LOGOUT_ALL: "LOGOUT_ALL",
  OTP_SENT: "OTP_SENT",
  EMAIL_VERIFIED: "EMAIL_VERIFIED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  GOOGLE_LOGIN_SUCCESS: "GOOGLE_LOGIN_SUCCESS",
} as const;

export const SYSTEM_TENANT_ID = "00000000-0000-4000-8000-000000000000";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthUserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthTenantSummary {
  id: string;
  name: string;
  planCode: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: AuthUserSummary;
  tenant: AuthTenantSummary;
  membership: {
    id: string;
    role: string;
  };
}

export interface TenantSelectionResponse {
  requiresTenantSelection: true;
  tenants: Array<{
    id: string;
    name: string;
    planCode: string;
    role: string;
    membershipId: string;
  }>;
}

/**
 * Register is now identity-only: no tenant/membership exists yet, so there
 * is no session to issue. `pendingToken` is a short-lived, tenant-less
 * bearer token scoped to /create-workspace (and, from Phase 3, /verify-otp).
 */
export interface RegisterResponse {
  user: AuthUserSummary;
  pendingToken: string;
  expiresIn: string;
}

/** A workspace invitation waiting for the (newly registered) user. */
export interface PendingInvitationSummary {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  role: string;
}

/**
 * Returned by /verify-otp. When the verified email has pending invitations,
 * the client skips workspace creation and joins an existing workspace as
 * ADMIN/MEMBER instead of creating a new one as OWNER.
 */
export interface VerifyOtpResponse extends RegisterResponse {
  emailVerified: boolean;
  pendingInvitations: PendingInvitationSummary[];
}

/** Body of POST /auth/join-workspace (pending-token authenticated). */
export interface JoinWorkspaceInput {
  membershipId: string;
}