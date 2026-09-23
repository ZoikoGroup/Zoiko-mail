import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser, throughMfa } from "./helpers.js";

const app = createApp();

/**
 * Delegating one person's mailbox to another — RBAC §2 "Delegate mailbox
 * access", §3 and §9.1.
 *
 * The capability existed in the matrix with nothing behind it: `mailbox.delegate`
 * appeared in the vocabulary and in two role rows, and no route read it. The
 * nearest thing that worked was the shared-mailbox assignee flow, which filters
 * to SHARED/DISTRIBUTION and so refuses a personal mailbox before it reads the
 * body — it could never express "let Dana cover Sam's inbox while Sam is away".
 *
 * The rule these tests exist for is the split in §2's own columns: Owner is an
 * unconditional Yes, Admin is "If policy". That is a condition about the
 * workspace rather than about the caller, so it cannot live in the matrix, and
 * it lands deny-by-default — an Admin cannot delegate until an Owner has said
 * this workspace permits it.
 */

/** An owner, an admin, and two members, each with a live session. */
async function workspace(suffix: string) {
  const owner = await registerUser(app, { email: `dg-owner-${suffix}@zoiko.test` });

  const add = async (role: "ADMIN" | "MEMBER", who: string) => {
    const email = `dg-${who}-${suffix}@zoiko.test`;
    const user = await registerUser(app, { email });
    const added = await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email, role })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: user.password, tenantId: owner.tenantId })
      .expect(200);
    // AC-002 stops an Admin sign-in at an MFA challenge, so a plain login
    // hands back a challenge rather than a session and every admin assertion
    // below would read as 401 instead of the 403 it is actually testing.
    const answered = await throughMfa(app, login, user.mfaSecret);
    const session = answered.body.data.session ?? answered.body.data;
    return {
      email,
      accessToken: session.accessToken as string,
      membershipId: added.body.data.id as string,
    };
  };

  return {
    owner,
    admin: await add("ADMIN", "admin"),
    sam: await add("MEMBER", "sam"),
    dana: await add("MEMBER", "dana"),
  };
}

/** Sam's own mailbox — the thing being delegated. */
async function personalMailbox(ownerToken: string, membershipId: string) {
  const res = await request(app)
    .post("/api/v1/mail/admin/mailboxes")
    .set(authHeader(ownerToken))
    .send({ membershipId })
    .expect(201);
  return res.body.data.id as string;
}

const delegate = (token: string, mailboxId: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/v1/mail/admin/mailboxes/${mailboxId}/delegates`)
    .set(authHeader(token))
    .send(body);

const listDelegates = (token: string, mailboxId: string) =>
  request(app)
    .get(`/api/v1/mail/admin/mailboxes/${mailboxId}/delegates`)
    .set(authHeader(token));

/** Turn delegation on for this workspace's admins. */
async function activateDelegationPolicy(ownerToken: string, effect: "ALLOW" | "DENY") {
  const created = await request(app)
    .post("/api/v1/policies")
    .set(authHeader(ownerToken))
    .send({
      type: "DELEGATION",
      name: `Delegation ${effect}`,
      rules: { defaultEffect: effect, conditions: [] },
    })
    .expect(201);
  const policyId = created.body.data.id as string;
  await request(app)
    .post(`/api/v1/policies/${policyId}/activate`)
    .set(authHeader(ownerToken))
    .expect(200);
  return policyId;
}

describe("delegate mailbox access", () => {
  it("lets an owner delegate one member's mailbox to another", async () => {
    const w = await workspace("a");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);

    const res = await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(200);

    expect(res.body.data.membershipId).toBe(w.dana.membershipId);
    expect(res.body.data.canRead).toBe(true);
    // Omitted permissions stay off — widening is typed out, not inherited.
    expect(res.body.data.canSend).toBe(false);
    expect(res.body.data.canManage).toBe(false);
  });

  it("shows the delegation on the mailbox afterwards", async () => {
    const w = await workspace("b");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);
    await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
      canSend: true,
    }).expect(200);

    const res = await listDelegates(w.owner.accessToken, mailboxId).expect(200);
    expect(res.body.data.delegates).toHaveLength(1);
    expect(res.body.data.delegates[0].canSend).toBe(true);
  });

  /**
   * The gate this file is really about. An Admin holds `mailbox.delegate` in
   * the matrix, so the route lets them through — and the service still refuses,
   * because the workspace has never said administrators may do this.
   */
  it("refuses an admin while the workspace has set no delegation policy", async () => {
    const w = await workspace("c");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);

    const res = await delegate(w.admin.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(403);

    expect(res.body.error.details.reason).toBe("NO_ACTIVE_POLICY");
  });

  it("still lets the owner delegate when admins may not", async () => {
    const w = await workspace("d");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);

    await delegate(w.admin.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(403);

    // §2 gives the Owner an unconditional Yes. An owner who had to write a
    // policy granting themselves a capability their own column already gives
    // would be answering to a rule only they can edit, which is not a control.
    await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(200);
  });

  it("lets an admin delegate once an owner activates a permitting policy", async () => {
    const w = await workspace("e");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);

    await delegate(w.admin.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(403);

    await activateDelegationPolicy(w.owner.accessToken, "ALLOW");

    await delegate(w.admin.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(200);
  });

  it("refuses an admin when the active policy denies", async () => {
    const w = await workspace("f");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);
    await activateDelegationPolicy(w.owner.accessToken, "DENY");

    const res = await delegate(w.admin.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(403);

    expect(res.body.error.details.reason).toBe("DEFAULT_EFFECT");
  });

  it("refuses to delegate a mailbox to the person it already belongs to", async () => {
    const w = await workspace("g");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);

    const res = await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.sam.membershipId,
    }).expect(409);

    expect(res.body.error.details.reason).toBe("DELEGATE_TO_OWNER");
  });

  /**
   * A delegate who can re-delegate turns one Owner decision into a chain
   * nobody approved, so canAssign is not offered — asking for it is a 400
   * naming the field rather than a value quietly dropped.
   */
  it("does not accept canAssign", async () => {
    const w = await workspace("h");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);

    await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
      canAssign: true,
    }).expect(400);
  });

  it("refuses a plain member outright, policy or no policy", async () => {
    const w = await workspace("i");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);
    await activateDelegationPolicy(w.owner.accessToken, "ALLOW");

    await delegate(w.dana.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(403);
  });

  it("revokes access, and the mailbox stops listing it", async () => {
    const w = await workspace("j");
    const mailboxId = await personalMailbox(w.owner.accessToken, w.sam.membershipId);
    await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(200);

    await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${mailboxId}/delegates/${w.dana.membershipId}`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);

    const after = await listDelegates(w.owner.accessToken, mailboxId).expect(200);
    expect(after.body.data.delegates).toHaveLength(0);
  });

  it("cannot reach a mailbox in another workspace", async () => {
    const w = await workspace("k");
    const other = await workspace("l");
    const mailboxId = await personalMailbox(other.owner.accessToken, other.sam.membershipId);

    await delegate(w.owner.accessToken, mailboxId, {
      membershipId: w.dana.membershipId,
    }).expect(404);
  });
});
