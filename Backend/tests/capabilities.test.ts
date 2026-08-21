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
 * The fourteen capabilities Frontend/lib/admin-capabilities.ts grants an Admin,
 * duplicated here on purpose. If the two drift, the UI offers buttons the API
 * refuses — which users read as a broken product, not a permission boundary.
 * This literal is the tripwire for that drift.
 */
const FRONTEND_ADMIN_CAPABILITIES: Capability[] = [
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

const activeAdmin = { role: "ADMIN" as const, membershipActive: true };
const activeOwner = { role: "OWNER" as const, membershipActive: true };
const activeMember = { role: "MEMBER" as const, membershipActive: true };
const activeSupport = { role: "SUPPORT" as const, membershipActive: true };

describe("capability matrix — Security §7.2 step 6", () => {
  it("grants an Admin exactly the capabilities the admin workspace expects", () => {
    expect(capabilitiesFor("ADMIN").sort()).toEqual(
      [...FRONTEND_ADMIN_CAPABILITIES].sort()
    );
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
    const withheld: Capability[] = [
      "billing.read",
      "billing.plan.write",
      "data.export",
      "tenant.ownership.transfer",
      "tenant.delete",
      "policy.security.write",
      "people.mfa.reset",
      "people.owner.manage",
      "people.admin.manage",
      "people.invite.admin",
      "people.invite.owner",
      "mail.other.read",
    ];
    for (const capability of withheld) {
      expect(can(capability, activeAdmin)).toBe(false);
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
    expect(can("policy.write", activeAdmin)).toBe(true);
    expect(can("policy.security.write", activeAdmin)).toBe(false);
    expect(can("audit.read", activeAdmin)).toBe(true);
    expect(can("data.export", activeAdmin)).toBe(false);
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
  it("holds mail.other.read behind step-up for an Owner", () => {
    const pending = resolveCapability("mail.other.read", activeOwner);
    expect(pending.kind).toBe("STEP_UP");
    expect(pending.allowed).toBe(false);
    expect(pending.requiresStepUp).toBe(true);
    expect(pending.reason).toBe("REQUIRES_STEP_UP");

    const satisfied = resolveCapability("mail.other.read", {
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
    expect(snapshot).toHaveLength(FRONTEND_ADMIN_CAPABILITIES.length);
    expect(snapshot.every((d) => d.heldBy.length > 0)).toBe(true);
  });

  it("keeps conditional capabilities in the snapshot so the UI can prompt", () => {
    const snapshot = capabilitySnapshot(activeOwner);
    const stepUp = snapshot.find((d) => d.capability === "mail.other.read");
    expect(stepUp).toBeDefined();
    expect(stepUp?.requiresStepUp).toBe(true);
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
