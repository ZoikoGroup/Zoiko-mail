import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Audit log API", () => {
  it("lists and filters paginated events for the JWT tenant", async () => {
    const owner = await registerUser(app, { email: "audit-owner@zoiko.test" });
    const other = await registerUser(app, { email: "audit-other@zoiko.test" });

    await request(app)
      .patch("/api/v1/users/me")
      .set(authHeader(owner.accessToken))
      .send({ displayName: "Audited Owner" })
      .expect(200);

    const response = await request(app)
      .get("/api/v1/audit/events")
      .query({ eventType: "USER_PROFILE_UPDATED", page: 1, limit: 1 })
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(response.body.data.events).toHaveLength(1);
    expect(response.body.data.events[0].tenantId).toBe(owner.tenantId);
    expect(response.body.data.events[0].actor.email).toBe(owner.email);
    expect(response.body.data.pagination).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(response.body.data.events.some((event: { tenantId: string }) => event.tenantId === other.tenantId)).toBe(false);
  });

  it("redacts sensitive metadata and blocks cross-tenant event lookup", async () => {
    const owner = await registerUser(app, { email: "audit-redact@zoiko.test" });
    const other = await registerUser(app, { email: "audit-boundary@zoiko.test" });
    const event = await prisma.auditEvent.create({
      data: {
        tenantId: owner.tenantId,
        actorUserId: owner.userId,
        eventType: "SECURITY_TEST",
        metadata: { accessToken: "raw-token", nested: { password: "raw-password", safe: "ok" } },
      },
    });

    const result = await request(app)
      .get(`/api/v1/audit/events/${event.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(result.body.data.metadata.accessToken).toBe("[REDACTED]");
    expect(result.body.data.metadata.nested.password).toBe("[REDACTED]");
    expect(result.body.data.metadata.nested.safe).toBe("ok");

    await request(app)
      .get(`/api/v1/audit/events/${event.id}`)
      .set(authHeader(other.accessToken))
      .expect(404);
  });

  it("denies normal members and validates date ranges", async () => {
    const owner = await registerUser(app, { email: "audit-admin-owner@zoiko.test" });
    const member = await registerUser(app, { email: "audit-member@zoiko.test" });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password, tenantId: owner.tenantId })
      .expect(200);

    await request(app)
      .get("/api/v1/audit/events")
      .set(authHeader(login.body.data.accessToken))
      .expect(403);

    await request(app)
      .get("/api/v1/audit/events")
      .query({ from: "2026-07-22T00:00:00Z", to: "2026-07-21T00:00:00Z" })
      .set(authHeader(owner.accessToken))
      .expect(400);
  });
});
