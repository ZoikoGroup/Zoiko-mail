"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api-client";

/**
 * Capability set for the signed-in member.
 *
 * The rule this file exists to enforce: **the UI checks capabilities, never
 * roles.** Nothing in the admin workspace should contain `role === "ADMIN"`.
 * Adding a fifth role is then a data change on the server rather than a hunt
 * through security-relevant branches in the client.
 *
 * Now served by `GET /users/me/capabilities`. The server reads the role from
 * the membership row on every request, so a demotion takes effect on the next
 * fetch rather than at the next sign-in — which is the reason this is a query
 * and not something cached in a token or a store.
 */
export type Capability =
  // Own work
  | "mail.own.rw"
  | "commitments.own.manage"
  | "connector.own.connect"
  | "mail.other.read"
  // People
  | "people.read"
  | "people.invite.member"
  | "people.invite.admin"
  | "people.invite.owner"
  | "people.member.manage"
  | "people.admin.manage"
  | "people.owner.manage"
  | "people.mfa.reset"
  // Workspace
  | "workspace.settings.read"
  | "workspace.settings.write"
  | "workspace.mailboxes.manage"
  | "workspace.domains.manage"
  | "workspace.groups.manage"
  | "policy.write"
  | "policy.security.write"
  | "audit.read"
  // Money and liability
  | "billing.read"
  | "billing.plan.write"
  | "data.export"
  | "tenant.ownership.transfer"
  | "tenant.delete"
  // Support
  | "support.standing"
  | "support.workspace.access"
  | "support.grant.end";

export interface CapabilityState {
  data: Set<Capability> | undefined;
  isLoading: boolean;
  error: Error | null;
}

// The hardcoded Admin set that used to live here is gone on purpose. The
// server's matrix is now the single source of truth, and a client-side copy
// would be a second one — which drifts, and then the UI offers buttons the API
// refuses. Backend tests/capabilities.test.ts pins the Admin set instead.

/** One resolved capability, as the server reports it. */
export interface CapabilityDecision {
  capability: Capability;
  kind: "ALLOW" | "DENY" | "READ_ONLY" | "OWN" | "STEP_UP" | "TWO_PERSON" | "GRANT" | null;
  allowed: boolean;
  reason: string;
  requiresStepUp: boolean;
  requiresSecondApprover: boolean;
  requiresSupportGrant: boolean;
  ownResourceOnly: boolean;
  readOnly: boolean;
  /** Which roles hold this — the "ask them instead" half of a denial. */
  heldBy: string[];
}

export interface CapabilitiesResponse {
  role: string;
  capabilities: Capability[];
  decisions: CapabilityDecision[];
}

async function fetchCapabilities(): Promise<CapabilitiesResponse> {
  // apiRequest already unwraps the { success, data } envelope, so this is the
  // payload itself — reading `.data` off it again yields undefined.
  const res = await apiRequest<CapabilitiesResponse>("/users/me/capabilities");

  // Throw rather than return a shape the caller will read as "no capabilities".
  // A malformed response and an empty capability set are indistinguishable
  // downstream, and one of them silently empties the whole workspace.
  if (!res || !Array.isArray(res.capabilities)) {
    throw new Error("Capability response was malformed");
  }
  return res;
}

/**
 * The full server response, for surfaces that need more than a yes/no —
 * the permissions matrix, and the reason text on a disabled control.
 */
export function useCapabilityDecisions() {
  return useQuery({
    queryKey: ["capabilities"],
    queryFn: fetchCapabilities,
    // A permission decision that is minutes stale is a permission bug, so this
    // is deliberately not given a long stale time.
    staleTime: 30_000,
  });
}

export function useCapabilities(): CapabilityState {
  const { data, isLoading, error } = useCapabilityDecisions();
  return {
    data: data ? new Set(data.capabilities) : undefined,
    isLoading,
    error: (error as Error) ?? null,
  };
}

/**
 * Convenience guard for conditional rendering.
 *
 * Denies while loading and on error. Failing closed matters: the alternative
 * briefly renders controls the server will refuse, which reads to the user as
 * a broken product rather than a permission boundary.
 */
export function useCan(): (capability: Capability) => boolean {
  const { data } = useCapabilities();
  return (capability: Capability) => data?.has(capability) ?? false;
}

/** The decision behind a denial, so a control can explain itself. */
export function useCapabilityReason(): (
  capability: Capability
) => CapabilityDecision | undefined {
  const { data } = useCapabilityDecisions();
  return (capability: Capability) =>
    data?.decisions.find((d) => d.capability === capability);
}
