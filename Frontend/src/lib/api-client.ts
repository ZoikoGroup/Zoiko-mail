/**
 * Thin fetch wrapper for the Zoiko Mail API.
 *
 * Every request carries the contract the API specification requires:
 *  · Authorization bearer token issued by ZoikoID          (API §5)
 *  · X-Zoiko-Tenant-ID resolving exactly one tenant        (API §5)
 *  · X-Request-ID propagated into logs and audit events    (API §4)
 *  · Idempotency-Key on every side-effecting call          (API §7)
 *
 * The base path is /api/v1 per API §4.
 */

export const API_BASE = '/api/v1';

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly payload: ApiError;

  constructor(status: number, payload: ApiError) {
    super(payload.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

export function newRequestId(): string {
  return `req_${Math.random().toString(16).slice(2, 10)}`;
}

export function newIdempotencyKey(): string {
  return `idem_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  tenantId?: string | null;
  accessToken?: string | null;
  /** Required by API §7 for create, update, delete, send, connect, export. */
  idempotent?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, tenantId, accessToken, idempotent, headers, ...rest } = options;
  const requestId = newRequestId();

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
    ...(headers as Record<string, string> | undefined),
  };

  if (accessToken) finalHeaders.Authorization = `Bearer ${accessToken}`;
  if (tenantId) finalHeaders['X-Zoiko-Tenant-ID'] = tenantId;
  if (idempotent) finalHeaders['Idempotency-Key'] = newIdempotencyKey();

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiRequestError(res.status, {
      code: payload?.error?.code ?? 'unknown_error',
      message: payload?.error?.message ?? 'The request could not be completed.',
      requestId: payload?.error?.request_id ?? requestId,
      details: payload?.error?.details,
    });
  }

  return payload as T;
}
