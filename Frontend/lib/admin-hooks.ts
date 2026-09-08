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
  fetchDeliveryFailures,
  fetchDomains,
  fetchGroups,
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
  fetchTenant,
} from "./admin-queries";
import type { InvitationDraftInput, WorkspaceSettingsPatch } from "./admin-queries";
import { CAPABILITY_MATRIX, GUARDRAILS } from "./admin-api";
import type {
  AuditEventDto,
  CapabilityGroupDto,
  CommitmentDto,
  ConnectorDto,
  DashboardDto,
  DeliveryFailureSummaryDto,
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

export function useDomains(): QueryLike<DomainDto[]> {
  return shape(useQuery({ queryKey: ["domains"], queryFn: fetchDomains, ...LIVE }));
}

/** No Group model exists server-side; the screen shows its error state. */
export function useGroups(): QueryLike<GroupDto[]> {
  return shape(
    useQuery({ queryKey: ["groups"], queryFn: fetchGroups, retry: false, ...LIVE })
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

/* ── delivery health ───────────────────────────────────────────────────── */

/**
 * Failed sends over a trailing window.
 *
 * `retry: false` because the only expected failure is a 403 from a caller
 * without the operator role, and retrying a permission denial three times just
 * delays the tile settling on "—".
 */
/** Whether a response really is a failure summary and can be read as one. */
function isFailureSummary(value: unknown): value is DeliveryFailureSummaryDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeliveryFailureSummaryDto>;
  return (
    typeof candidate.failed === "number" &&
    typeof candidate.windowHours === "number" &&
    typeof candidate.byType === "object" &&
    candidate.byType !== null
  );
}

export function useDeliveryFailures(windowHours = 24) {
  return useQuery({
    queryKey: ["delivery-failures", windowHours],
    queryFn: () => fetchDeliveryFailures(windowHours),
    retry: false,
    ...LIVE,
  });
}

/* ── dashboard ─────────────────────────────────────────────────────────── */

/**
 * Composed from the individual reads rather than a single `GET /admin/dashboard`.
 *
 * Deliberate: one aggregate endpoint becomes the slowest route in the app and
 * couples every tile to one response, so a single failing subsystem blanks the
 * whole page. Composing here means each underlying query fails on its own and
 * the rest of the dashboard still renders.
 */
export function useDashboard(): QueryLike<DashboardDto> {
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: fetchTenant, ...LIVE });
  const members = useMembers();
  const mailboxes = useMailboxes();
  const domains = useDomains();
  const connectors = useConnectors();
  const audit = useAuditEvents();
  const failures = useDeliveryFailures();

  // `failures` is deliberately absent from `parts`: the endpoint is
  // OWNER/ADMIN-only, so a caller who reaches this page without the role gets
  // a 403 there and nowhere else. Letting that blank the whole dashboard would
  // trade one missing tile for six working ones.
  const parts = [tenant, members, mailboxes, domains, connectors, audit];
  const isLoading = parts.some((p) => p.isLoading);
  const error = (parts.find((p) => p.error)?.error as Error) ?? null;

  const failureSummary: DeliveryFailureSummaryDto | null = isFailureSummary(failures.data)
    ? failures.data
    : null;

  if (isLoading || !tenant.data || !members.data) {
    return { data: undefined, isLoading, error };
  }

  const people = members.data;
  const boxes = mailboxes.data ?? [];
  const doms = domains.data ?? [];
  const conns = connectors.data ?? [];

  return {
    data: {
      tenant: {
        name: tenant.data.name,
        planCode: tenant.data.planCode,
        // Labelled as a timezone because that is what it is. `primary_region`
        // (Data Model §6.1) is not in the schema, and printing the timezone
        // under the word "region" was the bug this replaces.
        timezone: tenant.data.timezone ?? "UTC",
        // Optional-chained even though the type says it is always present. A
        // response missing this field used to throw here and take the whole
        // dashboard down to an unhandled error — a white screen is a far worse
        // answer to a partial payload than the word "unknown".
        status: tenant.data.status?.toLowerCase() ?? "unknown",
      },
      counts: {
        // Every membership except REMOVED, which is what the API returns.
        people: people.length,
        pendingInvitations: people.filter((m) => m.status === "INVITED").length,
        mailboxes: boxes.length,
        // No seat entitlement here, and so no meter on the tile. Seats live
        // with billing, which the capability matrix withholds from an Admin
        // (`billing.read` is Owner-only) — so the previous fallback of
        // `mailboxSeats = boxes.length` could only ever draw a full bar, which
        // read as "at capacity" rather than "unknown".
        suspendedMailboxes: boxes.filter((m) => m.status === "SUSPENDED").length,
        connectedAccounts: conns.length,
        connectedGmail: conns.filter((c) => c.name === "Gmail").length,
        connectedMicrosoft: conns.filter((c) => c.name === "Microsoft 365").length,
        domainsVerified: doms.filter((d) => d.verificationStatus === "VERIFIED").length,
        domainsTotal: doms.length,
        // MFA (AC-002) does not exist. Reporting zero coverage is accurate:
        // nobody has a second factor, because the feature is unbuilt. The
        // dashboard's warning then states something true.
        mfaCovered: 0,
        mfaTotal: people.filter((m) => m.status === "ACTIVE").length,
        storageUsedGb: boxes.reduce((sum, m) => sum + m.storageUsedGb, 0),
        storageLimitGb: boxes.reduce((sum, m) => sum + m.storageLimitGb, 0),
      },
      // Real delivery failures now, from GET /mail/admin/delivery-events/summary.
      // Null rather than 0 while unavailable: "no failures" and "could not
      // read" are different facts and the tile renders them differently.
      // Shape-checked rather than trusted, so a proxy or an older build
      // answering with a different body degrades to "—" instead of throwing
      // inside the tile.
      deliveryFailures: failureSummary,
      recentAudit: (audit.data ?? []).slice(0, 6),
      providerSync: conns.slice(0, 6),
    },
    isLoading: false,
    error,
  };
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
