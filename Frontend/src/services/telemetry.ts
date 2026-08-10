import { newRequestId } from '@/lib/api-client';

/**
 * Funnel instrumentation and identity audit signals.
 *
 * Two purposes:
 *
 * 1. PRD §22.2 sets a release gate — "≥60% of invited pilot users complete
 *    Gmail/M365 connection", or ≥40% where the pilot includes
 *    security-hesitant external businesses. That is unprovable without
 *    telemetry starting at the invitation, so the funnel steps below are
 *    emitted from the moment a user arrives.
 *
 * 2. Audit §6.1 defines six identity events. The client emits the signal;
 *    the server writes the immutable row with tenant_id, actor_type,
 *    request_id, source_ip and user_agent attached. Audit §6.3 makes those
 *    rows append-only, so nothing here ever updates or deletes.
 */

export type FunnelStep =
  | 'signin_viewed'
  | 'email_submitted'
  | 'idp_handoff'
  | 'mfa_viewed'
  | 'mfa_verified'
  | 'workspace_viewed'
  | 'workspace_selected'
  | 'session_issued'
  | 'invitation_viewed'
  | 'invitation_accepted';

/** Audit §6.1 — Identity category. */
export type IdentityAuditEvent =
  | 'login'
  | 'failed_login'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'session_revoked'
  | 'role_changed';

export type Cohort = 'C0' | 'C1' | 'C2' | 'C3';

export interface TelemetryEnvelope {
  kind: 'funnel' | 'audit';
  name: string;
  at: string;
  requestId: string;
  cohort: Cohort;
  detail?: Record<string, string | number | boolean>;
}

const BUFFER_LIMIT = 200;
const buffer: TelemetryEnvelope[] = [];

/** Hosted §7 places the current pilot in cohort C2. */
const CURRENT_COHORT: Cohort = 'C2';

function build(
  kind: TelemetryEnvelope['kind'],
  name: string,
  detail?: TelemetryEnvelope['detail'],
): TelemetryEnvelope {
  return {
    kind,
    name,
    at: new Date().toISOString(),
    requestId: newRequestId(),
    cohort: CURRENT_COHORT,
    detail,
  };
}

function emit(envelope: TelemetryEnvelope): void {
  buffer.push(envelope);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug(`[${envelope.kind}] ${envelope.name}`, envelope.detail ?? {});
    return;
  }

  if (typeof window === 'undefined') return;

  // Fire-and-forget: a dropped beacon must never block sign-in.
  void fetch('/api/v1/telemetry', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': envelope.requestId },
    body: JSON.stringify(envelope),
  }).catch(() => undefined);
}

export function trackFunnel(name: FunnelStep, detail?: TelemetryEnvelope['detail']): void {
  emit(build('funnel', name, detail));
}

export function trackAudit(name: IdentityAuditEvent, detail?: TelemetryEnvelope['detail']): void {
  emit(build('audit', name, detail));
}

/** Read-only view for diagnostics. */
export function readTelemetryBuffer(): readonly TelemetryEnvelope[] {
  return buffer;
}
