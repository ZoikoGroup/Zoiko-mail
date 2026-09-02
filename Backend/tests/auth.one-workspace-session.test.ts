import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/** Any tenant-scoped route will do; this one admits every membership role. */
const probe = (accessToken: string) =>
  request(app).get("/api/v1/tenants/current").set(authHeader(accessToken));

interface DualMember {
  email: string;
  password: string;
  userId: string;
  /** Workspace they own. */
  ownTenantId: string;
  /** Workspace they were invited into. */
  guestTenantId: string;
}

/**
 * A user who belongs to two workspaces: one they created, one they were
 * invited into. Logging in without naming a tenant then resolves to
 * WORKSPACE_SELECTION, which is the flow under test.
 */
async function createDualMember(suffix: string): Promise<DualMember> {
  const guest = await registerUser(app, {
    email: `dual-${suffix}@zoiko.test`,
    tenantName: `Own Workspace ${suffix}`,
  });
  const host = await registerUser(app, {
    email: `host-${suffix}@zoiko.test`,
    tenantName: `Host Workspace ${suffix}`,
  });

  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(host.accessToken))
    .send({ email: guest.email, role: "MEMBER" })
    .expect(201);

  return {
    email: guest.email,
    password: guest.password,
    userId: guest.userId,
    ownTenantId: guest.tenantId,
    guestTenantId: host.tenantId,
  };
}

/** Sign in without naming a workspace, and return the selection token. */
async function beginSignIn(user: DualMember): Promise<string> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: user.password })
    .expect(200);

  expect(res.body.data.state).toBe("WORKSPACE_SELECTION");
  const token = res.body.data.selectionToken as string;
  expect(token).toBeTruthy();
  return token;
}

const pick = (selectionToken: string, tenantId: string) =>
  request(app)
    .post("/api/v1/auth/select-workspace")
    .send({ selectionToken, tenantId });

/**
 * Tokens off a select-workspace response.
 *
 * Unlike /auth/login, which flattens the session onto the top level of its
 * payload, /auth/select-workspace returns the AuthState verbatim — so the
 * session sits one level down.
 */
function sessionOf(res: { body: { data: Record<string, unknown> } }) {
  const session = res.body.data.session as
    | { accessToken: string; refreshToken: string; tenant: { id: string } }
    | undefined;
  expect(session?.accessToken).toBeTruthy();
  expect(session?.refreshToken).toBeTruthy();
  return session!;
}

describe("A user with two workspaces holds one session at a time", () => {
  let user: DualMember;

  beforeEach(async () => {
    user = await createDualMember(String(Date.now()));
  });

  it("offers both workspaces and opens the one that was picked", async () => {
    const selectionToken = await beginSignIn(user);

    const opened = await pick(selectionToken, user.ownTenantId).expect(200);
    expect(opened.body.data.state).toBe("SIGNED_IN");
    const session = sessionOf(opened);
    expect(session.tenant.id).toBe(user.ownTenantId);

    await probe(session.accessToken).expect(200);
  });

  it("refuses to open the second workspace on the same sign-in", async () => {
    const selectionToken = await beginSignIn(user);
    await pick(selectionToken, user.ownTenantId).expect(200);

    // The whole point: one sign-in buys one workspace. Without this the token
    // stays valid for its full 15 minutes and can be replayed to open a
    // session in every workspace the account belongs to.
    const replay = await pick(selectionToken, user.guestTenantId).expect(401);
    expect(replay.body.error.code).toBe("TOKEN_REUSED");
  });

  it("will not even reopen the same workspace on a spent sign-in", async () => {
    const selectionToken = await beginSignIn(user);
    await pick(selectionToken, user.ownTenantId).expect(200);

    // Spent is spent, regardless of which workspace is asked for — otherwise
    // the token remains a reusable credential for its whole window.
    await pick(selectionToken, user.ownTenantId).expect(401);
  });

  it("ends the first workspace's session when the second is signed into", async () => {
    const first = sessionOf(
      await pick(await beginSignIn(user), user.ownTenantId).expect(200)
    );
    await probe(first.accessToken).expect(200);

    const second = sessionOf(
      await pick(await beginSignIn(user), user.guestTenantId).expect(200)
    );
    expect(second.tenant.id).toBe(user.guestTenantId);

    // The old access token is still signed and unexpired, so only a
    // server-side check can stop it. This is that check.
    const stale = await probe(first.accessToken).expect(401);
    expect(stale.body.error.code).toBe("SESSION_SUPERSEDED");

    await probe(second.accessToken).expect(200);
  });

  it("stops the abandoned workspace being renewed with its refresh token", async () => {
    const first = sessionOf(
      await pick(await beginSignIn(user), user.ownTenantId).expect(200)
    );
    await pick(await beginSignIn(user), user.guestTenantId).expect(200);

    // Revoking the row matters as much as the activeTenantId check: a live
    // refresh token would otherwise mint a fresh access token for the
    // workspace the user just left.
    const renewed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    expect(renewed.body.error.code).toBe("TOKEN_REUSED");
  });

  it("records the workspace the latest sign-in claimed", async () => {
    await pick(await beginSignIn(user), user.guestTenantId).expect(200);

    const row = await prisma.appUser.findUniqueOrThrow({
      where: { id: user.userId },
      select: { activeTenantId: true },
    });
    expect(row.activeTenantId).toBe(user.guestTenantId);
  });

  it("hands the sign-in back when the picked workspace opens nothing", async () => {
    const selectionToken = await beginSignIn(user);
    await prisma.tenant.update({
      where: { id: user.guestTenantId },
      data: { status: "SUSPENDED" },
    });

    // A suspended workspace issues no session, so spending the token here
    // would strand the user: they would have to sign in again purely because
    // they picked the wrong one of two options.
    const blocked = await pick(selectionToken, user.guestTenantId).expect(200);
    expect(blocked.body.data.state).toBe("WORKSPACE_SUSPENDED");

    const opened = await pick(selectionToken, user.ownTenantId).expect(200);
    expect(opened.body.data.state).toBe("SIGNED_IN");
  });

  it("leaves a single-workspace sign-in alone", async () => {
    // Naming the tenant up front skips selection entirely, and an account
    // with one workspace must not be affected by any of this.
    const solo = await registerUser(app, {
      email: `solo-${Date.now()}@zoiko.test`,
    });

    const again = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: solo.email, password: solo.password })
      .expect(200);
    expect(again.body.data.state).toBe("SIGNED_IN");

    // Signing in again in the same workspace re-claims the same tenant, so
    // the newest session keeps working.
    await probe(again.body.data.accessToken).expect(200);
  });
  it("kills the access token the moment the user signs out", async () => {
    const session = sessionOf(
      await pick(await beginSignIn(user), user.ownTenantId).expect(200)
    );
    await probe(session.accessToken).expect(200);

    await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    // Revoking the refresh token alone would have left this access token
    // working until it expired, so a captured token stayed usable long after
    // its owner signed out. Signing out releases the workspace claim, and
    // that is what makes it dead immediately.
    const after = await probe(session.accessToken).expect(401);
    expect(after.body.error.code).toBe("SESSION_SUPERSEDED");
  });

  it("kills the access token when the user signs out everywhere", async () => {
    const session = sessionOf(
      await pick(await beginSignIn(user), user.guestTenantId).expect(200)
    );
    await probe(session.accessToken).expect(200);

    await request(app)
      .post("/api/v1/auth/logout-all")
      .set(authHeader(session.accessToken))
      .expect(200);

    await probe(session.accessToken).expect(401);
  });

  it("lets the user back in after signing out", async () => {
    const first = sessionOf(
      await pick(await beginSignIn(user), user.ownTenantId).expect(200)
    );
    await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: first.refreshToken })
      .expect(200);

    // Strict enforcement must not become a lockout: a fresh sign-in claims
    // the workspace again and works.
    const again = sessionOf(
      await pick(await beginSignIn(user), user.ownTenantId).expect(200)
    );
    await probe(again.accessToken).expect(200);
  });

  it("will not open a workspace the account does not belong to", async () => {
    const stranger = await registerUser(app, {
      email: `stranger-${Date.now()}@zoiko.test`,
      tenantName: "Stranger Workspace",
    });

    const selectionToken = await beginSignIn(user);
    const refused = await pick(selectionToken, stranger.tenantId).expect(200);

    // Naming someone else's tenant must not open it. The picker is a
    // convenience; membership is what authorises, and it is checked here
    // rather than trusted from the request.
    expect(refused.body.data.state).not.toBe("SIGNED_IN");
    expect(refused.body.data.session).toBeUndefined();
  });

  it("reports the role held in each workspace, which is what routing follows", async () => {
    // The client sends a user to /owner, /admin or their mailbox based on the
    // role in this response. The same person is OWNER of one workspace and
    // MEMBER of the other, so a pick that reported the wrong one would route
    // them into a console they hold no authority in.
    const asOwner = await pick(
      await beginSignIn(user),
      user.ownTenantId
    ).expect(200);
    expect(asOwner.body.data.session.membership.role).toBe("OWNER");
    expect(asOwner.body.data.session.tenant.id).toBe(user.ownTenantId);

    const asMember = await pick(
      await beginSignIn(user),
      user.guestTenantId
    ).expect(200);
    expect(asMember.body.data.session.membership.role).toBe("MEMBER");
    expect(asMember.body.data.session.tenant.id).toBe(user.guestTenantId);
  });
});
