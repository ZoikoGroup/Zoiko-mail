import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("self-service workspace creator", () => {
  it("is assigned ADMIN and can open the admin console immediately", async () => {
    const user = await registerUser(app, {
      email: `creator-${Date.now()}@zoiko.test`,
      creatorRole: "ADMIN",
    });

    const membership = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: user.membershipId },
    });
    expect(membership.role).toBe("ADMIN");

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(me.body.data.workspace).toBe("ADMIN");

    await request(app)
      .get("/api/v1/admin/dashboard")
      .set(authHeader(user.accessToken))
      .expect(200);
  });

  it("records the creator role on the WORKSPACE_CREATED audit event", async () => {
    const user = await registerUser(app, {
      email: `creator-audit-${Date.now()}@zoiko.test`,
      creatorRole: "ADMIN",
    });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: user.tenantId, eventType: "WORKSPACE_CREATED" },
    });
    expect((event.metadata as { creatorRole?: string }).creatorRole).toBe("ADMIN");
  });
});