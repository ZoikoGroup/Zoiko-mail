export const AuditEventTypes = {
  USER_REGISTERED: "USER_REGISTERED",
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGOUT: "LOGOUT",
  REFRESH_TOKEN: "REFRESH_TOKEN",
  REFRESH_TOKEN_REUSE: "REFRESH_TOKEN_REUSE",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  LOGOUT_ALL: "LOGOUT_ALL",
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

export interface RegisterResponse {
  user: AuthUserSummary;
  tenant: AuthTenantSummary;
  membership: {
    id: string;
    role: string;
  };
  tokens: AuthTokens;
}
