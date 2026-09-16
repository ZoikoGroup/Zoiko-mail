import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Session management", () => {
  it("lists the registry's live sessions and flags the newest as current", async () => {
    const user = await registerUser(app, { email: "sessions-list@zoiko.test" });

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);

    const response = await request(app)
      .get("/api/v1/auth/sessions")
      .set(authHeader(user.accessToken))
      .expect(200);

    const sessions = response.body.data.sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].isCurrent).toBe(true);
    expect(sessions[1].isCurrent).toBe(false);
    expect(sessions[0].deviceLabel).toBeTruthy();
    expect(sessions[0].ipAddress).toBeDefined();
    expect(sessions[0].createdAt).toBeTruthy();
  });

  it("revokes one device and leaves the rest signed in", async () => {
    const user = await registerUser(app, { email: "sessions-revoke@zoiko.test" });

    const secondLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);
    const secondRefreshToken = secondLogin.body.data.session.refreshToken;

    const list = await request(app)
      .get("/api/v1/auth/sessions")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(list.body.data.sessions).toHaveLength(2);
    const currentSessionId = list.body.data.sessions[0].id;
    const olderSession = list.body.data.sessions.find(
      (s: { isCurrent: boolean }) => !s.isCurrent
    );
    expect(olderSession).toBeTruthy();

    await request(app)
      .post(`/api/v1/auth/sessions/${olderSession.id}/revoke`)
      .set(authHeader(user.accessToken))
      .expect(200);

    // The list now shows exactly one live session: the newer one.
    const after = await request(app)
      .get("/api/v1/auth/sessions")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(after.body.data.sessions).toHaveLength(1);
    expect(after.body.data.sessions[0].id).toBe(currentSessionId);

    // …and that survivor still refreshes.
    const refreshed = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: secondRefreshToken })
      .expect(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();
  });

  it("returns 404 for revoking an unknown or already-revoked session", async () => {
    const user = await registerUser(app, { email: "sessions-404@zoiko.test" });

    await request(app)
      .post("/api/v1/auth/sessions/00000000-0000-4000-8000-000000000001/revoke")
      .set(authHeader(user.accessToken))
      .expect(404);

    const list = await request(app)
      .get("/api/v1/auth/sessions")
      .set(authHeader(user.accessToken))
      .expect(200);
    const current = list.body.data.sessions[0];

    await request(app)
      .post(`/api/v1/auth/sessions/${current.id}/revoke`)
      .set(authHeader(user.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/auth/sessions/${current.id}/revoke`)
      .set(authHeader(user.accessToken))
      .expect(404);
  });
});