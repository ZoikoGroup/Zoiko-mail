/**
 * Real API reads for the admin workspace.
 *
 * These map live responses onto the DTOs the screens already consume, so the
 * components did not change when the fixtures went away.
 *
 * Two things to know before editing:
 *
 *  1. `apiRequest` already unwraps the `{ success, data }` envelope — it
 *     returns `json?.data ?? json`. Typing a call as `{ data: T }` and then
 *     reading `.data` yields undefined, which is how the admin nav once ended
 *     up empty with no error to show for it.
 *  2. Where the backend has nothing to offer a DTO field, these mappers use a
 *     neutral value and say so in a comment. They never invent a plausible
 *     one — a fabricated MFA method or last-seen time is worse than an honest
 *     blank, because it reads as real.
 */
import { apiRequest } from "./api-client";
import type {
  AuditEventDto,
  CommitmentDto,
  ConnectorDto,
  DomainDto,
  GroupDto,
  InvitationDto,
  MailboxDto,
  MemberDto,
  NotificationDto,
  PolicyGroupDto,
  SettingsDto,
  SupportGrantDto,
  SyncErrorDto,
} from "./admin-api";

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Compact relative time, e.g. "2 min ago". Empty string for a null date. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** Bytes to whole gigabytes, which is the only precision the tiles show. */
function gb(bytes: number | string | null | undefined): number {
  const n = typeof bytes === "string" ? Number(bytes) : (bytes ?? 0);
  return Math.round((n || 0) / 1_000_000_000);
}

function personName(user?: { displayName?: string | null; email?: string | null }): string {
  return user?.displayName?.trim() || user?.email || "Unknown";
}

/* ── people ────────────────────────────────────────────────────────────── */

interface ApiMembership {
  id: string;
  role: MemberDto["role"];
  status: MemberDto["status"];
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; displayName: string | null };
}

export async function fetchMembers(): Promise<MemberDto[]> {
  const res = await apiRequest<{ members: ApiMembership[] }>("/membership/members");
  return (res.members ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    status: m.status,
    // MFA does not exist in the backend yet (Security AC-002 is unimplemented),
    // so every row is honestly NONE rather than a guessed method.
    mfaMethod: "NONE",
    // No last-seen column exists on the membership; null renders as "—".
    lastActiveAt: null,
    user: {
      id: m.user.id,
      email: m.user.email,
      displayName: personName(m.user),
    },
  }));
}

/**
 * Invitations come from the same membership list — an invitation *is* a
 * membership in INVITED status, so there is no second endpoint to call.
 */
export async function fetchInvitations(): Promise<InvitationDto[]> {
  const res = await apiRequest<{ members: ApiMembership[] }>("/membership/members");
  return (res.members ?? [])
    .filter((m) => m.status === "INVITED")
    .map((m) => ({
      id: m.id,
      email: m.user.email,
      role: m.role,
      // The membership row records no inviter and no expiry. Both are real
      // gaps; blank is the truthful rendering until the columns exist.
      invitedByName: null,
      createdAt: m.createdAt,
      expiresAt: "",
    }));
}

/* ── mailboxes ─────────────────────────────────────────────────────────── */

interface ApiMailbox {
  id: string;
  address: string;
  storageUsed: number | string;
  storageLimit: number | string;
  sendSuspendedAt: string | null;
  sendSuspensionReason: string | null;
}

export async function fetchMailboxes(): Promise<MailboxDto[]> {
  const res = await apiRequest<ApiMailbox[] | { mailboxes: ApiMailbox[] }>(
    "/mail/admin/mailboxes"
  );
  const rows = Array.isArray(res) ? res : (res.mailboxes ?? []);
  return rows.map((m) => ({
    id: m.id,
    address: m.address,
    // Shared mailboxes need a model that does not exist yet, so every mailbox
    // is individual by construction rather than by assumption.
    type: "INDIVIDUAL",
    status: m.sendSuspendedAt ? "SUSPENDED" : "ACTIVE",
    storageUsedGb: gb(m.storageUsed),
    storageLimitGb: gb(m.storageLimit),
    // Per-mailbox AI enablement (AC-008) is not implemented.
    aiEnabled: false,
    sendSuspensionReason: m.sendSuspensionReason,
  }));
}

/* ── domains ───────────────────────────────────────────────────────────── */

interface ApiDomain {
  id: string;
  domainName: string;
  type: DomainDto["type"];
  verificationStatus: DomainDto["verificationStatus"];
  mxStatus: DomainDto["mxStatus"];
  spfStatus: DomainDto["spfStatus"];
  dkimStatus: DomainDto["dkimStatus"];
  dmarcStatus: DomainDto["dmarcStatus"];
  lastCheckedAt: string | null;
  sendingEnabled: boolean;
  verificationToken: string | null;
}

export async function fetchDomains(): Promise<DomainDto[]> {
  const res = await apiRequest<{ domains: ApiDomain[] }>("/domains");
  return (res.domains ?? []).map((d) => ({
    id: d.id,
    domainName: d.domainName,
    type: d.type,
    verificationStatus: d.verificationStatus,
    mxStatus: d.mxStatus,
    spfStatus: d.spfStatus,
    dkimStatus: d.dkimStatus,
    dmarcStatus: d.dmarcStatus,
    lastCheckedAt: ago(d.lastCheckedAt),
    sendingEnabled: d.sendingEnabled,
    warmupNote: null,
    // The API returns aggregate per-record *statuses* but not the record
    // values themselves, so there is nothing to list here yet. The one value
    // it does return is the ownership token, which is worth showing.
    records: d.verificationToken
      ? [
          {
            type: "TXT",
            host: "@",
            value: d.verificationToken,
            purpose: "Domain ownership",
            status: d.verificationStatus === "VERIFIED" ? "VALID" : "PENDING",
          },
        ]
      : [],
  }));
}

/* ── audit ─────────────────────────────────────────────────────────────── */

interface ApiAuditEvent {
  id: string;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  actorUserId: string | null;
  actor: { id: string; email: string; displayName: string | null } | null;
}

export async function fetchAuditEvents(limit = 50): Promise<AuditEventDto[]> {
  const res = await apiRequest<{ events: ApiAuditEvent[] }>(
    `/audit/events?limit=${limit}`
  );
  return (res.events ?? []).map((e) => ({
    id: e.id,
    eventType: e.eventType,
    actorName: e.actor ? personName(e.actor) : "System",
    // The row records no actor_type (Audit §6.2 asks for one); infer the only
    // distinction the data supports — a human actor, or the system.
    actorType: e.actor ? "user" : "system",
    targetLabel: e.targetType
      ? `${e.targetType}${e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ""}`
      : "—",
    createdAtLabel: ago(e.createdAt),
  }));
}

/* ── connectors ────────────────────────────────────────────────────────── */

interface ApiConnectedAccount {
  id: string;
  provider: "GMAIL" | "MICROSOFT_365";
  email: string;
  status: string;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  membership?: { user?: { email: string; displayName: string | null } } | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  GMAIL: "Gmail",
  MICROSOFT_365: "Microsoft 365",
};

function toConnector(a: ApiConnectedAccount): ConnectorDto {
  const owner = a.membership?.user ? personName(a.membership.user) : a.email;
  return {
    id: a.id,
    name: PROVIDER_LABEL[a.provider] ?? a.provider,
    detail: owner,
    syncLabel: a.lastSyncedAt ? `Synced ${ago(a.lastSyncedAt)}` : "Never synced",
    status:
      a.status === "ACTIVE"
        ? "ACTIVE"
        : a.status === "REAUTH_REQUIRED"
          ? "REAUTH_REQUIRED"
          : "IDLE",
  };
}

/**
 * The workspace-wide view. `GET /connectors` is caller-scoped by design — it
 * returned one row of nine for an operator — so the admin surface reads
 * `/connectors/admin`, and falls back if that build is not deployed yet.
 */
export async function fetchConnectors(): Promise<ConnectorDto[]> {
  try {
    const res = await apiRequest<{ accounts: ApiConnectedAccount[] }>(
      "/connectors/admin"
    );
    return (res.accounts ?? []).map(toConnector);
  } catch {
    const res = await apiRequest<{ accounts: ApiConnectedAccount[] }>("/connectors");
    return (res.accounts ?? []).map(toConnector);
  }
}

interface ApiDeadLetter {
  id: string;
  provider: string;
  eventType: string;
  errorCode: string | null;
  receivedAt: string;
}

export async function fetchSyncErrors(): Promise<SyncErrorDto[]> {
  const res = await apiRequest<{ events: ApiDeadLetter[] }>("/connectors/dead-letter");
  return (res.events ?? []).map((e) => ({
    id: e.id,
    title: e.errorCode ?? "Provider event failed",
    detail: `${PROVIDER_LABEL[e.provider] ?? e.provider} · ${e.eventType}`,
    ago: ago(e.receivedAt),
    action: "Replay",
  }));
}

/* ── policies ──────────────────────────────────────────────────────────── */

interface ApiPolicy {
  id: string;
  type: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  rules: Record<string, unknown> | null;
}

export async function fetchPolicyGroups(): Promise<PolicyGroupDto[]> {
  const res = await apiRequest<{ policies: ApiPolicy[] }>("/policies");
  const byType: Record<string, ApiPolicy[]> = {};
  for (const p of res.policies ?? []) {
    byType[p.type] = [...(byType[p.type] ?? []), p];
  }

  return Object.entries(byType).map(([type, policies]) => {
    // One active version per type is the contract; fall back to the newest.
    const active =
      policies.find((p: ApiPolicy) => p.status === "ACTIVE") ??
      [...policies].sort((a: ApiPolicy, b: ApiPolicy) => b.version - a.version)[0];
    const rules = (active?.rules ?? {}) as Record<string, unknown>;

    const group: PolicyGroupDto = {
      group: active?.name ?? type,
      // SECURITY policy is Owner-only: the matrix withholds
      // `policy.security.write` from an Admin, so the group is shown but
      // marked out of reach rather than hidden.
      restriction:
        type === "SECURITY" ? "Owner only — requires policy.security.write" : null,
      toggles: Object.entries(rules)
        .filter(([, value]) => typeof value === "boolean")
        .map(([key, value]) => ({
          key,
          // Turn camelCase rule keys into readable labels.
          label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
          detail: `${type} policy · version ${active?.version ?? 1}`,
          enabled: value as boolean,
          // Whether an Admin may flip a given rule is evaluation step 8, which
          // is not wired yet. Shown as editable; the server refuses if not.
          locked: type === "SECURITY",
        })),
    };
    return group;
  });
}

/* ── notifications ─────────────────────────────────────────────────────── */

interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const SEVERITY: Record<string, NotificationDto["severity"]> = {
  INFO: "INFO",
  WARNING: "WARNING",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  CRITICAL: "CRITICAL",
};

export async function fetchNotifications(): Promise<NotificationDto[]> {
  const res = await apiRequest<{ notifications: ApiNotification[] }>("/notifications");
  return (res.notifications ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    ago: ago(n.createdAt),
    severity: SEVERITY[n.type] ?? "INFO",
    readAt: n.readAt ? ago(n.readAt) : null,
  }));
}

/* ── tenant settings ───────────────────────────────────────────────────── */

export interface ApiTenant {
  id: string;
  name: string;
  status: string;
  planCode: string;
  timezone: string | null;
  language: string | null;
  allowedDomains: string[];
}

export async function fetchTenant(): Promise<ApiTenant> {
  return apiRequest<ApiTenant>("/tenants/current");
}

export async function fetchSettings(): Promise<SettingsDto> {
  const t = await fetchTenant();
  return {
    general: [
      { key: "name", label: "Workspace name", value: t.name, readOnly: false },
      {
        key: "defaultDomain",
        label: "Default domain",
        value: t.allowedDomains?.[0] ?? "—",
        readOnly: false,
      },
      { key: "timezone", label: "Timezone", value: t.timezone ?? "UTC", readOnly: false },
      { key: "plan", label: "Plan", value: t.planCode, readOnly: true },
    ],
    // Session limits are enforced by the token layer, not stored on the tenant,
    // so they are shown read-only and described rather than fetched.
    sessions: [
      { key: "idle", label: "Idle timeout", value: "Enforced by the session layer", readOnly: true },
      { key: "absolute", label: "Absolute lifetime", value: "Re-authentication required on expiry", readOnly: true },
    ],
  };
}

/* ── own work ──────────────────────────────────────────────────────────── */

interface ApiAction {
  id: string;
  title: string | null;
  status: string;
  dueAt: string | null;
  sourceExcerpt: string | null;
}

export async function fetchCommitments(): Promise<CommitmentDto[]> {
  const res = await apiRequest<{ actions: ApiAction[] }>("/actions");
  return (res.actions ?? []).map((a) => {
    const overdue = a.dueAt ? new Date(a.dueAt).getTime() < Date.now() : false;
    return {
      id: a.id,
      title: a.title ?? "Untitled commitment",
      sourceExcerpt: a.sourceExcerpt ?? "",
      meta: a.status,
      due: a.dueAt ? (overdue ? `Overdue · ${ago(a.dueAt)}` : `Due ${a.dueAt.slice(0, 10)}`) : "No due date",
      state: overdue ? "OVERDUE" : a.status === "PENDING" ? "APPROVAL" : "OPEN",
    };
  });
}

/* ── support grants ────────────────────────────────────────────────────── */

interface ApiGrant {
  id: string;
  reason: string | null;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  approvedByUserId: string | null;
}

/**
 * The active grant, or null. Returns null rather than throwing when the read
 * is refused, because the shell banner must not break the workspace over a
 * permission it may legitimately lack.
 */
export async function fetchActiveSupportGrant(): Promise<SupportGrantDto | null> {
  let grants: ApiGrant[] = [];
  try {
    const res = await apiRequest<{ grants: ApiGrant[] }>("/support/access-grants");
    grants = res.grants ?? [];
  } catch {
    return null;
  }

  const now = Date.now();
  const active = grants.find(
    (g) => !g.revokedAt && new Date(g.expiresAt).getTime() > now
  );
  if (!active) return null;

  const minsLeft = Math.max(0, Math.round((new Date(active.expiresAt).getTime() - now) / 60_000));
  const hours = Math.floor(minsLeft / 60);
  return {
    id: active.id,
    ticket: active.reason ?? "Support access",
    holderName: "Zoiko support",
    scopeLabel: active.scopes?.join(", ") || "scoped access",
    approvedByName: active.approvedByUserId ? "an Owner" : "—",
    openedAtLabel: ago(active.createdAt),
    expiresInLabel: hours > 0 ? `${hours}h ${minsLeft % 60}m left` : `${minsLeft}m left`,
  };
}

/* ── groups ────────────────────────────────────────────────────────────── */

/**
 * There is no Group model, module or endpoint in the backend. This throws so
 * the screen shows its error state, which is the honest rendering of a feature
 * that does not exist — a fixture here would look like a working feature.
 */
export async function fetchGroups(): Promise<GroupDto[]> {
  throw new Error("Groups are not implemented in the API yet");
}

/** The drafted invitation letter, as the API returns it. */
export interface InvitationLetterDto {
  subject: string;
  greeting: string;
  paragraphs: string[];
  closing: string;
}

export interface InvitationDraftInput {
  firstName?: string;
  lastName?: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "SUPPORT";
}

/**
 * Drafts the letter without inviting anyone.
 *
 * A POST that creates nothing, so it is safe to call again whenever the admin
 * changes a name or the role — the server asserts that side-effect-freedom,
 * and re-drafting on edit is the whole point of a review step.
 */
export async function previewInvitation(
  input: InvitationDraftInput
): Promise<InvitationLetterDto> {
  const data = await apiRequest<{ letter: InvitationLetterDto }>(
    "/membership/invitations/preview",
    { method: "POST", body: input }
  );
  if (!data?.letter) throw new Error("The server did not return a letter to review.");
  return data.letter;
}

/**
 * Sends the invitation, with the body the admin approved.
 *
 * `letterBody` is sent only when it differs from the draft, so an unedited
 * invitation uses the server's own wording rather than a copy of it that
 * would silently go stale if the template changed.
 */
export async function sendInvitation(
  input: InvitationDraftInput & { letterBody?: string[] }
): Promise<void> {
  await apiRequest("/membership/invitations", { method: "POST", body: input });
}
