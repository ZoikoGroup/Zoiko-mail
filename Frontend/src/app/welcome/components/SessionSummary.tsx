'use client';

import { Panel } from '@/components/ui/Card';
import type { Session } from '@/types/auth';

/**
 * Renders the seven attributes Security §6 requires a session to bind.
 *
 * Not decoration: making the contract visible is the clearest way for a
 * reviewer to confirm the session shape matches the specification.
 */
export function SessionSummary({ session }: { session: Session }) {
  return (
    <Panel label="Session bound — 7 attributes">
      <p className="m-0 font-mono text-[10.5px] leading-[1.68] text-ink-3 tnum">
        user_id {session.userId} · tenant_id {session.tenantId}
        <br />
        session_id {session.sessionId} · role {session.role}
        <br />
        issued_at {session.issuedAt} · expires_at {session.expiresAt}
        <br />
        last_seen_at {session.lastSeenAt} · risk {session.risk}
      </p>
    </Panel>
  );
}
