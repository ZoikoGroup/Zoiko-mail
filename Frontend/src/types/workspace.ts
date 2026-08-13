import type { MembershipStatus, Role, TenantStatus } from './auth';

export type WorkspaceTone = 'accent' | 'ai' | 'warn' | 'crit';

export interface Workspace {
  id: string;
  name: string;
  initial: string;
  role: Role;
  members: number;
  membershipStatus: MembershipStatus;
  tenantStatus: TenantStatus;
  tone: WorkspaceTone;
}

/** A workspace is only selectable when both statuses are active. */
export const isSelectable = (w: Workspace): boolean =>
  w.membershipStatus === 'active' && w.tenantStatus === 'active';

/** Never list a workspace the user has been removed from or that is gone. */
export const isListable = (w: Workspace): boolean =>
  w.membershipStatus !== 'removed' && w.tenantStatus !== 'deleted';
