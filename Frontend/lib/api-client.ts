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

export function newRequestId(): string {
    return `req_${Math.random().toString(16).slice(2, 10)}`;
}

export function newIdempotencyKey(): string {
    return `idem_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

// interface RequestOptions {
//     method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
//     body?: unknown;
//     auth?: boolean; 
//     _retried?: boolean; 
// }
interface RequestOptions {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
    _retried?: boolean;
    idempotent?: boolean;
    tenantId?: string | null;
    accessToken?: string | null;
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
    // const { method = "GET", body, auth = true, _retried = false } = opts;
    const {
        method = "GET",
        body,
        auth = true,
        headers: customHeaders,
        _retried = false,
        idempotent,
        tenantId,
        accessToken,
    } = opts;

    // const headers: Record<string, string> = { "Content-Type": "application/json" };
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...customHeaders,
    };
    if (idempotent) headers["Idempotency-Key"] = `idem_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    if (auth) {
        const token = accessToken ?? getAccessToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) headers["X-Zoiko-Tenant-ID"] = tenantId;

    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new ApiError(
            0,
            "Unable to reach Zoiko Mail. Please make sure the backend server is running and try again.",
            "NETWORK_ERROR"
        );
    }

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
