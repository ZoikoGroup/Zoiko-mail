import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

async function addMember(ownerEmail: string, role: "MEMBER" | "ADMIN") {
  const owner = await registerUser(app, { email: ownerEmail });
  const member = await registerUser(app, {
    email: ownerEmail.replace("@", `-m@`),
  });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: member.email, role })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
    .expect(200);
  return { owner, memberToken: login.body.data.session.accessToken as string };
}

describe("GET /api/v1/tenants/settings/general", () => {
  it("returns defaults for a fresh workspace", async () => {
    const owner = await registerUser(app, { email: "gsettings-fresh@zoiko.test" });

    const res = await request(app)
      .get("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data).toEqual({
      emailNotifications: true,
      digestFrequency: "daily",
      theme: "system",
      timezone: "UTC",
      language: "en",
    });
  });

  it("is forbidden for MEMBER", async () => {
    const { memberToken } = await addMember("gsettings-member-owner@zoiko.test", "MEMBER");

    await request(app)
      .get("/api/v1/tenants/settings/general")
      .set(authHeader(memberToken))
      .expect(403);
  });
});

describe("PATCH /api/v1/tenants/settings/general", () => {
  it("updates settings and persists them", async () => {
    const owner = await registerUser(app, { email: "gsettings-update@zoiko.test" });

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ theme: "dark", digestFrequency: "weekly", emailNotifications: false })
      .expect(200);

    const res = await request(app)
      .get("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.theme).toBe("dark");
    expect(res.body.data.digestFrequency).toBe("weekly");
    expect(res.body.data.emailNotifications).toBe(false);
  });

  it("merges partial updates instead of replacing stored settings", async () => {
    const owner = await registerUser(app, { email: "gsettings-merge@zoiko.test" });

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ theme: "light" })
      .expect(200);

    // Second patch with a different key must not wipe the first.
    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ emailNotifications: false })
      .expect(200);

    const res = await request(app)
      .get("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(res.body.data.theme).toBe("light");
    expect(res.body.data.emailNotifications).toBe(false);
    expect(res.body.data.digestFrequency).toBe("daily");
  });

  it("does not clobber unrelated keys stored on tenant.settings", async () => {
    const owner = await registerUser(app, { email: "gsettings-unrelated@zoiko.test" });

    await prisma.tenant.update({
      where: { id: owner.tenantId },
      data: { settings: { customFlag: "keep-me" } },
    });

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ theme: "dark" })
      .expect(200);

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: owner.tenantId },
      select: { settings: true },
    });
    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    expect(settings.customFlag).toBe("keep-me");
    expect((settings.general as Record<string, unknown>).theme).toBe("dark");
  });

  it("rejects invalid values with 400", async () => {
    const owner = await registerUser(app, { email: "gsettings-invalid@zoiko.test" });

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ theme: "sepia" })
      .expect(400);

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ digestFrequency: "hourly" })
      .expect(400);

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({})
      .expect(400);
  });

  it("is forbidden for MEMBER but allowed for ADMIN", async () => {
    const { owner, memberToken } = await addMember("gsettings-admin-owner@zoiko.test", "MEMBER");

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(memberToken))
      .send({ theme: "dark" })
      .expect(403);

    const admin = await registerUser(app, {
      email: "gsettings-admin-direct@zoiko.test",
    });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: admin.email, role: "ADMIN" })
      .expect(201);
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: admin.email,
        password: admin.password,
        tenantId: owner.tenantId,
      })
      .expect(200);

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(adminLogin.body.data.session.accessToken))
      .send({ theme: "dark" })
      .expect(200);
  });

  it("records a TENANT_SETTINGS_UPDATED audit event", async () => {
    const owner = await registerUser(app, { email: "gsettings-audit@zoiko.test" });

    await request(app)
      .patch("/api/v1/tenants/settings/general")
      .set(authHeader(owner.accessToken))
      .send({ theme: "dark" })
      .expect(200);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        tenantId: owner.tenantId,
        eventType: "TENANT_SETTINGS_UPDATED",
        targetId: owner.tenantId,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    const metadata = (audit!.metadata ?? {}) as { changedFields?: string[] };
    expect(metadata.changedFields).toContain("general.theme");
  });
});
