import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, stepUpHeader, throughMfa } from "./helpers.js";

const app = createApp();

/**
 * Who may ask for an export or a deletion — RBAC §2 and PRD §16.
 *
 * The whole router was `requireRole("OWNER")`, the only one of ten that shut
 * an Admin out entirely. That contradicted three things at once: §2 records
 * "Request export" and "Request deletion" as Admin **By policy**, PRD §16
 * lists "Export/deletion" among the admin console's requirements, and the
 * matrix holds `data.export` as STEP_UP for an Admin — a capability that
 * resolved perfectly and then met a router that had already refused. It is
 * also why no admin screen existed: nobody builds UI for a guaranteed 403.
 *
 * "By policy" is the part worth pinning. It means an Admin may not until the
 * workspace says so — not "unless the workspace forbids it" — so the gate is
 * closed on a tenant that has never set a policy.
 */

async function workspace(suffix: string) {
  const owner = await registerUser(app, { email: `lc-owner-${suffix}@zoiko.test` });
  const email = `lc-admin-${suffix}@zoiko.test`;
  const admin = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "ADMIN" })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: admin.password, tenantId: owner.tenantId })
    .expect(200);
  // AC-002 stops an Admin sign-in at a challenge; without answering it every
  // assertion below reads 401 instead of the 403 it is really about.
  const answered = await throughMfa(app, login, admin.mfaSecret);
  const session = answered.body.data.session ?? answered.body.data;
  return { owner, adminToken: session.accessToken as string };
}

async function activatePolicy(
  ownerToken: string,
  type: "EXPORT" | "DELETION",
  effect: "ALLOW" | "DENY"
) {
  const created = await request(app)
    .post("/api/v1/policies")
    .set(authHeader(ownerToken))
    .send({ type, name: `${type} ${effect}`, rules: { defaultEffect: effect, conditions: [] } })
    .expect(201);
  await request(app)
    .post(`/api/v1/policies/${created.body.data.id}/activate`)
    .set(authHeader(ownerToken))
    .expect(200);
}

async function requestExport(token: string) {
  // `data.export` is STEP_UP (§5: any export is high-risk), so the fresh
  // token comes first — without it the refusal is REQUIRES_STEP_UP and the
  // policy gate this file is about is never reached.
  const stepUp = await stepUpHeader(app, token);
  return request(app)
    .post("/api/v1/lifecycle/exports")
    .set(authHeader(token))
    .set(stepUp)
    .set("Idempotency-Key", `exp-${Math.random().toString(36).slice(2)}`)
    .send({ reason: "Customer asked for their data" });
}

const requestDeletion = (token: string) =>
  request(app)
    .post("/api/v1/lifecycle/deletions")
    .set(authHeader(token))
    .set("Idempotency-Key", `del-${Math.random().toString(36).slice(2)}`)
    .send({ targetType: "TENANT", reason: "Customer is closing the account" });

describe("admin access to export and deletion", () => {
  it("lets an admin reach the router at all", async () => {
    const w = await workspace("reach");
    // Not a 403 from the router before anything is decided — that refusal was
    // the bug, and it hid every case below.
    const res = await request(app)
      .get("/api/v1/lifecycle")
      .set(authHeader(w.adminToken));
    expect(res.status).toBe(200);
  });

  it("refuses an admin export while the workspace has set no policy", async () => {
    const w = await workspace("noexp");
    const res = await requestExport(w.adminToken);
    expect(res.status).toBe(403);
    expect(res.body.error.details.reason).toBe("NO_ACTIVE_POLICY");
  });

  it("lets an admin export once an owner activates a permitting policy", async () => {
    const w = await workspace("okexp");
    expect((await requestExport(w.adminToken)).status).toBe(403);
    await activatePolicy(w.owner.accessToken, "EXPORT", "ALLOW");
    expect((await requestExport(w.adminToken)).status).toBe(202);
  });

  it("refuses an admin export when the active policy denies", async () => {
    const w = await workspace("noexp2");
    await activatePolicy(w.owner.accessToken, "EXPORT", "DENY");
    const res = await requestExport(w.adminToken);
    expect(res.status).toBe(403);
    expect(res.body.error.details.reason).toBe("DEFAULT_EFFECT");
  });

  it("refuses an admin deletion request until policy permits it", async () => {
    const w = await workspace("del");
    const refused = await requestDeletion(w.adminToken).expect(403);
    expect(refused.body.error.details.reason).toBe("NO_ACTIVE_POLICY");

    await activatePolicy(w.owner.accessToken, "DELETION", "ALLOW");
    const allowed = await requestDeletion(w.adminToken);
    expect([201, 202]).toContain(allowed.status);
  });

  it("leaves the owner unconditional, policy or no policy", async () => {
    const w = await workspace("owner");
    // §2 gives the Owner a plain Yes. An owner who had to write a policy to
    // grant themselves a capability their own column already carries would be
    // answering to a rule only they can edit.
    expect((await requestExport(w.owner.accessToken)).status).toBe(202);
  });

  it("keeps deciding a request Owner-only, however permissive the policy", async () => {
    const w = await workspace("approve");
    await activatePolicy(w.owner.accessToken, "DELETION", "ALLOW");
    const created = await requestDeletion(w.adminToken);
    const id = created.body.data?.request?.id ?? created.body.data?.id;

    // Requesting is not approving. An Admin may raise it; only the Owner may
    // let it proceed, and no DELETION policy widens that.
    await request(app)
      .post(`/api/v1/lifecycle/${id}/approve`)
      .set(authHeader(w.adminToken))
      .set("Idempotency-Key", `ap-${Math.random().toString(36).slice(2)}`)
      .expect(403);
  });
});
