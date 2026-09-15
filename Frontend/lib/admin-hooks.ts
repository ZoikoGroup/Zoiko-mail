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
  exportAuditEvents,
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
  updateMember,
  removeMember,
  cancelInvitation,
  markNotificationRead,
  replayDeadLetter,
  fetchMailboxRouting,
  createAlias,
  deleteAlias,
  createForwarding,
  deleteForwarding,
} from "./admin-queries";
import type {
  AuditPage,
  AuditQuery,
  GroupAssigneeDto,
  MailboxRoutingDto,
  InvitationDraftInput,
  WorkspaceSettingsPatch,
} from "./admin-queries";
import { useUnreadCounts } from "./mail-hooks";
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
  MembershipRole,
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

/**
 * One page of the audit log, filtered by the server.
 *
 * The query is part of the key, so changing a category or a date range is a
 * new read rather than a re-filter of what happened to be in memory.
 * `placeholderData` keeps the previous page on screen while the next one
 * loads, so paging does not blink through an empty table.
 */
export function useAuditEvents(query: AuditQuery = {}): QueryLike<AuditPage> {
  return shape(
    useQuery({
      queryKey: ["audit", query],
      queryFn: () => fetchAuditEvents(query),
      placeholderData: (previous) => previous,
      ...LIVE,
    })
  );
}

/**
 * Download the audit log.
 *
 * A mutation rather than a query: it is an action with a side effect the
 * server records, and it should run when asked rather than when a key changes.
 */
export function useExportAuditEvents() {
  return useMutation({
    mutationFn: (query: AuditQuery) => exportAuditEvents(query),
  });
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
  const groups = useGroups();
  const unread = useUnreadCounts();

  const counts: Partial<Record<string, number>> = {};
  if (people.data) counts["/admin/users"] = people.data.length;
  if (invitations.data) counts["/admin/invitations"] = invitations.data.length;
  if (mailboxes.data) counts["/admin/mailboxes"] = mailboxes.data.length;
  if (domains.data) counts["/admin/domains"] = domains.data.length;
  if (notifications.data) {
    counts["/admin/notifications"] = notifications.data.filter((n) => !n.readAt).length;
  }
  if (commitments.data) counts["/admin/commitments"] = commitments.data.length;
  if (groups.data) counts["/admin/groups"] = groups.data.length;
  // The rail badge on a mailbox means unread, not total — the same thing the
  // member shell counts, so an Admin reading their own inbox sees one number.
  if (unread.data) counts["/admin/inbox"] = unread.data.INBOX ?? 0;
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
        // The roster shows invited people too, so it is stale as well. Keyed
        // ["members"] to match useMembers — ["people"] is the name of the
        // derived hook, not of any query, so invalidating it refreshed nothing
        // and a new invitation did not appear until the poll came round.
        qc.invalidateQueries({ queryKey: ["members"] }),
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

/* ── acting on people ──────────────────────────────────────────────────── */

/**
 * Invalidate everything a membership change can move.
 *
 * A role change, a suspension and a removal all alter the roster, the pending
 * invitations derived from it, and the rail badges counted off both. Listing
 * them once keeps the three mutations below from drifting apart.
 */
function invalidatePeople(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["members"] }),
    qc.invalidateQueries({ queryKey: ["invitations"] }),
  ]);
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      membershipId,
      patch,
    }: {
      membershipId: string;
      patch: { role?: MembershipRole; status?: "ACTIVE" | "SUSPENDED" };
    }) => updateMember(membershipId, patch),
    onSuccess: () => invalidatePeople(qc),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => removeMember(membershipId),
    onSuccess: () => invalidatePeople(qc),
  });
}

export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => cancelInvitation(membershipId),
    onSuccess: () => invalidatePeople(qc),
  });
}

/* ── notifications ─────────────────────────────────────────────────────── */

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/**
 * Mark every unread notification read.
 *
 * There is no bulk endpoint, so this fans out — and uses `allSettled` rather
 * than `all` so one failure does not discard the ones that succeeded. The
 * refetch afterwards is what tells the truth about which actually landed,
 * rather than the screen assuming all of them did.
 */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationIds: string[]) => {
      const results = await Promise.allSettled(
        notificationIds.map((id) => markNotificationRead(id))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        throw new Error(
          failed === notificationIds.length
            ? "Could not mark them read."
            : `Marked ${notificationIds.length - failed} of ${notificationIds.length} read.`
        );
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/* ── provider events ───────────────────────────────────────────────────── */

export function useReplayDeadLetter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => replayDeadLetter(eventId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sync-errors"] }),
        // A replayed event can bring its account back out of DEGRADED.
        qc.invalidateQueries({ queryKey: ["connectors"] }),
      ]);
    },
  });
}
