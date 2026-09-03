import { describe, expect, it, vi } from "vitest";
import request from "supertest";

const googleProfile = {
  providerUserId: "google-scope-subject",
  email: "scope-google@zoiko.test",
  displayName: "Scope Google",
  avatarUrl: null as string | null,
};
vi.mock("../src/modules/auth/google.verifier.js", () => ({
  verifyGoogleIdToken: vi.fn(async () => googleProfile),
}));

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { authHeader, registerUser } = await import("./helpers.js");

const app = createApp();

/**
 * A session is bound to one console, and the console it was opened for is the
 * only one it can act in.
 *
 * The gap this closes was reachable by typing a URL: an Admin who signed into
 * the admin console could open /owner and the owner console rendered, because
 * a session was bound to a tenant but not to a console. Binding it means the
 * owner surface refuses an admin-scoped session even though the same person
 * would be allowed there after signing in for it.
 */

const decode = (token: string) =>
  JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
  ) as { workspace?: string; role?: string };

/**
 * An Owner-only surface. The whole /lifecycle router is requireRole("OWNER"),
 * so it separates an owner session from an admin one — unlike /billing, which
 * admits Admin on most of its routes.
 */
const ownerOnly = (accessToken: string) =>
  request(app).get("/api/v1/lifecycle").set(authHeader(accessToken));

const signInWithGoogle = () =>
  request(app).post("/api/v1/auth/google").send({ idToken: "stubbed" });

describe("a session is bound to the console it was opened for", () => {
  it("binds a password sign-in to the console its role implies", async () => {
    const owner = await registerUser(app, { email: `scope-owner-${Date.now()}@zoiko.test` });

    expect(decode(owner.accessToken).workspace).toBe("OWNER");
    expect(decode(owner.refreshToken).workspace).toBe("OWNER");
  });

  it("reports the console on /auth/me, so the client never has to infer it", async () => {
    const owner = await registerUser(app, { email: `scope-me-${Date.now()}@zoiko.test` });

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(me.body.data.workspace).toBe("OWNER");
  });

  it("keeps the console across a refresh rather than re-deriving it", async () => {
    const owner = await registerUser(app, { email: `scope-refresh-${Date.now()}@zoiko.test` });

    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(200);

    // Re-deriving from the role would be indistinguishable here for an Owner,
    // but would silently promote the Google case below.
    expect(decode(refreshed.body.data.accessToken).workspace).toBe("OWNER");
  });

  describe("Google sign-in", () => {
    it("always opens the member console, however senior the account", async () => {
      const owner = await registerUser(app, {
        email: googleProfile.email,
        tenantName: "Google Owner Workspace",
      });
      expect(decode(owner.accessToken).workspace).toBe("OWNER");

      const viaGoogle = await signInWithGoogle().expect(200);
      expect(viaGoogle.body.data.state).toBe("SIGNED_IN");

      // The same person, the same workspace, a different console: signing in
      // with Google must never land in an administration console.
      expect(decode(viaGoogle.body.data.accessToken).workspace).toBe("MEMBER");
      expect(viaGoogle.body.data.membership.role).toBe("MEMBER");
    });

    it("cannot reach an owner-only surface, even for an owner", async () => {
      await registerUser(app, {
        email: googleProfile.email,
        tenantName: "Google Owner Surface",
      });

      const viaGoogle = await signInWithGoogle().expect(200);
      const refused = await ownerOnly(viaGoogle.body.data.accessToken);

      // Authority follows the console, not the membership: this is the whole
      // point of scoping rather than merely routing the browser elsewhere.
      expect(refused.status).toBe(403);
    });

    it("stays a member session across a refresh", async () => {
      await registerUser(app, {
        email: googleProfile.email,
        tenantName: "Google Refresh Workspace",
      });
      const viaGoogle = await signInWithGoogle().expect(200);

      const refreshed = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: viaGoogle.body.data.refreshToken })
        .expect(200);

      // A refresh that re-derived the scope from the role would hand an Owner
      // the owner console without them ever signing in for it.
      expect(decode(refreshed.body.data.accessToken).workspace).toBe("MEMBER");
      const refusedAgain = await ownerOnly(refreshed.body.data.accessToken);
      expect(refusedAgain.status).toBe(403);
    });
  });

  describe("a password sign-in aimed at one console", () => {
    it("lets an owner use an owner-only surface", async () => {
      const owner = await registerUser(app, {
        email: `scope-owner-ok-${Date.now()}@zoiko.test`,
      });

      // The counterpart to the refusals above: scoping must not break the
      // console the session was actually opened for.
      const allowed = await ownerOnly(owner.accessToken);
      expect(allowed.status).not.toBe(403);
    });

    it("refuses an admin-scoped session on an owner-only surface", async () => {
      const owner = await registerUser(app, {
        email: `scope-host-${Date.now()}@zoiko.test`,
      });
      const adminEmail = `scope-admin-${Date.now()}@zoiko.test`;
      const admin = await registerUser(app, { email: adminEmail });

      await request(app)
        .post("/api/v1/membership/members")
        .set(authHeader(owner.accessToken))
        .send({ email: adminEmail, role: "ADMIN" })
        .expect(201);

      const asAdmin = await request(app)
        .post("/api/v1/auth/login")
        .send({
          email: adminEmail,
          password: admin.password,
          tenantId: owner.tenantId,
        })
        .expect(200);

      const session = asAdmin.body.data.session ?? asAdmin.body.data;
      expect(decode(session.accessToken).workspace).toBe("ADMIN");

      // This is the video: an admin console session reaching an owner
      // surface. Refused now, at the API, not merely hidden in the UI.
      const refused = await ownerOnly(session.accessToken);
      expect(refused.status).toBe(403);
    });
  });

  it("narrows a session whose role was reduced after it was issued", async () => {
    const owner = await registerUser(app, {
      email: `scope-host2-${Date.now()}@zoiko.test`,
    });
    const email = `scope-demoted-${Date.now()}@zoiko.test`;
    const person = await registerUser(app, { email });

    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email, role: "ADMIN" })
      .expect(201);

    const asAdmin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: person.password, tenantId: owner.tenantId })
      .expect(200);
    const session = asAdmin.body.data.session ?? asAdmin.body.data;

    await prisma.tenantMembership.updateMany({
      where: { userId: person.userId, tenantId: owner.tenantId },
      data: { role: "MEMBER" },
    });

    // The scope is what the session was opened for; the membership is the
    // live limit. The lesser of the two wins, so a demotion takes effect on
    // the next request rather than at the next sign-in.
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(session.accessToken))
      .expect(200);
    expect(me.body.data.membership.role).toBe("MEMBER");
  });
});
