import type { MembershipRole } from "@prisma/client";
import {
  isCapability,
  type Capability,
  type Reason,
  type ResolverKind,
} from "./capabilities.js";
import { capabilitiesFor, matrixKind, rolesHolding } from "./matrix.js";

/**
 * Capability evaluation — step 6 of the ten-step order in Security §7.2.
 *
 * Steps 1–4 (authentication, token type, tenant resolution, membership
 * active) run before this in middleware; step 5 supplies the role this module
 * reads. Steps 7–10 (mailbox ACL, policy gate, feature gate, step-up
 * satisfaction) are separate concerns: this resolver reports *that* a
 * capability needs step-up or a second approver, and the caller enforces it.
 * Keeping that split means the resolver stays a pure function of its inputs
 * and can be exhaustively tested without a database or a request.
 */

export interface CapabilityContext {
  /** Membership role in the tenant, or null for platform staff / no membership. */
  role: MembershipRole | null;
  /** Whether the membership is currently usable (not suspended). */
  membershipActive?: boolean;
  /** True when an explicit, unexpired support grant covers this request. */
  hasActiveSupportGrant?: boolean;
  /** True when the caller has re-authenticated recently enough for step-up. */
  stepUpSatisfied?: boolean;
  /** A second authorised approver, for two-person capabilities. */
  secondApproverUserId?: string | null;
}

export interface CapabilityDecision {
  capability: Capability;
  /** How the capability is held, or null when the role does not hold it. */
  kind: ResolverKind | null;
  /** True only when the caller may proceed right now, with no further condition. */
  allowed: boolean;
  /** Machine-readable cause; the UI turns this into a sentence. */
  reason: Reason;
  /** Unsatisfied conditions. Never true at the same time as `allowed`. */
  requiresStepUp: boolean;
  requiresSecondApprover: boolean;
  requiresSupportGrant: boolean;
  /** Scope narrowing that still applies when `allowed` is true. */
  ownResourceOnly: boolean;
  readOnly: boolean;
  /** Who does hold this capability — the "ask them instead" half of a denial. */
  heldBy: MembershipRole[];
}

function decision(partial: Omit<CapabilityDecision, "heldBy">): CapabilityDecision {
  return { ...partial, heldBy: rolesHolding(partial.capability) };
}

const NOTHING_REQUIRED = {
  requiresStepUp: false,
  requiresSecondApprover: false,
  requiresSupportGrant: false,
  ownResourceOnly: false,
  readOnly: false,
} as const;

/**
 * Resolves one capability against one caller.
 *
 * Denial is the default at every exit: an unknown capability, a missing
 * membership, a suspended membership and an unheld capability all deny. That
 * ordering matters — a suspended Owner must not out-rank an active Member.
 */
export function resolveCapability(
  capability: string,
  context: CapabilityContext
): CapabilityDecision {
  if (!isCapability(capability)) {
    // Not in the vocabulary. Treated as a denial rather than an error so a
    // typo in a route cannot accidentally open one.
    return {
      capability: capability as Capability,
      kind: null,
      allowed: false,
      reason: "UNKNOWN_CAPABILITY",
      ...NOTHING_REQUIRED,
      heldBy: [],
    };
  }

  const { role } = context;
  if (!role) {
    return decision({
      capability,
      kind: null,
      allowed: false,
      reason: "NO_MEMBERSHIP",
      ...NOTHING_REQUIRED,
    });
  }

  // Step 4 belongs to middleware, but re-checking here keeps the resolver
  // safe to call directly from a service without inheriting a caller's bug.
  if (context.membershipActive === false) {
    return decision({
      capability,
      kind: null,
      allowed: false,
      reason: "MEMBERSHIP_INACTIVE",
      ...NOTHING_REQUIRED,
    });
  }

  const kind = matrixKind(role, capability);
  if (!kind) {
    return decision({
      capability,
      kind: null,
      allowed: false,
      reason: "ROLE_LACKS_CAPABILITY",
      ...NOTHING_REQUIRED,
    });
  }

  switch (kind) {
    case "ALLOW":
      return decision({
        capability,
        kind,
        allowed: true,
        reason: "ALLOWED",
        ...NOTHING_REQUIRED,
      });

    case "OWN":
      // Allowed, but the caller must still scope the query to their own
      // resources. The flag is the resolver's way of saying so out loud.
      return decision({
        capability,
        kind,
        allowed: true,
        reason: "ALLOWED_OWN_RESOURCE",
        ...NOTHING_REQUIRED,
        ownResourceOnly: true,
      });

    case "READ_ONLY":
      return decision({
        capability,
        kind,
        allowed: true,
        reason: "ALLOWED_READ_ONLY",
        ...NOTHING_REQUIRED,
        readOnly: true,
      });

    case "STEP_UP": {
      const satisfied = context.stepUpSatisfied === true;
      return decision({
        capability,
        kind,
        allowed: satisfied,
        reason: satisfied ? "ALLOWED" : "REQUIRES_STEP_UP",
        ...NOTHING_REQUIRED,
        requiresStepUp: !satisfied,
      });
    }

    case "TWO_PERSON": {
      const approved = Boolean(context.secondApproverUserId);
      return decision({
        capability,
        kind,
        allowed: approved,
        reason: approved ? "ALLOWED" : "REQUIRES_SECOND_APPROVER",
        ...NOTHING_REQUIRED,
        requiresSecondApprover: !approved,
      });
    }

    case "GRANT": {
      const granted = context.hasActiveSupportGrant === true;
      return decision({
        capability,
        kind,
        allowed: granted,
        reason: granted ? "ALLOWED" : "REQUIRES_SUPPORT_GRANT",
        ...NOTHING_REQUIRED,
        requiresSupportGrant: !granted,
      });
    }

    case "DENY":
      // Present in the matrix as an explicit refusal, which reads more
      // clearly at a call site than omission when the denial is deliberate.
      return decision({
        capability,
        kind,
        allowed: false,
        reason: "ROLE_LACKS_CAPABILITY",
        ...NOTHING_REQUIRED,
      });
  }
}

/** Convenience predicate for call sites that only need the boolean. */
export function can(capability: string, context: CapabilityContext): boolean {
  return resolveCapability(capability, context).allowed;
}

/**
 * Every decision for a caller, for `GET /me/capabilities` and nav gating.
 *
 * Includes conditional capabilities (step-up, two-person, grant) with their
 * conditions rather than dropping them, so the UI can show "confirm to
 * continue" instead of hiding a control the user does in fact hold.
 */
export function capabilitySnapshot(
  context: CapabilityContext
): CapabilityDecision[] {
  if (!context.role) return [];
  return capabilitiesFor(context.role).map((capability) =>
    resolveCapability(capability, context)
  );
}
