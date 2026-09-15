import { API_BASE } from "./config";
import {
    getAccessToken,
    getRefreshToken,
    setTokens,
    clearTokens,
    setSignOutNotice,
} from "./auth-storage";

// Your backend wraps every response as:
//   success -> { success: true,  data: {...},  requestId }
//   error   -> { success: false, error: { code, message }, requestId }
// This client unwraps `data` on success and throws a typed error otherwise.

/**
 * What a capability refusal tells the caller, from the server's
 * `error.details`. A bare boolean makes every denial look the same, so the UI
 * can only grey a control out; these turn "refused" into a next step.
 */
export interface CapabilityDenial {
    capability?: string;
    reason?: string;
    heldBy?: string[];
    requiresStepUp?: boolean;
    requiresSecondApprover?: boolean;
    requiresSupportGrant?: boolean;
}

export class ApiError extends Error {
    status: number;
    code?: string;
    /** Present on a 403 from requireCapability; absent otherwise. */
    details?: CapabilityDenial;
    constructor(status: number, message: string, code?: string, details?: CapabilityDenial) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    /** True when re-authenticating would turn this refusal into a success. */
    get needsStepUp(): boolean {
        return this.status === 403 && this.details?.requiresStepUp === true;
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
    tenantId?: string | null;
    accessToken?: string | null;
    /** A fresh step-up token, for the actions RBAC §2 marks Step-up. */
    stepUpToken?: string | null;
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
    const {
        method = "GET",
        body,
        auth = true,
        headers: customHeaders,
        _retried = false,
        tenantId,
        accessToken,
        stepUpToken,
    } = opts;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...customHeaders,
    };
    // API §7: every side-effecting request carries an Idempotency-Key, and the
    // server refuses writes without one. It used to be an opt-in flag that no
    // caller ever set, so in practice no request sent a key at all.
    //
    // One key per call, which is one key per user action. Kept in `headers`
    // rather than regenerated so the refresh-retry below replays the same
    // operation instead of starting a second one.
    if (method !== "GET" && !headers["Idempotency-Key"]) {
        headers["Idempotency-Key"] = newIdempotencyKey();
    }
    if (auth) {
        const token = accessToken ?? getAccessToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) headers["X-Zoiko-Tenant-ID"] = tenantId;
    // Proof the caller re-entered their password just now (AC-003). Passed per
    // call rather than stored: the point is freshness, so it must not become a
    // second, longer-lived credential sitting in the client.
    if (stepUpToken) headers["x-step-up-token"] = stepUpToken;

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

    // Read the body before deciding what to do with a 401: the error code is
    // what separates an expired token from a session that was deliberately
    // ended, and the two must not be handled the same way. A 204 has no body,
    // which is what the catch covers.
    const json = await res.json().catch(() => null);
    const errorCode: string | undefined = json?.error?.code;

    if (res.status === 401 && auth && !_retried) {
        if (errorCode === "SESSION_SUPERSEDED") {
            // The user signed into another workspace, which ends this one.
            // Refreshing is not just futile — this session's refresh token was
            // revoked on purpose, and presenting a revoked token puts the
            // server on its reuse path, logging a security event for every
            // stale tab. So stop here and explain it instead.
            setSignOutNotice(
                json?.error?.message ??
                    "This session ended because you signed into another workspace."
            );
            clearTokens();
        } else {
            const refreshed = await tryRefresh();
            if (refreshed) {
                // The same Idempotency-Key, so the retry is a replay of one
                // operation rather than a second one. Only that header is
                // carried over — Authorization is rebuilt from the refreshed
                // token, and passing the old one along would defeat the
                // refresh.
                const idempotencyKey = headers["Idempotency-Key"];
                return apiRequest<T>(path, {
                    ...opts,
                    headers: idempotencyKey
                        ? { ...customHeaders, "Idempotency-Key": idempotencyKey }
                        : customHeaders,
                    _retried: true,
                });
            }
            clearTokens(); // refresh failed -> force re-login
        }
    }

    // No content
    if (res.status === 204) return undefined as T;

    if (!res.ok) {
        const message = json?.error?.message ?? `Request failed (${res.status})`;
        throw new ApiError(res.status, message, json?.error?.code, json?.error?.details);
    }
    // unwrap { success, data } -> data
    return (json?.data ?? json) as T;
}

/**
 * Fetch a file rather than a JSON envelope, and hand the browser the download.
 *
 * `apiRequest` always parses the response as JSON and unwraps `data`, so it
 * cannot carry a CSV. This keeps the same base URL and bearer token, reads the
 * body as a blob, and saves it under the filename the server chose in
 * Content-Disposition.
 *
 * A failure still arrives as JSON — the error envelope — so the body is read
 * as text first when the response is not ok, and the usual ApiError is thrown.
 * Without that, a refused export would save a file containing the error.
 */
export async function apiDownload(
    path: string,
    fallbackFilename: string
): Promise<void> {
    const headers: Record<string, string> = {};
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    let res: Response;
    try {
        res = await fetch(`${API_BASE}${path}`, { method: "GET", headers });
    } catch {
        throw new ApiError(
            0,
            "Unable to reach Zoiko Mail. Please make sure the backend server is running and try again.",
            "NETWORK_ERROR"
        );
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        let message = `Request failed (${res.status})`;
        let code: string | undefined;
        try {
            const parsed = JSON.parse(text);
            message = parsed?.error?.message ?? message;
            code = parsed?.error?.code;
        } catch {
            // A non-JSON error body; the status is all there is to report.
        }
        throw new ApiError(res.status, message, code);
    }

    // Prefer the server's filename: it carries the date stamp, and letting the
    // caller name the file would let the two drift.
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match?.[1] ?? fallbackFilename;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        // Revoked on the next tick: revoking synchronously can cancel the
        // download in some browsers before it has read the blob.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}
