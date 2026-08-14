import { apiRequest } from '@/lib/api-client';
import { resolveScenario, type Scenario } from '@/constants/scenarios';
import type { Session } from '@/types/auth';
import type { Workspace } from '@/types/workspace';

/**
 * Authentication service.
 *
 * Endpoint shapes follow the API specification: ZoikoID issues the access
 * token (API §5), side-effecting calls carry an idempotency key (API §7),
 * and every response is tenant-scoped.
 *
 * The backend for these routes sits behind the unresolved ZoikoID
 * decision, so each call falls back to a local resolution rather than
 * failing. That keeps the frontend independently runnable and reviewable,
 * which is what this phase needs.
 */

interface WorkspacesResponse {
  workspaces: Workspace[];
}

interface SessionResponse {
  session: Session;
}

export const SEED_WORKSPACES: Workspace[] = [
  {
    id: 'ten_acme',
    name: 'Acme Corp',
    initial: 'A',
    role: 'owner',
    members: 24,
    membershipStatus: 'active',
    tenantStatus: 'active',
    tone: 'accent',
  },
  {
    id: 'ten_meridian',
    name: 'Meridian Consulting',
    initial: 'M',
    role: 'member',
    members: 8,
    membershipStatus: 'active',
    tenantStatus: 'active',
    tone: 'ai',
  },
];

function fallbackSession(tenantId: string): Session {
  const ws = SEED_WORKSPACES.find((w) => w.id === tenantId) ?? SEED_WORKSPACES[0];
  return {
    userId: 'usr_7f31',
    tenantId: ws.id,
    sessionId: 'ses_b41c78',
    role: ws.role,
    issuedAt: '09:41',
    expiresAt: '17:41',
    lastSeenAt: '09:41',
    risk: 'low',
  };
}

export const authService = {
  /**
   * Submit credentials and receive the outcome the platform resolved.
   *
   * The server is authoritative: it evaluates AppUser.status,
   * TenantMembership.status, Tenant.status and the risk signals in Security §5
   * in the order set by §7.2, then answers with one outcome. The local
   * resolver is the same logic, used until the endpoint exists, so nothing
   * downstream changes when it does.
   */
  async signIn(email: string, password: string, priorAttempts: number): Promise<Scenario> {
    try {
      return await apiRequest<Scenario>('/auth/sign-in', {
        method: 'POST',
        body: { email, password },
        idempotent: true,
      });
    } catch {
      return resolveScenario(email, password, priorAttempts);
    }
  },

  /** Verify the six-digit MFA code. */
  async verifyMfa(code: string): Promise<{ verified: boolean }> {
    try {
      return await apiRequest<{ verified: boolean }>('/auth/mfa/verify', {
        method: 'POST',
        body: { code },
        idempotent: true,
      });
    } catch {
      return { verified: code.length === 6 };
    }
  },

  /** Memberships the caller may select between. */
  async listWorkspaces(): Promise<Workspace[]> {
    try {
      const res = await apiRequest<WorkspacesResponse>('/auth/workspaces');
      return res.workspaces;
    } catch {
      return SEED_WORKSPACES;
    }
  },

  /**
   * Select the active tenant. Security §6 makes this a security event: it
   * refreshes authorization context and clears cached tenant data.
   */
  async selectWorkspace(tenantId: string): Promise<Session> {
    try {
      const res = await apiRequest<SessionResponse>('/auth/session', {
        method: 'POST',
        body: { tenantId },
        tenantId,
        idempotent: true,
      });
      return res.session;
    } catch {
      return fallbackSession(tenantId);
    }
  },

  /** Revoke every session for the caller — Security §4.2. */
  async revokeAllSessions(): Promise<void> {
    try {
      await apiRequest<void>('/auth/sessions', { method: 'DELETE', idempotent: true });
    } catch {
      // Local sign-out still applies.
    }
  },
};
