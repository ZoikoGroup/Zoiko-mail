import { describe, it, expect } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Auth security", () => {
  it("rejects invalid JWT", async () => {
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader("not-a-valid-jwt"))
      .expect(401);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("TOKEN_INVALID");
  });

  it("rejects expired JWT", async () => {
    const user = await registerUser(app);

    const expiredToken = jwt.sign(
      {
        sub: user.userId,
        tenantId: user.tenantId,
        membershipId: user.membershipId,
        role: "OWNER",
        type: "access",
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "-1s" }
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(expiredToken))
      .expect(401);

    expect(response.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects wrong tenant access in JWT", async () => {
    const user = await registerUser(app);

    const otherTenant = await prisma.tenant.create({
      data: {
        name: "Other Tenant",
        status: "ACTIVE",
        planCode: "starter",
      },
    });

    const forgedToken = jwt.sign(
      {
        sub: user.userId,
        tenantId: otherTenant.id,
        membershipId: user.membershipId,
        role: "OWNER",
        type: "access",
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "15m" }
    );

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(forgedToken))
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects inactive membership", async () => {
    const user = await registerUser(app);

    await prisma.tenantMembership.update({
      where: { id: user.membershipId },
      data: { status: "SUSPENDED" },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(user.accessToken))
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("enforces role authorization", async () => {
    const owner = await registerUser(app, { email: "owner-role@zoiko.test" });

    await request(app)
      .get("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const member = await registerUser(app, {
      email: "member-role@zoiko.test",
    });

    await prisma.tenantMembership.update({
      where: { id: member.membershipId },
      data: { role: "MEMBER" },
    });

    const memberLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: member.email,
        password: member.password,
        tenantId: member.tenantId,
      })
      .expect(200);

    const memberToken = memberLogin.body.data.accessToken;

    const denied = await request(app)
      .get("/api/v1/membership/members")
      .set(authHeader(memberToken))
      .expect(403);

    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("denies SUPPORT role by default", async () => {
    const user = await registerUser(app, { email: "support-role@zoiko.test" });

    await prisma.tenantMembership.update({
      where: { id: user.membershipId },
      data: { role: "SUPPORT" },
    });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: user.email,
        password: user.password,
        tenantId: user.tenantId,
      })
      .expect(200);

    const response = await request(app)
      .get("/api/v1/membership/members")
      .set(authHeader(login.body.data.accessToken))
      .expect(403);

    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rotates refresh tokens and prevents reuse", async () => {
    const user = await registerUser(app, {
      email: "refresh-user@zoiko.test",
    });

    const firstRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    const secondRefreshToken = firstRefresh.body.data.refreshToken;
    expect(secondRefreshToken).not.toBe(user.refreshToken);

    const reuseAttempt = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    expect(reuseAttempt.body.error.code).toBe("TOKEN_REUSED");

    const thirdRefresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: secondRefreshToken })
      .expect(401);

    expect(thirdRefresh.body.error.code).toBe("TOKEN_REUSED");
  });
});

describe("Auth flows", () => {
  it("registers, logs in, returns current user, and logs out", async () => {
    const user = await registerUser(app, {
      email: "flow-user@zoiko.test",
      tenantName: "Flow Tenant",
    });

    const meResponse = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(user.accessToken))
      .expect(200);

    expect(meResponse.body.data.email).toBe("flow-user@zoiko.test");
    expect(meResponse.body.data.tenant.name).toBe("Flow Tenant");

    const loginResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: user.email,
        password: user.password,
        tenantId: user.tenantId,
      })
      .expect(200);

    expect(loginResponse.body.data.accessToken).toBeTruthy();

    await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: loginResponse.body.data.refreshToken })
      .expect(200);

    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: loginResponse.body.data.refreshToken })
      .expect(401);
  });

  it("requires tenant selection for multi-tenant users", async () => {
    const first = await registerUser(app, {
      email: "multi-user@zoiko.test",
      tenantName: "Tenant One",
    });

    const secondTenant = await prisma.tenant.create({
      data: {
        name: "Tenant Two",
        status: "ACTIVE",
        planCode: "starter",
      },
    });

    await prisma.tenantMembership.create({
      data: {
        tenantId: secondTenant.id,
        userId: first.userId,
        role: "MEMBER",
        status: "ACTIVE",
      },
    });

    const selectionResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: first.email,
        password: first.password,
      })
      .expect(200);

    expect(selectionResponse.body.data.requiresTenantSelection).toBe(true);
    expect(selectionResponse.body.data.tenants).toHaveLength(2);
  });
});
