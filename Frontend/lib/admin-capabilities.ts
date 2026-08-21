/**
 * Capability set for the signed-in member.
 *
 * The rule this file exists to enforce: **the UI checks capabilities, never
 * roles.** Nothing in the admin workspace should contain `role === "ADMIN"`.
 * Adding a fifth role then becomes a data change on the server rather than a
 * hunt through security-relevant branches in the client.
 *
 * STATIC PHASE: `useCapabilities` returns a hardcoded Admin set. When roadmap
 * item 54 lands, the body becomes a `useQuery` against `GET /me/capabilities`
 * and the returned shape stays identical, so no component changes.
 */

/** Mirrors the 25-row capability matrix. */
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

/**
 * What an Admin holds. Deliberately omits `people.invite.admin`,
 * `people.admin.manage`, `people.owner.manage`, `people.mfa.reset`,
 * `policy.security.write`, everything under billing, and `data.export` —
 * an Admin is not an Owner.
 */
const ADMIN_CAPABILITIES: Capability[] = [
  "mail.own.rw",
  "commitments.own.manage",
  "connector.own.connect",
  "people.read",
  "people.invite.member",
  "people.member.manage",
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.domains.manage",
  "workspace.groups.manage",
  "policy.write",
  "audit.read",
  "support.grant.end",
];

export function useCapabilities(): CapabilityState {
  // Swap point for roadmap item 54:
  //   return useQuery({ queryKey: ["capabilities"], queryFn: fetchCapabilities });
  return {
    data: new Set(ADMIN_CAPABILITIES),
    isLoading: false,
    error: null,
  };
}

/** Convenience guard for conditional rendering. */
export function useCan(): (capability: Capability) => boolean {
  const { data } = useCapabilities();
  return (capability: Capability) => data?.has(capability) ?? false;
}
