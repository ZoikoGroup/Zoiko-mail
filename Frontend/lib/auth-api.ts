import { apiRequest } from "./api-client";
import { setTokens, clearTokens, getRefreshToken } from "./auth-storage";

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

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
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
  user: { id: string; email: string; displayName: string };
  tenant: { id: string; name: string; planCode: string };
  membership: { id: string; role: string };
  // present on register
  tokens?: Tokens;
  // present on login / refresh
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: string;
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  tenant: { id: string; name: string; planCode: string };
  membership: { id: string; role: "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT" | string };
}

// Pull tokens out regardless of which shape the endpoint used.
function extractTokens(data: AuthResponse): { accessToken?: string; refreshToken?: string } {
  const nested = data.tokens;
  return {
    accessToken: nested?.accessToken ?? data.accessToken,
    refreshToken: nested?.refreshToken ?? data.refreshToken,
  };
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
  const { accessToken, refreshToken } = extractTokens(data);
  if (accessToken) setTokens(accessToken, refreshToken);
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