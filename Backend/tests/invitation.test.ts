import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashToken } from "../src/common/utils/tokenHash.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Membership invitations", () => {
  it("stores only a token hash and lets only the intended user accept once", async () => {
    const owner = await registerUser(app, { email: "invite-owner@zoiko.test" });
    const invitee = await registerUser(app, { email: "invite-user@zoiko.test" });
    const stranger = await registerUser(app, { email: "invite-stranger@zoiko.test" });

    const created = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: invitee.email, role: "MEMBER" })
      .expect(201);

    const token = created.body.data.invitationToken;
    const membershipId = created.body.data.membership.id;
    expect(token).toBeTruthy();
    expect(created.body.data.membership.status).toBe("INVITED");

    const stored = await prisma.tenantMembership.findUnique({ where: { id: membershipId } });
    expect(stored?.inviteToken).toBe(hashToken(token));
    expect(stored?.inviteToken).not.toBe(token);

    await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(stranger.accessToken))
      .send({ invitationToken: token })
      .expect(403);

    const accepted = await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(invitee.accessToken))
      .send({ invitationToken: token })
      .expect(200);
    expect(accepted.body.data.status).toBe("ACTIVE");
    expect(accepted.body.data.tenantId).toBe(owner.tenantId);

    await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(invitee.accessToken))
      .send({ invitationToken: token })
      .expect(401);

    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: invitee.email, password: invitee.password, tenantId: owner.tenantId })
      .expect(200);
  });

  it("rejects expired invitations", async () => {
    const owner = await registerUser(app, { email: "expired-owner@zoiko.test" });
    const invitee = await registerUser(app, { email: "expired-user@zoiko.test" });
    const created = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: invitee.email, role: "MEMBER" })
      .expect(201);

    await prisma.tenantMembership.update({
      where: { id: created.body.data.membership.id },
      data: { inviteExpiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(invitee.accessToken))
      .send({ invitationToken: created.body.data.invitationToken })
      .expect(410);
    expect(response.body.error.code).toBe("INVITATION_EXPIRED");
  });

  it("allows cancellation and safe reinvitation of a removed membership", async () => {
    const owner = await registerUser(app, { email: "cancel-owner@zoiko.test" });
    const invitee = await registerUser(app, { email: "cancel-user@zoiko.test" });
    const first = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: invitee.email, role: "MEMBER" })
      .expect(201);

    await request(app)
      .delete(`/api/v1/membership/invitations/${first.body.data.membership.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const second = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: invitee.email, role: "ADMIN" })
      .expect(201);
    expect(second.body.data.membership.id).toBe(first.body.data.membership.id);
    expect(second.body.data.membership.role).toBe("ADMIN");
    expect(second.body.data.invitationToken).not.toBe(first.body.data.invitationToken);
  });
});
