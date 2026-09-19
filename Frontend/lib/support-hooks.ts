"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  commentPlatformTicket,
  createPlatformTicket,
  createSupportAccessGrant,
  fetchPlatformDiagnostics,
  fetchPlatformDomainDetail,
  fetchPlatformMailboxDetail,
  fetchPlatformOverview,
  fetchPlatformTenantOverview,
  fetchSupportAccessGrants,
  fetchSupportDiagnostics,
  fetchSupportOverview,
  fetchTenantDomains,
  fetchTenantMailboxes,
  fetchTenantSupportOverview,
  getPlatformTicket,
  listPlatformAudit,
  listPlatformDeliveryEvents,
  listPlatformGrants,
  listPlatformJobs,
  listPlatformProviderEvents,
  listPlatformStaff,
  listPlatformSuppressions,
  listPlatformTickets,
  listTenantAudit,
  listTenantDeliveryEvents,
  listTenantJobs,
  listTenantProviderEvents,
  listTenantSuppressions,
  revokePlatformGrant,
  revokeSupportAccessGrant,
  searchPlatformDomains,
  searchPlatformMailboxes,
  searchPlatformTenants,
  updatePlatformTicket,
  type CreateSupportGrantInput,
  type CreateTicketInput,
  type PlatformListParams,
  type TenantListParams,
  type TicketListParams,
  type UpdateTicketInput,
} from "./support-api";

/**
 * The support console's data layer.
 *
 * Every other workspace reads through TanStack Query; the support console was
 * the one that did not, so it had no caching, no invalidation after a write,
 * no refetch on focus, and no shared retry. It also meant a console open on a
 * screen showed whatever was true when the page loaded — which is a problem
 * of a different size here than elsewhere, because Runbook §5 sets a
 * fifteen-minute initial response for a P0 and a queue that never moves on its
 * own cannot be answered in fifteen minutes.
 *
 * Two refresh profiles rather than one:
 *
 *   LIVE   what an operator reads and acts on. Short stale window, refetch on
 *          focus. Matches the admin workspace.
 *
 *   QUEUE  what an operator waits on — the ticket queue, the alert-bearing
 *          overviews, delivery and provider events. Polled, because nobody
 *          should have to press refresh to find out a P0 arrived.
 *
 * Searches use neither: they are typed, answered, and stale the moment the
 * query changes, so polling them would be traffic without a reader.
 */

const LIVE = { staleTime: 20_000, refetchOnWindowFocus: true } as const;

/**
 * 30s, matching the member inbox. Short enough that a P0 raised now is on
 * screen well inside the fifteen-minute target, long enough that a console
 * left open overnight is not a load problem.
 */
const QUEUE = {
  staleTime: 15_000,
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
  // Polling a background tab spends the operator's battery to keep a screen
  // nobody is reading up to date.
  refetchIntervalInBackground: false,
} as const;

const SEARCH = { staleTime: 60_000, refetchOnWindowFocus: false } as const;

export const supportKeys = {
  tenantOverview: ["support", "tenant", "overview"] as const,
  tenantWorkspace: ["support", "tenant", "workspace"] as const,
  tenantMailboxes: (q: string, limit: number) => ["support", "tenant", "mailboxes", q, limit] as const,
  tenantDomains: (q: string, limit: number) => ["support", "tenant", "domains", q, limit] as const,
  tenantList: (kind: string, p: TenantListParams) => ["support", "tenant", kind, p] as const,
  grants: ["support", "grants"] as const,
  diagnostics: (grantId: string) => ["support", "diagnostics", grantId] as const,

  platformOverview: ["support", "platform", "overview"] as const,
  platformTenants: (q: string, limit: number) => ["support", "platform", "tenants", q, limit] as const,
  platformTenant: (id: string) => ["support", "platform", "tenant", id] as const,
  platformMailboxes: (q: string, limit: number) => ["support", "platform", "mailboxes", q, limit] as const,
  platformDomains: (q: string, limit: number) => ["support", "platform", "domains", q, limit] as const,
  platformDomain: (t: string, d: string) => ["support", "platform", "domain", t, d] as const,
  platformMailbox: (t: string, m: string) => ["support", "platform", "mailbox", t, m] as const,
  platformList: (kind: string, p: PlatformListParams) => ["support", "platform", kind, p] as const,
  platformGrants: ["support", "platform", "grants"] as const,
  platformDiagnostics: (grantId: string) => ["support", "platform", "diagnostics", grantId] as const,

  tickets: (p: TicketListParams) => ["support", "tickets", p] as const,
  ticket: (id: string) => ["support", "ticket", id] as const,
  staff: ["support", "staff"] as const,
};

/* ── the workspace's own support view ──────────────────────────────────── */

export function useSupportOverview() {
  return useQuery({ queryKey: supportKeys.tenantWorkspace, queryFn: fetchSupportOverview, ...QUEUE });
}

export function useTenantSupportOverview() {
  return useQuery({ queryKey: supportKeys.tenantOverview, queryFn: fetchTenantSupportOverview, ...QUEUE });
}

export function useTenantMailboxes(q = "", limit = 50) {
  return useQuery({
    queryKey: supportKeys.tenantMailboxes(q, limit),
    queryFn: () => fetchTenantMailboxes(q, limit),
    ...SEARCH,
  });
}

export function useTenantDomains(q = "", limit = 50) {
  return useQuery({
    queryKey: supportKeys.tenantDomains(q, limit),
    queryFn: () => fetchTenantDomains(q, limit),
    ...SEARCH,
  });
}

export function useTenantProviderEvents(params: TenantListParams = {}) {
  return useQuery({
    queryKey: supportKeys.tenantList("provider-events", params),
    queryFn: () => listTenantProviderEvents(params),
    ...QUEUE,
  });
}

export function useTenantDeliveryEvents(params: TenantListParams = {}) {
  return useQuery({
    queryKey: supportKeys.tenantList("delivery-events", params),
    queryFn: () => listTenantDeliveryEvents(params),
    ...QUEUE,
  });
}

export function useTenantJobs(params: TenantListParams = {}) {
  return useQuery({
    queryKey: supportKeys.tenantList("jobs", params),
    queryFn: () => listTenantJobs(params),
    ...QUEUE,
  });
}

export function useTenantSuppressions(params: TenantListParams = {}) {
  return useQuery({
    queryKey: supportKeys.tenantList("suppressions", params),
    queryFn: () => listTenantSuppressions(params),
    ...LIVE,
  });
}

export function useTenantAudit(params: TenantListParams = {}) {
  return useQuery({
    queryKey: supportKeys.tenantList("audit", params),
    queryFn: () => listTenantAudit(params),
    ...LIVE,
  });
}

/* ── access grants ─────────────────────────────────────────────────────── */

/**
 * Polled, because a grant ends by itself.
 *
 * An expiry that is only noticed on reload is an expiry the screen is lying
 * about for as long as the tab stays open — and §7 asks for the expiry to be
 * the control, not a note about one.
 */
export function useSupportGrants() {
  return useQuery({ queryKey: supportKeys.grants, queryFn: fetchSupportAccessGrants, ...QUEUE });
}

export function useSupportDiagnostics(grantId: string | null) {
  return useQuery({
    queryKey: supportKeys.diagnostics(grantId ?? ""),
    queryFn: () => fetchSupportDiagnostics(grantId as string),
    enabled: Boolean(grantId),
    ...LIVE,
  });
}

export function useCreateSupportGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupportGrantInput) => createSupportAccessGrant(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supportKeys.grants });
      // The overview counts active grants, so it is wrong the instant one is
      // approved.
      void qc.invalidateQueries({ queryKey: supportKeys.tenantWorkspace });
    },
  });
}

export function useRevokeSupportGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => revokeSupportAccessGrant(grantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supportKeys.grants });
      void qc.invalidateQueries({ queryKey: supportKeys.tenantWorkspace });
      // Revoking removes the caller's own access to everything the grant
      // opened, so nothing already fetched under it should be trusted.
      void qc.invalidateQueries({ queryKey: ["support", "tenant"] });
    },
  });
}

/* ── the platform console ──────────────────────────────────────────────── */

export function usePlatformOverview() {
  return useQuery({ queryKey: supportKeys.platformOverview, queryFn: fetchPlatformOverview, ...QUEUE });
}

export function usePlatformTenants(q = "", limit = 50) {
  return useQuery({
    queryKey: supportKeys.platformTenants(q, limit),
    queryFn: () => searchPlatformTenants(q, limit),
    ...SEARCH,
  });
}

export function usePlatformTenant(tenantId: string | null) {
  return useQuery({
    queryKey: supportKeys.platformTenant(tenantId ?? ""),
    queryFn: () => fetchPlatformTenantOverview(tenantId as string),
    enabled: Boolean(tenantId),
    ...LIVE,
  });
}

export function usePlatformMailboxes(q = "", limit = 50) {
  return useQuery({
    queryKey: supportKeys.platformMailboxes(q, limit),
    queryFn: () => searchPlatformMailboxes(q, limit),
    ...SEARCH,
  });
}

export function usePlatformDomains(q = "", limit = 50) {
  return useQuery({
    queryKey: supportKeys.platformDomains(q, limit),
    queryFn: () => searchPlatformDomains(q, limit),
    ...SEARCH,
  });
}

export function usePlatformDomainDetail(tenantId: string | null, domainId: string | null) {
  return useQuery({
    queryKey: supportKeys.platformDomain(tenantId ?? "", domainId ?? ""),
    queryFn: () => fetchPlatformDomainDetail(tenantId as string, domainId as string),
    enabled: Boolean(tenantId && domainId),
    ...LIVE,
  });
}

export function usePlatformMailboxDetail(tenantId: string | null, mailboxId: string | null) {
  return useQuery({
    queryKey: supportKeys.platformMailbox(tenantId ?? "", mailboxId ?? ""),
    queryFn: () => fetchPlatformMailboxDetail(tenantId as string, mailboxId as string),
    enabled: Boolean(tenantId && mailboxId),
    ...LIVE,
  });
}

export function usePlatformProviderEvents(params: PlatformListParams) {
  return useQuery({
    queryKey: supportKeys.platformList("provider-events", params),
    queryFn: () => listPlatformProviderEvents(params),
    ...QUEUE,
  });
}

export function usePlatformDeliveryEvents(params: PlatformListParams) {
  return useQuery({
    queryKey: supportKeys.platformList("delivery-events", params),
    queryFn: () => listPlatformDeliveryEvents(params),
    ...QUEUE,
  });
}

export function usePlatformJobs(params: PlatformListParams) {
  return useQuery({
    queryKey: supportKeys.platformList("jobs", params),
    queryFn: () => listPlatformJobs(params),
    ...QUEUE,
  });
}

export function usePlatformSuppressions(params: PlatformListParams) {
  return useQuery({
    queryKey: supportKeys.platformList("suppressions", params),
    queryFn: () => listPlatformSuppressions(params),
    ...LIVE,
  });
}

export function usePlatformAudit(params: PlatformListParams) {
  return useQuery({
    queryKey: supportKeys.platformList("audit", params),
    queryFn: () => listPlatformAudit(params),
    ...LIVE,
  });
}

export function usePlatformGrants() {
  return useQuery({ queryKey: supportKeys.platformGrants, queryFn: listPlatformGrants, ...QUEUE });
}

export function usePlatformDiagnostics(grantId: string | null) {
  return useQuery({
    queryKey: supportKeys.platformDiagnostics(grantId ?? ""),
    queryFn: () => fetchPlatformDiagnostics(grantId as string),
    enabled: Boolean(grantId),
    ...LIVE,
  });
}

export function useRevokePlatformGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => revokePlatformGrant(grantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supportKeys.platformGrants });
      void qc.invalidateQueries({ queryKey: supportKeys.platformOverview });
      void qc.invalidateQueries({ queryKey: ["support", "platform"] });
    },
  });
}

/* ── tickets ───────────────────────────────────────────────────────────── */

export function usePlatformTickets(params: TicketListParams = {}) {
  return useQuery({ queryKey: supportKeys.tickets(params), queryFn: () => listPlatformTickets(params), ...QUEUE });
}

export function usePlatformTicket(ticketId: string | null) {
  return useQuery({
    queryKey: supportKeys.ticket(ticketId ?? ""),
    queryFn: () => getPlatformTicket(ticketId as string),
    enabled: Boolean(ticketId),
    // Polled as well as the list: a comment added by the tenant while the
    // ticket is open is the other half of the conversation.
    ...QUEUE,
  });
}

/** Staff rarely changes, and an assignee picker does not need polling. */
export function useSupportStaff() {
  return useQuery({ queryKey: supportKeys.staff, queryFn: listPlatformStaff, staleTime: 5 * 60_000 });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput & { tenantId: string; assignedStaffId?: string | null }) =>
      createPlatformTicket(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["support", "tickets"] });
      void qc.invalidateQueries({ queryKey: supportKeys.platformOverview });
    },
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; input: UpdateTicketInput }) =>
      updatePlatformTicket(v.ticketId, v.input),
    onSuccess: (_data, v) => {
      void qc.invalidateQueries({ queryKey: supportKeys.ticket(v.ticketId) });
      void qc.invalidateQueries({ queryKey: ["support", "tickets"] });
      // Severity drives slaDueAt, and the overview counts what is overdue.
      void qc.invalidateQueries({ queryKey: supportKeys.platformOverview });
    },
  });
}

export function useCommentTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; body: string; internal: boolean }) =>
      commentPlatformTicket(v.ticketId, v.body, v.internal),
    onSuccess: (_data, v) => {
      void qc.invalidateQueries({ queryKey: supportKeys.ticket(v.ticketId) });
      void qc.invalidateQueries({ queryKey: ["support", "tickets"] });
    },
  });
}

/* ── live refresh for screens not yet on the query layer ───────────────── */

/**
 * Re-run an existing loader on an interval.
 *
 * The two console shells are several thousand lines of bespoke state that
 * predate this file. Rewriting them to get polling would be a large change to
 * code with almost no browser coverage, and the benefit — a screen that keeps
 * up — does not need the rewrite. This gives them the refresh now; the query
 * layer above is what they move onto screen by screen.
 *
 * Skips hidden tabs for the same reason QUEUE does, and holds the callback in
 * a ref so a loader redefined each render does not restart the timer.
 */
export function useLiveRefresh(reload: () => void, everyMs = 30_000, enabled = true): void {
  const latest = useRef(reload);
  latest.current = reload;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      latest.current();
    };
    const id = window.setInterval(tick, everyMs);
    // A tab coming back to the front is the moment its contents are most
    // likely to be stale and most likely to be read.
    const onVisible = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs, enabled]);
}
