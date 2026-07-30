import { API_BASE } from "./config";
import {
    getAccessToken,
    getRefreshToken,
    setTokens,
    clearTokens,
} from "./auth-storage";

// Your backend wraps every response as:
//   success -> { success: true,  data: {...},  requestId }
//   error   -> { success: false, error: { code, message }, requestId }
// This client unwraps `data` on success and throws a typed error otherwise.

export class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

interface RequestOptions {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    auth?: boolean; // attach the access token (default true)
    _retried?: boolean; // internal: prevents infinite refresh loops
}

// Single-flight refresh: if many calls 401 at once, we refresh only once.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    if (!refreshPromise) {
        refreshPromise = (async () => {
            try {
                const res = await fetch(`${API_BASE}/auth/refresh`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        refreshToken: refreshToken,
                    }),
                });
                if (!res.ok) return false;
                const json = await res.json();
                const data = json?.data ?? json;
                if (!data?.accessToken) return false;
                setTokens(data.accessToken, data.refreshToken);
                return true;
            } catch {
                return false;
            } finally {
                // allow the next refresh cycle after this one settles
                setTimeout(() => (refreshPromise = null), 0);
            }
        })();
    }
    return refreshPromise;
}

export async function apiRequest<T = unknown>(
    path: string,
    opts: RequestOptions = {}
): Promise<T> {
    const { method = "GET", body, auth = true, _retried = false } = opts;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) {
        const token = getAccessToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Token expired -> refresh once, then retry the original request.
    if (res.status === 401 && auth && !_retried) {
        const refreshed = await tryRefresh();
        if (refreshed) return apiRequest<T>(path, { ...opts, _retried: true });
        clearTokens(); // refresh failed -> force re-login
    }

    // No content
    if (res.status === 204) return undefined as T;

    const json = await res.json().catch(() => null);

    if (!res.ok) {
        const message = json?.error?.message ?? `Request failed (${res.status})`;
        throw new ApiError(res.status, message, json?.error?.code);
    }
    // unwrap { success, data } -> data
    return (json?.data ?? json) as T;
}