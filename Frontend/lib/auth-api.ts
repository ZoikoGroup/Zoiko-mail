import { apiRequest } from "./api-client";
import { setTokens, setPlatformToken, clearTokens, getRefreshToken, clearPlatformToken } from "./auth-storage";

export interface LoginInput {
  email: string;
  password: string;
  tenantId?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  tenantName: string;
  planCode: string;
}

export interface VerifyOtpInput {
  code: string;
  token: string;
}

/** A workspace invitation waiting for this freshly-verified account. */
export interface PendingInvitation {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  role: string;
}

export interface VerifyOtpResponse {
  user: { id: string; email: string; displayName: string };
  emailVerified: boolean;
  // Non-empty → the client should join an invited workspace as
  // ADMIN/MEMBER instead of creating a new one as OWNER.
  pendingInvitations: PendingInvitation[];
  pendingToken: string;
  expiresIn: string;
}

export interface ResendOtpInput {
  token: string;
}

export interface ResendOtpResponse {
  success: boolean;
  data: {
    message: string;
    cooldownMs: number;
  };
}

export interface CreateWorkspaceInput {
  token: string;
  tenantName: string;
  planCode: string;
}

export interface JoinWorkspaceInput {
  /** Pending-token (Bearer) used to authenticate the request. */
  token: string;
  membershipId: string;
}

export interface CreateWorkspaceResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: { id: string; email: string; displayName: string };
  tenant: { id: string; name: string; slug?: string; planCode: string };
  membership: { id: string; role: string };
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  newPassword: string;
}

// Both password-recovery endpoints return a generic { message }.
export interface MessageResponse {
  message: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

// The backend returns tokens in TWO different shapes:
//   login / refresh -> tokens at the TOP level of data (data.accessToken, ...)
//   register        -> tokens NESTED under data.tokens (data.tokens.accessToken)
// AuthResponse models both so callers can read either.
export interface AuthResponse {
  workspaces: Array<{ id: string; name: string; planCode?: string; role?: string; reason?: string }>;
  selectionToken: string;
  invitations: Array<{ id: string; name: string; planCode?: string; role?: string }>;
  workspace: any;
  pendingToken: any;
  data: any;
  user: { id: string; email: string; displayName: string };
  tenant: { id: string; name: string; planCode: string };
  membership: { id: string; role: string };
  // present on register
  tokens?: Tokens;
  // present on login / refresh
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: string;
  // staff (STAFF_CONSOLE) logins
  state?: string;
  platformRole?: string;
  platformToken?: string;
  // MFA_REQUIRED / MFA_ENROLLMENT_REQUIRED — AC-002. The challenge token is
  // all the account holds at that point; there is no session yet.
  mfaToken?: string;
  requiredBecause?: string;
  remainingRecoveryCodes?: number;
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  tenant: { id: string; name: string; planCode: string };
  /** The acting role, already narrowed by the session's workspace scope. */
  membership: { id: string; role: "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT" | string };
  /**
   * The workspace this session was opened for. Every shell gates on this, so
   * it must come from the server: a role alone cannot say which console a
   * session belongs to, because one role can sign into more than one.
   */
  workspace?: "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";
}

// Pull tokens out regardless of which shape the endpoint used.
// Also extracts the staff "platform" token returned by STAFF_CONSOLE logins.
function extractTokens(data: any): { accessToken?: string; refreshToken?: string; platformToken?: string } {
  const src = data?.session ?? data?.tokens ?? data ?? {};
  return {
    accessToken:
      src?.accessToken ?? src?.access_token ??
      data?.accessToken ?? data?.access_token,
    refreshToken:
      src?.refreshToken ?? src?.refresh_token ??
      data?.refreshToken ?? data?.refresh_token,
    platformToken: src?.platformToken ?? data?.platformToken,
  };
}

/**
 * Store whatever tokens an auth response carries.
 *
 * Four paths issue a session now — sign-in, workspace selection, an answered
 * MFA challenge and an enrolment that completes one — so the token handling
 * lives in one place rather than being repeated at each.
 */
function applyAuthTokens(data: AuthResponse): void {
  const { accessToken, refreshToken, platformToken } = extractTokens(data);
  if (accessToken) setTokens(accessToken, refreshToken);
  if (platformToken) setPlatformToken(platformToken);
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
  const { accessToken, refreshToken, platformToken } = extractTokens(data);

  // A new login must replace ANY previous session state. Otherwise a stale
  // platform token from a prior staff session disables useMe() for the
  // new tenant user (useMe checks `!getPlatformToken()`), leaving the
  // member dashboard permanently stuck on "Loading…" because me never
  // resolves. Same problem in reverse if tenant tokens outlive a staff
  // login. Clear everything, then set what the new response gave us.
  clearTokens();
  clearPlatformToken();

  if (accessToken) setTokens(accessToken, refreshToken);
  if (platformToken) setPlatformToken(platformToken);
  return data;
}

export async function googleLogin(idToken: string): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/google", {
    method: "POST",
    body: { idToken },
    auth: false,
  });
  const { accessToken, refreshToken, platformToken } = extractTokens(data);

  clearTokens();
  clearPlatformToken();

  if (accessToken) setTokens(accessToken, refreshToken);
  if (platformToken) setPlatformToken(platformToken);
  return data;
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
    auth: false,
  });
  const { accessToken, refreshToken } = extractTokens(data);
  if (accessToken) setTokens(accessToken, refreshToken);
  return data;
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiRequest("/auth/change-password", { method: "POST", body: input });
}

export async function getMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/auth/me");
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    await apiRequest("/auth/logout", {
      method: "POST",
      body: { refreshToken }, // camelCase — matches the backend
    });
  } catch {
    // even if the server call fails, clear locally
  } finally {
    clearTokens();
    clearPlatformToken();
  }
}

export async function logoutAll(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    await apiRequest("/auth/logout-all", { method: "POST", body: { refreshToken } });
  } finally {
    clearTokens();
  }
}

export async function verifyOtp(
  input: VerifyOtpInput
): Promise<VerifyOtpResponse> {
  return apiRequest<VerifyOtpResponse>(
    "/auth/verify-otp",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${input.token}`,
      },

      body: {
        code: input.code,
      },

      auth: false,
    }
  );
}

export async function resendOtp(
  input: ResendOtpInput
): Promise<ResendOtpResponse> {
  return apiRequest<ResendOtpResponse>(
    "/auth/resend-otp",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${input.token}`,
      },

      auth: false,
    }
  );
}

/* ── multi-factor authentication — AC-002 ─────────────────────────────────
 *
 * The challenge calls carry the short-lived `mfaToken` from a sign-in that is
 * still owed a second factor, not an access token: the account has no session
 * yet, which is the whole point of the state.
 */

export interface MfaEnrolmentOffer {
  secret: string;
  uri: string;
}

export interface MfaStatus {
  enrolled: boolean;
  enrolledAt: string | null;
  enrolmentPending: boolean;
  required: boolean;
  requiredBecause: string | null;
  remainingRecoveryCodes: number;
}

/** Answer a challenge with an authenticator code or a recovery code. */
export async function verifyMfaChallenge(
  mfaToken: string,
  code: string
): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/mfa/challenge/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${mfaToken}` },
    body: { code },
    auth: false,
  });
  applyAuthTokens(data);
  return data;
}

/** Start enrolment from a challenge, for an account that has no session yet. */
export async function beginMfaEnrolmentFromChallenge(
  mfaToken: string
): Promise<MfaEnrolmentOffer> {
  return apiRequest<MfaEnrolmentOffer>("/auth/mfa/challenge/enroll", {
    method: "POST",
    headers: { Authorization: `Bearer ${mfaToken}` },
    auth: false,
  });
}

/** Confirm it, which also completes the sign-in the enrolment was blocking. */
export async function confirmMfaEnrolmentFromChallenge(
  mfaToken: string,
  code: string
): Promise<{ recoveryCodes: string[]; auth: AuthResponse }> {
  const data = await apiRequest<{ recoveryCodes: string[]; auth: AuthResponse }>(
    "/auth/mfa/challenge/confirm",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${mfaToken}` },
      body: { code },
      auth: false,
    }
  );
  applyAuthTokens(data.auth);
  return data;
}

export async function fetchMfaStatus(): Promise<MfaStatus> {
  return apiRequest<MfaStatus>("/auth/mfa");
}

export async function beginMfaEnrolment(): Promise<MfaEnrolmentOffer> {
  return apiRequest<MfaEnrolmentOffer>("/auth/mfa/enroll", { method: "POST" });
}

export async function confirmMfaEnrolment(code: string): Promise<{ recoveryCodes: string[] }> {
  return apiRequest<{ recoveryCodes: string[] }>("/auth/mfa/confirm", {
    method: "POST",
    body: { code },
  });
}

export async function regenerateMfaRecoveryCodes(
  code: string
): Promise<{ recoveryCodes: string[] }> {
  return apiRequest<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", {
    method: "POST",
    body: { code },
  });
}

export async function createWorkspace(
  input: CreateWorkspaceInput
): Promise<CreateWorkspaceResponse> {
  const data =
    await apiRequest<CreateWorkspaceResponse>(
      "/auth/create-workspace",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${input.token}`,
        },

        body: {
          tenantName: input.tenantName,
          planCode: input.planCode,
        },

        auth: false,
      }
    );

  // AC-002: creating a workspace makes this account an Owner, so the response
  // may be an MFA enrolment challenge rather than a session. Store whatever
  // tokens it did carry and let the caller route on the state.
  applyAuthTokens(data as unknown as AuthResponse);

  return data;
}

// Accept a pending invitation for a just-registered account. Authenticated
// with the pending token (no tenant session exists yet). Returns the same
// session shape as createWorkspace — membership.role is ADMIN or MEMBER.
export async function joinWorkspace(
  input: JoinWorkspaceInput
): Promise<CreateWorkspaceResponse> {
  const data = await apiRequest<CreateWorkspaceResponse>(
    "/auth/join-workspace",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${input.token}`,
      },

      body: {
        membershipId: input.membershipId,
      },

      auth: false,
    }
  );

  setTokens(data.accessToken, data.refreshToken);

  return data;
}
export async function forgotPassword(
  input: ForgotPasswordInput
): Promise<MessageResponse> {
  return apiRequest<MessageResponse>("/auth/forgot-password", {
    method: "POST",
    body: input,
    auth: false,
  });
}

export async function resetPassword(
  input: ResetPasswordInput
): Promise<MessageResponse> {
  return apiRequest<MessageResponse>("/auth/reset-password", {
    method: "POST",
    body: input,
    auth: false,
  });
}
