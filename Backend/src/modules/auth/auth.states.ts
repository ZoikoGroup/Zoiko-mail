import type {
  MembershipRole,
  MembershipStatus,
  PlatformRole,
  TenantStatus,
} from "@prisma/client";
import type { AuthSessionResponse } from "./auth.types.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceOption {
  id: string;
  name: string;
  planCode: string;
  role: MembershipRole;
  membershipId: string;
  membershipStatus: MembershipStatus;
  tenantStatus: TenantStatus;
  /** True only when the membership is ACTIVE and the tenant is ACTIVE. */
  selectable: boolean;
}

/** Discriminated union: every post-auth login outcome maps to one screen. */
export type AuthState =
  | { state: "SIGNED_IN"; session: AuthSessionResponse }
  // | { state: "WORKSPACE_SELECTION"; user: PublicUser; workspaces: WorkspaceOption[] }
  | { state: "WORKSPACE_SELECTION"; user: PublicUser; workspaces: WorkspaceOption[]; selectionToken: string; expiresIn: string }
  | { state: "NO_WORKSPACE"; user: PublicUser }
  | { state: "EMAIL_VERIFICATION_REQUIRED"; user: PublicUser; pendingToken: string; expiresIn: string }
  | { state: "ACCOUNT_SUSPENDED"; user: PublicUser }
  | { state: "ACCOUNT_DISABLED"; user: PublicUser }
  | { state: "INVITATION_PENDING"; user: PublicUser; invitations: WorkspaceOption[]; /**
     * Short-lived token letting an unauthenticated client accept an
     * invitation via POST /auth/join-workspace (same trust level as the
     * selection token: issued only after a successful password check).
     */
    pendingToken?: string }
  | { state: "MEMBERSHIP_SUSPENDED"; user: PublicUser; workspace: WorkspaceOption }
  | { state: "WORKSPACE_SUSPENDED"; user: PublicUser; workspace: WorkspaceOption }
  | { state: "WORKSPACE_DELETING"; user: PublicUser; workspace: WorkspaceOption }
  | {
      state: "STAFF_CONSOLE";
      user: PublicUser;
      platformRole: PlatformRole;
      /** Access-only platform session token (no refresh yet — see jwt.ts). */
      platformToken: string;
      expiresIn: string;
    };

export type AuthStateName = AuthState["state"];