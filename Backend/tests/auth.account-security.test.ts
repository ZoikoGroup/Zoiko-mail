import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Account security", () => {
  it("changes the password, rejects the old password, and revokes all user refresh sessions", async () => {
    const user = await registerUser(app, { email: "password-change@zoiko.test" });
    const secondLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);

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

    const activeTokens = await prisma.refreshToken.count({
      where: { userId: user.userId, revokedAt: null },
    });
    expect(activeTokens).toBe(0);

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(401);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "NewPassword123!", tenantId: user.tenantId })
      .expect(200);

    expect(secondLogin.body.data.refreshToken).toBeTruthy();
    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: user.tenantId, eventType: "PASSWORD_CHANGED" },
    });
    expect(audit?.actorUserId).toBe(user.userId);
  });

  it("logs out every refresh session for the current tenant", async () => {
    const user = await registerUser(app, { email: "logout-all@zoiko.test" });
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);

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
