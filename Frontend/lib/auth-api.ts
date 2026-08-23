import { apiRequest } from "./api-client";
import { setTokens, setPlatformToken, clearTokens, getRefreshToken } from "./auth-storage";

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

// export interface CreateWorkspaceResponse {
//   success: boolean;
//   data: {
//     tenant: {
//       id: string;
//       name: string;
//       slug: string;
//       planCode: string;
//     };

//     membership: {
//       id: string;
//       role: string;
//     };

//     accessToken: string;
//     refreshToken: string;
//     expiresIn: string;
//   };
// }

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
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  tenant: { id: string; name: string; planCode: string };
  membership: { id: string; role: "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT" | string };
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

// export async function login(input: LoginInput): Promise<AuthResponse> {
//   const data = await apiRequest<AuthResponse>("/auth/login", {
//     method: "POST",
//     body: input,
//     auth: false,
//   });
//   const { accessToken, refreshToken } = extractTokens(data);
//   if (accessToken) setTokens(accessToken, refreshToken);
//   return data;
// }
export async function login(input: LoginInput): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
  const { accessToken, refreshToken, platformToken } = extractTokens(data);
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

  setTokens(
    data.accessToken,
    data.refreshToken
  );

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
