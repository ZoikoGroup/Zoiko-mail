
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  can,
  capabilitiesFor,
  capabilitySnapshot,
  resolveCapability,
  rolesHolding,
  type Capability,
} from "../src/common/capabilities/index.js";
/**
 * Admin's column, transcribed from the RBAC Permission Matrix §2.
 *
 * Pinned to the specification rather than to the frontend's list. The earlier
 * version of this file mirrored the client, and because both sides carried the
 * same five errors, every test passed while the matrix contradicted the spec in
 * five cells. A test that agrees with the code it is testing proves nothing;
 * this literal only means something because it comes from a different source.
 */
const SPEC_ADMIN_CAPABILITIES: Capability[] = [
  // §2 own-work rows.
  "mail.own.rw",
  "commitments.own.manage",
  "connector.own.connect",
  // §2 "Invite users": Admin = Yes. Owner invites are withheld separately.
  "people.read",
  "people.invite.member",
  "people.invite.admin",
  // §2 "Assign roles": Admin = Limited — may act on an Admin, never an Owner.
  "people.member.manage",
  "people.admin.manage",
  // §2 workspace rows.
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.domains.manage",
  "workspace.groups.manage",
  "policy.write",
  // §2 "View audit log": Admin = Limited. Held, then scoped in the service.
  "audit.read",
  // §2 "Request export": Admin = "By policy" + Step-up.
  "data.export",
  "support.grant.end",
];

const activeAdmin = { role: "ADMIN" as const, membershipActive: true };
const activeOwner = { role: "OWNER" as const, membershipActive: true };
const activeMember = { role: "MEMBER" as const, membershipActive: true };
const activeSupport = { role: "SUPPORT" as const, membershipActive: true };

describe("capability matrix — Security §7.2 step 6", () => {
  it("grants an Admin exactly the capabilities RBAC §2 assigns", () => {
    expect(capabilitiesFor("ADMIN").sort()).toEqual(
      [...SPEC_ADMIN_CAPABILITIES].sort()
    );
  });

  it("lets an Admin act on another Admin but never on an Owner", () => {
    // §2 "Assign roles": Admin = Limited, "cannot grant/alter Owner".
    expect(can("people.admin.manage", activeAdmin)).toBe(true);
    expect(can("people.invite.admin", activeAdmin)).toBe(true);
    expect(can("people.owner.manage", activeAdmin)).toBe(false);
    expect(can("people.invite.owner", activeAdmin)).toBe(false);
  });

  it("denies private mailbox content to Owner and Admin alike", () => {
    // §2 "Read private user mailbox": Owner = No, Admin = No (AC-005). No
    // amount of re-authentication changes that, so it must not be STEP_UP.
    for (const context of [activeOwner, activeAdmin]) {
      const decision = resolveCapability("mail.other.read", context);
      expect(decision.allowed).toBe(false);
      expect(decision.requiresStepUp).toBe(false);
      expect(decision.reason).toBe("ROLE_LACKS_CAPABILITY");
    }
    // Even satisfying step-up must not open it.
    expect(
      can("mail.other.read", { ...activeOwner, stepUpSatisfied: true })
    ).toBe(false);
  });

  it("routes private content only through an approved support grant", () => {
    expect(rolesHolding("mail.other.read")).toEqual(["SUPPORT"]);
    expect(can("mail.other.read", activeSupport)).toBe(false);
    expect(
      can("mail.other.read", { ...activeSupport, hasActiveSupportGrant: true })
    ).toBe(true);
  });

  it("holds an Admin export behind step-up rather than refusing it", () => {
    // §2 "Request export": Admin = "By policy" + Step-up. Refusing outright
    // would deny a capability the matrix grants conditionally.
    const pending = resolveCapability("data.export", activeAdmin);
    expect(pending.kind).toBe("STEP_UP");
    expect(pending.allowed).toBe(false);
    expect(pending.reason).toBe("REQUIRES_STEP_UP");
    expect(
      can("data.export", { ...activeAdmin, stepUpSatisfied: true })
    ).toBe(true);
  });

  it("makes Owner a strict superset of Admin", () => {
    const owner = new Set(capabilitiesFor("OWNER"));
    for (const capability of capabilitiesFor("ADMIN")) {
      expect(owner.has(capability)).toBe(true);
    }
    expect(capabilitiesFor("OWNER").length).toBeGreaterThan(
      capabilitiesFor("ADMIN").length
    );
  });

  it("withholds every liability capability from an Admin", () => {
    // Held in no form at all — not conditionally, not with step-up. Note
    // `data.export` is absent from this list on purpose: §2 grants it to an
    // Admin conditionally, so it belongs with the step-up cases, not here.
    const withheld: Capability[] = [
      "billing.read",
      "billing.plan.write",
      "tenant.ownership.transfer",
      "tenant.delete",
      "policy.security.write",
      "people.mfa.reset",
      "people.owner.manage",
      "people.invite.owner",
      "mail.other.read",
    ];
    for (const capability of withheld) {
      const decision = resolveCapability(capability, activeAdmin);
      expect(decision.allowed).toBe(false);
      // A withheld capability must not merely be unsatisfied; satisfying
      // every condition must still leave it closed.
      expect(
        can(capability, {
          ...activeAdmin,
          stepUpSatisfied: true,
          secondApproverUserId: "00000000-0000-0000-0000-000000000001",
          hasActiveSupportGrant: true,
        })
      ).toBe(false);
    }
  });

  it("names the authority that holds a capability the caller lacks", () => {
    const decision = resolveCapability("tenant.delete", activeAdmin);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("ROLE_LACKS_CAPABILITY");
    // The point of the reason payload: the UI can say who to ask.
    expect(decision.heldBy).toEqual(["OWNER"]);
  });

  it("keeps the two boundary splits that separate operator from principal", () => {
    // Admin authors policy inside a frame the Owner locks.
    expect(can("policy.write", activeAdmin)).toBe(true);
    expect(can("policy.security.write", activeAdmin)).toBe(false);
    // Admin investigates; the export itself costs a re-authentication and is
    // still subject to the policy gate at evaluation step 8.
    expect(can("audit.read", activeAdmin)).toBe(true);
    expect(resolveCapability("data.export", activeAdmin).requiresStepUp).toBe(true);
  });
});

describe("capability resolution defaults to denial", () => {
  it("denies an unknown capability instead of throwing", () => {
    const decision = resolveCapability("people.invent.something", activeOwner);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("UNKNOWN_CAPABILITY");
    expect(decision.heldBy).toEqual([]);
  });

  it("denies when there is no membership", () => {
    const decision = resolveCapability("people.read", { role: null });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("NO_MEMBERSHIP");
  });

  it("denies a suspended Owner every capability", () => {
    for (const capability of capabilitiesFor("OWNER")) {
      const decision = resolveCapability(capability, {
        role: "OWNER",
        membershipActive: false,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("MEMBERSHIP_INACTIVE");
    }
  });

  it("never reports a capability as allowed while a condition is unmet", () => {
    for (const capability of CAPABILITIES) {
      for (const context of [activeOwner, activeAdmin, activeMember, activeSupport]) {
        const d = resolveCapability(capability, context);
        if (d.requiresStepUp || d.requiresSecondApprover || d.requiresSupportGrant) {
          expect(d.allowed).toBe(false);
        }
      }
    }
  });
});

describe("conditional resolver kinds", () => {
  it("holds people.mfa.reset behind step-up for an Owner", () => {
    // The step-up path is asserted here on a capability the Owner genuinely
    // holds. `mail.other.read` used to serve this purpose, which was the bug:
    // it made an Owner's access to private mail look like a re-auth away.
    const pending = resolveCapability("people.mfa.reset", activeOwner);
    expect(pending.kind).toBe("STEP_UP");
    expect(pending.allowed).toBe(false);
    expect(pending.requiresStepUp).toBe(true);
    expect(pending.reason).toBe("REQUIRES_STEP_UP");

    const satisfied = resolveCapability("people.mfa.reset", {
      ...activeOwner,
      stepUpSatisfied: true,
    });
    expect(satisfied.allowed).toBe(true);
    expect(satisfied.reason).toBe("ALLOWED");
  });

  it("holds destructive tenant capabilities behind a second approver", () => {
    for (const capability of ["tenant.delete", "tenant.ownership.transfer"]) {
      const alone = resolveCapability(capability, activeOwner);
      expect(alone.kind).toBe("TWO_PERSON");
      expect(alone.allowed).toBe(false);
      expect(alone.reason).toBe("REQUIRES_SECOND_APPROVER");

      const approved = resolveCapability(capability, {
        ...activeOwner,
        secondApproverUserId: "00000000-0000-0000-0000-000000000001",
      });
      expect(approved.allowed).toBe(true);
    }
  });

  it("gives platform staff nothing without an active grant", () => {
    const ungranted = resolveCapability("support.workspace.access", activeSupport);
    expect(ungranted.kind).toBe("GRANT");
    expect(ungranted.allowed).toBe(false);
    expect(ungranted.reason).toBe("REQUIRES_SUPPORT_GRANT");

    const granted = resolveCapability("support.workspace.access", {
      ...activeSupport,
      hasActiveSupportGrant: true,
    });
    expect(granted.allowed).toBe(true);
  });

  it("gives platform staff no tenant administration capability at all", () => {
    for (const capability of ["people.read", "audit.read", "workspace.settings.write"]) {
      expect(can(capability, { ...activeSupport, hasActiveSupportGrant: true })).toBe(
        false
      );
    }
  });

  it("marks own-work capabilities as scope-narrowed rather than unrestricted", () => {
    const decision = resolveCapability("mail.own.rw", activeMember);
    expect(decision.allowed).toBe(true);
    expect(decision.ownResourceOnly).toBe(true);
    expect(decision.reason).toBe("ALLOWED_OWN_RESOURCE");
  });

  it("lets a Member observe settings without mutating them", () => {
    const decision = resolveCapability("workspace.settings.read", activeMember);
    expect(decision.allowed).toBe(true);
    expect(decision.readOnly).toBe(true);
    expect(can("workspace.settings.write", activeMember)).toBe(false);
  });
});

describe("snapshot for GET /me/capabilities", () => {
  it("returns one decision per held capability, conditions included", () => {
    const snapshot = capabilitySnapshot(activeAdmin);
    expect(snapshot).toHaveLength(SPEC_ADMIN_CAPABILITIES.length);
    expect(snapshot.every((d) => d.heldBy.length > 0)).toBe(true);
  });

  it("keeps conditional capabilities in the snapshot so the UI can prompt", () => {
    const snapshot = capabilitySnapshot(activeAdmin);
    const stepUp = snapshot.find((d) => d.capability === "data.export");
    // Present but unsatisfied: the client can offer "confirm to continue"
    // rather than hiding a capability the Admin genuinely holds.
    expect(stepUp).toBeDefined();
    expect(stepUp?.requiresStepUp).toBe(true);

    // And a capability held in no form must not appear at all.
    expect(snapshot.some((d) => d.capability === "mail.other.read")).toBe(false);
  });

  it("returns nothing for a caller with no membership", () => {
    expect(capabilitySnapshot({ role: null })).toEqual([]);
  });
});

describe("vocabulary integrity", () => {
  it("has no capability that no role holds", () => {
    const orphans = CAPABILITIES.filter((c) => rolesHolding(c).length === 0);
    expect(orphans).toEqual([]);
  });

  it("declares twenty-eight capabilities", () => {
    expect(CAPABILITIES).toHaveLength(28);
    expect(new Set(CAPABILITIES).size).toBe(28);
  });
});
