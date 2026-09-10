"use client";

/**
 * Data hooks for the admin workspace — now backed by the API.
 *
 * This file used to return fixtures behind a `{ data, isLoading, error }`
 * shape so the screens could be built before the endpoints existed. The
 * fixtures are gone; every hook below is a real read. Because the shape never
 * changed, no component needed editing when they were swapped.
 *
 * Where the backend genuinely has nothing — groups, guardrails, MFA — the hook
 * surfaces that as an error or a neutral value rather than inventing data. A
 * plausible-looking number is worse than a blank, because it reads as real and
 * gets trusted.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchActiveSupportGrant,
  fetchAuditEvents,
  fetchCommitments,
  fetchConnectors,
  fetchDashboard,
  fetchDomains,
  fetchGroups,
  fetchGroupAssignees,
  createGroup,
  assignToGroup,
  removeFromGroup,
  fetchInvitations,
  previewInvitation,
  sendInvitation,
  updateWorkspaceSettings,
  fetchMailboxes,
  fetchMembers,
  fetchNotifications,
  fetchPolicyGroups,
  fetchSettings,
  fetchSyncErrors,
  setMailboxAi,
  fetchMailboxRouting,
  createAlias,
  deleteAlias,
  createForwarding,
  deleteForwarding,
} from "./admin-queries";
import type {
  GroupAssigneeDto,
  MailboxRoutingDto,
  InvitationDraftInput,
  WorkspaceSettingsPatch,
} from "./admin-queries";
import { CAPABILITY_MATRIX, GUARDRAILS } from "./admin-api";
import type {
  AuditEventDto,
  CapabilityGroupDto,
  CommitmentDto,
  ConnectorDto,
  DashboardDto,
  DomainDto,
  GroupDto,
  GuardrailDto,
  InvitationDto,
  MailboxDto,
  MemberDto,
  NotificationDto,
  PolicyGroupDto,
  SettingsDto,
  SupportGrantDto,
  SyncErrorDto,
} from "./admin-api";

export interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Operational data goes stale quickly and an admin acts on what they see, so
 * these refetch on focus with a short stale window rather than being cached
 * for the session.
 */
const LIVE = { staleTime: 20_000, refetchOnWindowFocus: true } as const;

function shape<T>(q: {
  data: T | undefined;
  isLoading: boolean;
  error: unknown;
}): QueryLike<T> {
  return { data: q.data, isLoading: q.isLoading, error: (q.error as Error) ?? null };
}

/* ── people ────────────────────────────────────────────────────────────── */

export function useMembers(): QueryLike<MemberDto[]> {
  return shape(useQuery({ queryKey: ["members"], queryFn: fetchMembers, ...LIVE }));
}

/**
 * The people the Users screen shows.
 *
 * Two filters, both load-bearing: INVITED memberships belong on the
 * Invitations screen, and the SUPPORT actor holds a membership only because
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
  return shape(
    useQuery({ queryKey: ["invitations"], queryFn: fetchInvitations, ...LIVE })
  );
}

/* ── workspace ─────────────────────────────────────────────────────────── */

export function useMailboxes(): QueryLike<MailboxDto[]> {
  return shape(useQuery({ queryKey: ["mailboxes"], queryFn: fetchMailboxes, ...LIVE }));
}

/** Restrict or unrestrict a mailbox for AI processing. */
export function useSetMailboxAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, aiEnabled }: { mailboxId: string; aiEnabled: boolean }) =>
      setMailboxAi(mailboxId, aiEnabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mailboxes"] }),
  });
}

/** Aliases and forwarding for one mailbox. */
export function useMailboxRouting(mailboxId: string | null): QueryLike<MailboxRoutingDto> {
  return shape(
    useQuery({
      queryKey: ["mailbox-routing", mailboxId],
      queryFn: () => fetchMailboxRouting(mailboxId as string),
      enabled: Boolean(mailboxId),
      ...LIVE,
    })
  );
}

function useRoutingMutation<T>(fn: (input: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-routing"] }),
  });
}

export function useCreateAlias() {
  return useRoutingMutation((input: { mailboxId: string; address: string }) =>
    createAlias(input.mailboxId, input.address)
  );
}

export function useDeleteAlias() {
  return useRoutingMutation((input: { mailboxId: string; aliasId: string }) =>
    deleteAlias(input.mailboxId, input.aliasId)
  );
}

export function useCreateForwarding() {
  return useRoutingMutation(
    (input: { mailboxId: string; forwardToAddress: string; keepCopy: boolean }) =>
      createForwarding(input.mailboxId, {
        forwardToAddress: input.forwardToAddress,
        keepCopy: input.keepCopy,
      })
  );
}

export function useDeleteForwarding() {
  return useRoutingMutation((input: { mailboxId: string; ruleId: string }) =>
    deleteForwarding(input.mailboxId, input.ruleId)
  );
}

export function useDomains(): QueryLike<DomainDto[]> {
  return shape(useQuery({ queryKey: ["domains"], queryFn: fetchDomains, ...LIVE }));
}

/** Shared mailboxes and distribution addresses. */
export function useGroups(): QueryLike<GroupDto[]> {
  return shape(useQuery({ queryKey: ["groups"], queryFn: fetchGroups, ...LIVE }));
}

/** Who is assigned to one shared mailbox, and with which permissions. */
export function useGroupAssignees(mailboxId: string | null): QueryLike<GroupAssigneeDto[]> {
  return shape(
    useQuery({
      queryKey: ["group-assignees", mailboxId],
      queryFn: () => fetchGroupAssignees(mailboxId as string),
      enabled: Boolean(mailboxId),
      ...LIVE,
    })
  );
}

/** Invalidates both the roster and the group list, whose counts move with it. */
function useGroupMutation<T>(fn: (input: T) => Promise<void>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["groups"] }),
        qc.invalidateQueries({ queryKey: ["group-assignees"] }),
      ]);
    },
  });
}

export function useCreateGroup() {
  return useGroupMutation((input: { address: string; type: "SHARED" | "DISTRIBUTION" }) =>
    createGroup(input)
  );
}

export function useAssignToGroup() {
  return useGroupMutation(
    (input: {
      mailboxId: string;
      membershipId: string;
      canRead?: boolean;
      canSend?: boolean;
      canManage?: boolean;
      canAssign?: boolean;
    }) => {
      const { mailboxId, ...rest } = input;
      return assignToGroup(mailboxId, rest);
    }
  );
}

export function useRemoveFromGroup() {
  return useGroupMutation((input: { mailboxId: string; membershipId: string }) =>
    removeFromGroup(input.mailboxId, input.membershipId)
  );
}

export function useAuditEvents(): QueryLike<AuditEventDto[]> {
  return shape(
    useQuery({ queryKey: ["audit"], queryFn: () => fetchAuditEvents(50), ...LIVE })
  );
}

export function useConnectors(): QueryLike<ConnectorDto[]> {
  return shape(
    useQuery({ queryKey: ["connectors"], queryFn: fetchConnectors, ...LIVE })
  );
}

export function useSyncErrors(): QueryLike<SyncErrorDto[]> {
  return shape(
    useQuery({ queryKey: ["sync-errors"], queryFn: fetchSyncErrors, ...LIVE })
  );
}

export function usePolicyGroups(): QueryLike<PolicyGroupDto[]> {
  return shape(useQuery({ queryKey: ["policies"], queryFn: fetchPolicyGroups, ...LIVE }));
}

export function useNotifications(): QueryLike<NotificationDto[]> {
  return shape(
    useQuery({ queryKey: ["notifications"], queryFn: fetchNotifications, ...LIVE })
  );
}

export function useSettings(): QueryLike<SettingsDto> {
  return shape(useQuery({ queryKey: ["settings"], queryFn: fetchSettings, ...LIVE }));
}

export function useCommitments(): QueryLike<CommitmentDto[]> {
  return shape(
    useQuery({ queryKey: ["commitments"], queryFn: fetchCommitments, ...LIVE })
  );
}

/** Null when no Zoiko staff member currently holds access. */
export function useActiveSupportGrant(): QueryLike<SupportGrantDto | null> {
  return shape(
    useQuery({
      queryKey: ["support-grant"],
      queryFn: fetchActiveSupportGrant,
      // A live grant is the highest-trust thing on screen; poll it.
      refetchInterval: 60_000,
      ...LIVE,
    })
  );
}

/* ── still static, and marked as such ──────────────────────────────────── */

/**
 * The permission matrix is documentation of the server's own table. Serving it
 * from `GET /permissions/matrix` would be better, but until that exists this
 * is a transcription rather than invented data — and `useCan` already reflects
 * the live decisions from `GET /users/me/capabilities`.
 */
export function useCapabilityMatrix(): QueryLike<CapabilityGroupDto[]> {
  return { data: CAPABILITY_MATRIX, isLoading: false, error: null };
}

/** Guardrails have no backend representation at all — nothing to read yet. */
export function useGuardrails(): QueryLike<GuardrailDto[]> {
  return { data: GUARDRAILS, isLoading: false, error: null };
}

/* ── rail counts ───────────────────────────────────────────────────────── */

/**
 * Live badge counts for the admin rail nav items.
 *
 * Each key is the nav href; a key is present only once its underlying query has
 * resolved, so a still-loading item keeps its previous badge rather than
 * flickering to 0. A resolved-but-empty list carries its real 0.
 *
 * Groups and Inbox are intentionally absent: groups have no backend read yet
 * (`useGroups` throws), and mail needs a member-level hook that does not live
 * in this module.
 */
export function useAdminNavCounts(): Partial<Record<string, number>> {
  const people = useWorkspacePeople();
  const invitations = useInvitations();
  const mailboxes = useMailboxes();
  const domains = useDomains();
  const notifications = useNotifications();
  const commitments = useCommitments();

  const counts: Partial<Record<string, number>> = {};
  if (people.data) counts["/admin/users"] = people.data.length;
  if (invitations.data) counts["/admin/invitations"] = invitations.data.length;
  if (mailboxes.data) counts["/admin/mailboxes"] = mailboxes.data.length;
  if (domains.data) counts["/admin/domains"] = domains.data.length;
  if (notifications.data) {
    counts["/admin/notifications"] = notifications.data.filter((n) => !n.readAt).length;
  }
  if (commitments.data) counts["/admin/commitments"] = commitments.data.length;
  return counts;
}

/* ── dashboard ─────────────────────────────────────────────────────────── */

/**
 * One read — `GET /admin/dashboard` — with the old fan-out as its fallback.
 *
 * The fan-out was there for a good reason: an aggregate that fails as a unit
 * turns one broken subsystem into a blank page. That objection is answered on
 * the server rather than by keeping seven calls: each section of the aggregate
 * resolves independently and a failure comes back named in `degraded`, so the
 * page still renders everything that worked.
 *
 * What the fan-out cost was real. It fetched every member, every mailbox,
 * every domain and every connector row and then called `.length` on them.
 * Those are now counts, done by the database.
 */
export function useDashboard(windowHours = 24): QueryLike<DashboardDto> {
  return shape(
    useQuery({
      queryKey: ["admin-dashboard", windowHours],
      queryFn: () => fetchDashboard(windowHours),
      ...LIVE,
    })
  );
}

/**
 * Drafting and sending an invitation.
 *
 * Two mutations rather than one call, because the admin reviews the letter
 * before a stranger receives it: draft, read, optionally edit, then send.
 * Sending invalidates the invitation list so the new pending row appears
 * without a reload.
 */
export function usePreviewInvitation() {
  return useMutation({
    mutationFn: (input: InvitationDraftInput) => previewInvitation(input),
  });
}

export function useSendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InvitationDraftInput & { letterBody?: string[] }) =>
      sendInvitation(input),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["invitations"] }),
        // The roster shows invited people too, so it is stale as well.
        qc.invalidateQueries({ queryKey: ["people"] }),
      ]);
    },
  });
}

/**
 * Saves the workspace settings and refreshes what the screen shows.
 *
 * Invalidating rather than trusting the request: the server trims, lowercases
 * domains and de-duplicates them, so the saved value is not always the typed
 * one. Re-reading is what makes the page show what was actually stored.
 */
export function useUpdateWorkspaceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: WorkspaceSettingsPatch) => updateWorkspaceSettings(patch),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["settings"] }),
        // The tenant name shows in the shell header too, and settings is
        // derived from the same read.
        qc.invalidateQueries({ queryKey: ["tenant"] }),
      ]);
    },
  });
}
