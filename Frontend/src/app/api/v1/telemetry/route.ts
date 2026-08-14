import { NextResponse } from 'next/server';

/**
 * Telemetry sink.
 *
 * Receives the funnel steps that evidence the PRD §22.2 connector-trust gate
 * and the identity signals from Audit §6.1. In production this forwards to the
 * platform's audit writer, which attaches tenant_id, actor_type, source_ip and
 * user_agent server-side — the client is never trusted for those.
 *
 * Always answers 204 so a failed beacon can never block sign-in.
 */

interface Incoming {
  kind?: 'funnel' | 'audit';
  name?: string;
  at?: string;
  requestId?: string;
  cohort?: string;
  detail?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const requestId = request.headers.get('X-Request-ID') ?? 'req_unknown';

  try {
    const body = (await request.json()) as Incoming;

    if (body?.kind && body?.name) {
      // eslint-disable-next-line no-console
      console.info(
        JSON.stringify({
          sink: 'telemetry',
          kind: body.kind,
          name: body.name,
          cohort: body.cohort ?? 'C2',
          requestId: body.requestId ?? requestId,
          at: body.at ?? new Date().toISOString(),
          // Detail is logged as-is only because it never carries message
          // content — Audit §10 sanitisation rules apply upstream.
          detail: body.detail ?? {},
        }),
      );
    }
  } catch {
    // Malformed beacon. Swallow it; sign-in must not depend on telemetry.
  }

  return new NextResponse(null, { status: 204, headers: { 'X-Request-ID': requestId } });
}

/** Discovery probes get nothing useful. */
export async function GET() {
  return new NextResponse(null, { status: 405 });
}
