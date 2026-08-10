import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("User profile", () => {
  it("returns and updates only the authenticated user's profile", async () => {
    const user = await registerUser(app, { email: "profile@zoiko.test" });

    const updated = await request(app)
      .patch("/api/v1/users/me")
      .set(authHeader(user.accessToken))
      .send({
        displayName: "Updated Profile",
        phoneNumber: "+919876543210",
        timezone: "Asia/Kolkata",
        language: "en-IN",
      })
      .expect(200);

    expect(updated.body.data.email).toBe(user.email);
    expect(updated.body.data.displayName).toBe("Updated Profile");
    expect(updated.body.data).not.toHaveProperty("passwordHash");

    const profile = await request(app)
      .get("/api/v1/users/me")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(profile.body.data.phoneNumber).toBe("+919876543210");

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: user.tenantId, eventType: "USER_PROFILE_UPDATED" },
    });
    expect(audit?.actorUserId).toBe(user.userId);
  });

  it("rejects invalid profile settings", async () => {
    const user = await registerUser(app, { email: "invalid-profile@zoiko.test" });
    await request(app)
      .patch("/api/v1/users/me")
      .set(authHeader(user.accessToken))
      .send({ timezone: "Not/A-Timezone", phoneNumber: "123" })
      .expect(400);
  });
});

describe("Tenant settings", () => {
  it("lets an owner read and update only the JWT tenant", async () => {
    const owner = await registerUser(app, {
      email: "tenant-settings-owner@zoiko.test",
      tenantName: "Original Tenant",
    });
    const other = await registerUser(app, {
      email: "other-tenant-owner@zoiko.test",
      tenantName: "Other Tenant",
    });

    const updated = await request(app)
      .patch("/api/v1/tenants/current")
      .set(authHeader(owner.accessToken))
      .send({
        name: "Updated Tenant",
        timezone: "Asia/Kolkata",
        language: "en-IN",
        allowedDomains: ["zoiko.com", "mail.zoiko.com", "zoiko.com"],
        settings: { dateFormat: "DD/MM/YYYY" },
      })
      .expect(200);

    expect(updated.body.data.id).toBe(owner.tenantId);
    expect(updated.body.data.allowedDomains).toEqual(["zoiko.com", "mail.zoiko.com"]);

    const unchangedOther = await prisma.tenant.findUnique({ where: { id: other.tenantId } });
    expect(unchangedOther?.name).toBe("Other Tenant");

    const current = await request(app)
      .get("/api/v1/tenants/current")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(current.body.data.name).toBe("Updated Tenant");
  });

  it("allows members to read settings but not update them", async () => {
    const owner = await registerUser(app, { email: "settings-owner@zoiko.test" });
    const member = await registerUser(app, { email: "settings-member@zoiko.test" });

    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const token = login.body.data.accessToken;

    await request(app)
      .get("/api/v1/tenants/current")
      .set(authHeader(token))
      .expect(200);

    await request(app)
      .patch("/api/v1/tenants/current")
      .set(authHeader(token))
      .send({ name: "Unauthorized Rename" })
      .expect(403);
  });
});
