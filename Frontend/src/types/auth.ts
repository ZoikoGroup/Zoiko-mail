/** Roles at launch. PRD §12 · Security §7. Further roles are deferred. */
export type Role = 'owner' | 'admin' | 'member' | 'support';

/** Data Model §6.2 — AppUser.status */
export type AppUserStatus = 'active' | 'invited' | 'suspended' | 'deleted';

/** Data Model §6.3 — TenantMembership.status */
export type MembershipStatus = 'active' | 'invited' | 'suspended' | 'removed';

/** Data Model §6.1 — Tenant.status */
export type TenantStatus = 'active' | 'suspended' | 'deleted_pending' | 'deleted';

/** Whether a designed state is named in a document or derived from one. */
export type Provenance = 'named' | 'derived';

/** The seven attributes Security §6 requires a session to bind. */
export interface Session {
  userId: string;
  tenantId: string;
  sessionId: string;
  role: Role;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  risk: 'low' | 'elevated' | 'high';
}

export interface AuthFeature {
  id: number;
  name: string;
  clause: string;
}

export interface AuthState {
  slug: string;
  index: number;
  label: string;
  route: string;
  feature: number;
  group: string;
  clausePrimary: string;
  clauseSecondary: string;
  provenance: Provenance;
}
