import { apiRequest } from "./api-client";
import { setTokens, clearTokens, getRefreshToken } from "./auth-storage";

// NOTE: this assumes the login body is { email, password }. If your Swagger
// login used different field names, change them here to match.
export interface LoginInput {
    email: string;
    password: string;
    tenantId?: string; // optional if your backend supports multi-tenant logins
}
export interface LoginResponse {
    access_token: string;
    refresh_token?: string;
    // your backend may also return user/tenant fields; we don't rely on them here.
    [key: string]: unknown;
}

export interface AuthResponse {
    user: {
        id: string;
        email: string;
        displayName: string;
    };

    tenant: {
        id: string;
        name: string;
        planCode: string;
    };

    membership: {
        id: string;
        role: string;
    };

    tokens: {
        accessToken: string;
        refreshToken: string;
        expiresIn: string;
    };
}
// export interface RegisterResponse {
//   [key: string]: unknown;
// }
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

// export async function login(input: LoginInput): Promise<LoginResponse> {
//     const data = await apiRequest<LoginResponse>("/auth/login", {
//         method: "POST",
//         body: input,
//         auth: false, // no token yet
//     });
//     setTokens(data.accessToken, data.refreshToken);
//     return data;
// }
export async function login(input: LoginInput): Promise<AuthResponse> {
    const data = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: input,
        auth: false,
    });

    setTokens(
        data.tokens.accessToken,
        data.tokens.refreshToken
    );

    return data;
}

// export async function register(input: RegisterInput) {
//     return apiRequest("/auth/register", {
//         method: "POST",
//         body: input,
//         auth: false,
//     });
// }
export async function register(
    input: RegisterInput
): Promise<AuthResponse> {
    const data = await apiRequest<AuthResponse>("/auth/register", {
        method: "POST",
        body: input,
        auth: false,
    });

    setTokens(
        data.tokens.accessToken,
        data.tokens.refreshToken
    );

    return data;
}

export async function changePassword(
    input: ChangePasswordInput
): Promise<void> {
    await apiRequest("/auth/change-password", {
        method: "POST",
        body: input,
    });
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  tenant: {
    id: string;
    name: string;
    planCode: string;
  };
  membership: {
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT" | string;
  };
}
// Returns whatever /auth/me gives back (user + tenant context). Kept as unknown
// so it works regardless of the exact field names — the UI shows it raw so you
// can see the real shape.
export async function getMe(): Promise<MeResponse> {
    return apiRequest<MeResponse>("/auth/me");
}

export async function logout(): Promise<void> {
    const refresh_token = getRefreshToken();
    try {
        await apiRequest("/auth/logout", {
            method: "POST",
            body: { refresh_token },
        });
    } catch {
        // even if the server call fails, we still clear locally
    } finally {
        clearTokens();
    }
}

export async function logoutAll(): Promise<void> {
    const refreshToken = getRefreshToken();

    try {
        await apiRequest("/auth/logout-all", {
            method: "POST",
            body: {
                refreshToken: refreshToken,
            },
        });
    } finally {
        clearTokens();
    }
}