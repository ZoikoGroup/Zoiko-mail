import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * GET /me/capabilities and the requireCapability gate, end to end.
 *
 * The resolver has its own exhaustive unit tests; these prove the wiring —
 * that a real request resolves against the role read from the membership row,
 * that the reason payload survives serialisation, and that the admin boundary
 * is enforced by capability rather than by role name.
 */

/** Signs in a second user who has been added to the tenant with `role`. */
async function memberWithRole(
  ownerToken: string,
  tenantId: string,
  role: "ADMIN" | "MEMBER",
  email: string
) {
  const user = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(ownerToken))
    .send({ email: user.email, role })
    .expect(201);

  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: user.password, tenantId })
    .expect(200);

  return {
    ...user,
    token: login.body.data.session?.accessToken ?? login.body.data.accessToken,
  };
}

describe("GET /me/capabilities", () => {
  it("returns the caller's role, capability list and per-capability decisions", async () => {
    const owner = await registerUser(app, { email: "caps-owner@zoiko.test" });

    const res = await request(app)
      .get("/api/v1/users/me/capabilities")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const { role, capabilities, decisions } = res.body.data;
    expect(role).toBe("OWNER");
    expect(capabilities).toContain("audit.read");
    expect(capabilities).toContain("people.owner.manage");
    expect(Array.isArray(decisions)).toBe(true);

    // Every decision carries the authority, which is what lets a client say
    // who to ask rather than only greying a control out.
    for (const decision of decisions) {
      expect(decision.heldBy.length).toBeGreaterThan(0);
    }
  });

  it("gives an Admin exactly the fourteen capabilities the workspace expects", async () => {
    const owner = await registerUser(app, { email: "caps-o2@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "caps-admin@zoiko.test"
    );

    const res = await request(app)
      .get("/api/v1/users/me/capabilities")
      .set(authHeader(admin.token))
      .expect(200);

    expect(res.body.data.role).toBe("ADMIN");
    expect(res.body.data.capabilities).toHaveLength(14);

    // The liability capabilities stay with the Owner.
    for (const withheld of [
      "billing.read",
      "data.export",
      "tenant.delete",
      "policy.security.write",
      "people.owner.manage",
      "people.mfa.reset",
    ]) {
      expect(res.body.data.capabilities).not.toContain(withheld);
    }
  });

  it("keeps a step-up capability in the payload with its unmet condition", async () => {
    const owner = await registerUser(app, { email: "caps-stepup@zoiko.test" });

    const res = await request(app)
      .get("/api/v1/users/me/capabilities")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const readOthers = res.body.data.decisions.find(
      (d: { capability: string }) => d.capability === "mail.other.read"
    );
    // Reported rather than hidden: the Owner holds it, but not right now.
    expect(readOthers).toBeDefined();
    expect(readOthers.requiresStepUp).toBe(true);
    expect(res.body.data.capabilities).not.toContain("mail.other.read");
  });

  it("requires authentication", async () => {
    await request(app).get("/api/v1/users/me/capabilities").expect(401);
  });
});

describe("requireCapability gates real routes", () => {
  it("lets a capability holder through", async () => {
    const owner = await registerUser(app, { email: "gate-owner@zoiko.test" });
    await request(app)
      .get("/api/v1/audit/events")
      .set(authHeader(owner.accessToken))
      .expect(200);
  });

  it("admits an Admin to audit, which an Admin does hold", async () => {
    const owner = await registerUser(app, { email: "gate-o2@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "gate-admin@zoiko.test"
    );

    await request(app)
      .get("/api/v1/audit/events")
      .set(authHeader(admin.token))
      .expect(200);
  });

  it("refuses a Member and explains who holds the capability", async () => {
    const owner = await registerUser(app, { email: "gate-o3@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "gate-member@zoiko.test"
    );

    const res = await request(app)
      .get("/api/v1/audit/events")
      .set(authHeader(member.token))
      .expect(403);

    expect(res.body.error.details).toMatchObject({
      capability: "audit.read",
      reason: "ROLE_LACKS_CAPABILITY",
    });
    // The half that makes a denial actionable instead of a dead end.
    expect(res.body.error.details.heldBy).toEqual(
      expect.arrayContaining(["OWNER", "ADMIN"])
    );
  });

  it("refuses a Member the workspace mailbox surface", async () => {
    const owner = await registerUser(app, { email: "gate-o4@zoiko.test" });
    const member = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "MEMBER",
      "gate-member2@zoiko.test"
    );

    const res = await request(app)
      .get("/api/v1/mail/admin/mailboxes")
      .set(authHeader(member.token))
      .expect(403);

    expect(res.body.error.details.capability).toBe("workspace.mailboxes.manage");
  });

  it("still enforces the admin boundary below the capability gate", async () => {
    // people.member.manage opens the route; refusing an Admin who targets an
    // Owner is a property of the target row, so the service has to catch it.
    const owner = await registerUser(app, { email: "boundary-owner@zoiko.test" });
    const admin = await memberWithRole(
      owner.accessToken,
      owner.tenantId,
      "ADMIN",
      "boundary-admin@zoiko.test"
    );

    const res = await request(app)
      .patch(`/api/v1/membership/members/${owner.membershipId}`)
      .set(authHeader(admin.token))
      .send({ status: "SUSPENDED" })
      .expect(403);

    expect(res.body.error.message).toMatch(/owner/i);
  });
});
