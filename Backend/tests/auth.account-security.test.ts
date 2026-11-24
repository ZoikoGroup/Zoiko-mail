import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser, loginUser } from "./helpers.js";

const app = createApp();

describe("Account security", () => {
  it("changes the password, rejects the old password, and revokes all user refresh sessions", async () => {
    const user = await registerUser(app, { email: "password-change@zoiko.test" });
    const secondLogin = await loginUser(app, user.email, user.password, user.tenantId);

    await request(app)
      .post("/api/v1/auth/change-password")
      .set(authHeader(user.accessToken))
      .send({ currentPassword: "WrongPassword!", newPassword: "NewPassword123!" })
      .expect(401);

    await request(app)
      .post("/api/v1/auth/change-password")
      .set(authHeader(user.accessToken))
      .send({ currentPassword: user.password, newPassword: "NewPassword123!" })
      .expect(200);

    // Every other session ends; the one that changed the password stays signed
    // in (P1): the profile screen carries on with it afterwards, and the
    // per-request session check would otherwise sign the person out the
    // moment they finished.
    const decode = (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as { sid: string };
    const live = await prisma.refreshToken.findMany({
      where: { userId: user.userId, revokedAt: null },
      select: { sessionId: true },
    });
    expect(live.map((row) => row.sessionId)).toEqual([decode(user.accessToken).sid]);
    await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(secondLogin.accessToken as string))
      .expect(401);
    await request(app).get("/api/v1/auth/me").set(authHeader(user.accessToken)).expect(200);

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(401);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "NewPassword123!", tenantId: user.tenantId })
      .expect(200);

    expect(secondLogin.refreshToken).toBeTruthy();
    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: user.tenantId, eventType: "PASSWORD_CHANGED" },
    });
    expect(audit?.actorUserId).toBe(user.userId);
  });

  it("logs out every refresh session for the current tenant", async () => {
    const user = await registerUser(app, { email: "logout-all@zoiko.test" });
    // A second, real session: the sign-in has to clear the MFA gate to leave a
    // refresh token behind for logout-all to revoke (AC-002).
    await loginUser(app, user.email, user.password, user.tenantId, user.mfaSecret);

    const response = await request(app)
      .post("/api/v1/auth/logout-all")
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(response.body.data.revokedSessionCount).toBe(2);
    expect(
      await prisma.refreshToken.count({
        where: { userId: user.userId, tenantId: user.tenantId, revokedAt: null },
      })
    ).toBe(0);
  });
});
