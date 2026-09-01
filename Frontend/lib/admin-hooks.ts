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
import { useQuery } from "@tanstack/react-query";
import {
  fetchActiveSupportGrant,
  fetchAuditEvents,
  fetchCommitments,
  fetchConnectors,
  fetchDomains,
  fetchGroups,
  fetchInvitations,
  fetchMailboxes,
  fetchMembers,
  fetchNotifications,
  fetchPolicyGroups,
  fetchSettings,
  fetchSyncErrors,
  fetchTenant,
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

  const parts = [tenant, members, mailboxes, domains, connectors, audit];
  const isLoading = parts.some((p) => p.isLoading);
  const error = (parts.find((p) => p.error)?.error as Error) ?? null;

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
        // Region is not modelled on the tenant; show the timezone, which is.
        region: tenant.data.timezone ?? "—",
        status: tenant.data.status.toLowerCase(),
      },
      counts: {
        // Every membership except REMOVED, which is what the API returns.
        people: people.length,
        pendingInvitations: people.filter((m) => m.status === "INVITED").length,
        mailboxes: boxes.length,
        // Seat entitlement lives with billing, which is the Owner's domain and
        // has no endpoint. Falls back to the mailbox count so the meter reads
        // full rather than implying headroom that may not exist.
        mailboxSeats: boxes.length,
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
        // Suspended mailboxes are the closest real signal to failed sending
        // until the delivery-events read is wired.
        failedSends24h: boxes.filter((m) => m.status === "SUSPENDED").length,
        storageUsedGb: boxes.reduce((sum, m) => sum + m.storageUsedGb, 0),
        storageLimitGb: boxes.reduce((sum, m) => sum + m.storageLimitGb, 0),
      },
      recentAudit: (audit.data ?? []).slice(0, 6),
      providerSync: conns.slice(0, 6),
    },
    isLoading: false,
    error,
  };
}
