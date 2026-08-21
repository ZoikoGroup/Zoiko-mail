/**
 * Data hooks for the admin workspace.
 *
 * THIS FILE IS THE SWAP POINT. Screens never import fixtures directly — they
 * call these hooks, which currently return static data with the same
 * `{ data, isLoading, error }` shape TanStack Query produces. Wiring a screen to
 * the API means replacing one function body:
 *
 *   export function useMembers() {
 *     return useQuery({ queryKey: ["members"], queryFn: fetchMembers });
 *   }
 *
 * Loading and error states are therefore designed from the start rather than
 * retrofitted, and no component changes when the real endpoint arrives.
 */
import {
  ACTIVE_GRANT,
  CAPABILITY_MATRIX,
  COMMITMENTS,
  GUARDRAILS,
  NOTIFICATIONS,
  POLICY_GROUPS,
  SETTINGS,
  SYNC_ERRORS,
  AUDIT_EVENTS,
  CONNECTORS,
  DASHBOARD,
  DOMAINS,
  GROUPS,
  INVITATIONS,
  MAILBOXES,
  MEMBERS,
  type AuditEventDto,
  type CapabilityGroupDto,
  type CommitmentDto,
  type GuardrailDto,
  type NotificationDto,
  type PolicyGroupDto,
  type SettingsDto,
  type SyncErrorDto,
  type ConnectorDto,
  type DashboardDto,
  type DomainDto,
  type GroupDto,
  type InvitationDto,
  type MailboxDto,
  type MemberDto,
  type SupportGrantDto,
} from "./admin-api";

export interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

function stat<T>(data: T): QueryLike<T> {
  return { data, isLoading: false, error: null };
}

/** `GET /admin/dashboard` — one aggregate call, not seven. */
export function useDashboard(): QueryLike<DashboardDto> {
  return stat(DASHBOARD);
}

/**
 * `GET /membership/members` → `{ members: [...] }`.
 *
 * Returns every membership, including INVITED rows and the SUPPORT actor. The
 * Users screen is responsible for filtering — see `useWorkspacePeople`.
 */
export function useMembers(): QueryLike<MemberDto[]> {
  return stat(MEMBERS);
}

/**
 * The 14 people the Users screen shows.
 *
 * Two filters, both load-bearing: INVITED memberships belong on the Invitations
 * screen, and the SUPPORT actor holds a membership only because
 * SupportAccessGrant requires one — it is not a member of the workspace.
 */
export function useWorkspacePeople(): QueryLike<MemberDto[]> {
  const { data, isLoading, error } = useMembers();
  return {
    data: data?.filter((m) => m.status === "ACTIVE" && m.role !== "SUPPORT"),
    isLoading,
    error,
  };
}

export function useInvitations(): QueryLike<InvitationDto[]> {
  return stat(INVITATIONS);
}

export function useMailboxes(): QueryLike<MailboxDto[]> {
  return stat(MAILBOXES);
}

export function useDomains(): QueryLike<DomainDto[]> {
  return stat(DOMAINS);
}

export function useGroups(): QueryLike<GroupDto[]> {
  return stat(GROUPS);
}

export function useAuditEvents(): QueryLike<AuditEventDto[]> {
  return stat(AUDIT_EVENTS);
}

export function useConnectors(): QueryLike<ConnectorDto[]> {
  return stat(CONNECTORS);
}

/** Null when no Zoiko staff member currently holds access. */
export function useActiveSupportGrant(): QueryLike<SupportGrantDto | null> {
  return stat(ACTIVE_GRANT);
}

/** `GET /permissions/matrix` — serialised from the same map the API enforces. */
export function useCapabilityMatrix(): QueryLike<CapabilityGroupDto[]> {
  return stat(CAPABILITY_MATRIX);
}

export function useGuardrails(): QueryLike<GuardrailDto[]> {
  return stat(GUARDRAILS);
}

/** `GET /policies/toggles` — grouped by policy type, one active version each. */
export function usePolicyGroups(): QueryLike<PolicyGroupDto[]> {
  return stat(POLICY_GROUPS);
}

/** `GET /connectors/dead-letter` — failures needing an operator decision. */
export function useSyncErrors(): QueryLike<SyncErrorDto[]> {
  return stat(SYNC_ERRORS);
}

export function useNotifications(): QueryLike<NotificationDto[]> {
  return stat(NOTIFICATIONS);
}

/** `GET /tenants/current` — general settings plus the enforced session policy. */
export function useSettings(): QueryLike<SettingsDto> {
  return stat(SETTINGS);
}

export function useCommitments(): QueryLike<CommitmentDto[]> {
  return stat(COMMITMENTS);
}
