import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("SUPPORT invitation", () => {
  it("lets an owner invite a user as SUPPORT via invitations endpoint", async () => {
    const owner = await registerUser(app, { email: "invite-support-owner@zoiko.test", tenantName: "Invite Support Tenant" });
    const candidate = await registerUser(app, { email: "invite-support-candidate@zoiko.test" });

    const invited = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: candidate.email, role: "SUPPORT" })
      .expect(201);

    expect(invited.body.data.role).toBe("SUPPORT");
    expect(invited.body.data.status).toBe("INVITED");
    expect(invited.body.invitationToken).toBeDefined();
    expect(invited.body.expiresAt).toBeDefined();
  });
});
