import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashToken } from "../src/common/utils/tokenHash.js";
import bcrypt from "bcrypt";
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

    const accepted =     await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(invitee.accessToken))
      .send({ invitationToken: token })
      .expect(200);
    expect(accepted.body.data.status).toBe("ACTIVE");
    expect(accepted.body.data.tenantId).toBe(owner.tenantId);

    // Re-presenting the same email link is idempotent (double-click,
    // StrictMode double-mount, mail-scanner prefetch) — not an error.
    const repeat = await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(invitee.accessToken))
      .send({ invitationToken: token })
      .expect(200);
    expect(repeat.body.data.status).toBe("ACTIVE");
    expect(repeat.body.data.id).toBe(accepted.body.data.id);

    // A token that was never issued stays invalid.
    await request(app)
      .post("/api/v1/membership/invitations/accept")
      .set(authHeader(invitee.accessToken))
      .send({ invitationToken: "bogus-token-that-was-never-issued-000000" })
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

  it("lets an unregistered email be invited, then routes the fresh registration into that workspace as ADMIN/MEMBER", async () => {
    const owner = await registerUser(app, { email: "preinvite-owner@zoiko.test" });
    const invitedEmail = `preinvite-user-${Date.now()}@zoiko.test`;

    // 1. Invite an email that has never signed up — placeholder identity is created.
    const created = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: invitedEmail, role: "ADMIN" })
      .expect(201);
    const membershipId = created.body.data.membership.id;
    expect(created.body.data.membership.status).toBe("INVITED");
    const placeholder = await prisma.appUser.findUnique({ where: { email: invitedEmail } });
    expect(placeholder?.status).toBe("INVITED");

    // 2. The invitee registers with that email — claims the placeholder instead of 409.
    const password = "Password123!";
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: invitedEmail, password, displayName: "Pre Invited" })
      .expect(201);
    const claimed = await prisma.appUser.findUnique({ where: { email: invitedEmail } });
    expect(claimed?.status).toBe("PENDING_VERIFICATION");

    // Registering again still conflicts.
    await request(app)
      .post("/api/v1/auth/register")
      .send({ email: invitedEmail, password, displayName: "Dup" })
      .expect(409);

    // 3. Verify the OTP → response lists the pending invitation.
    await prisma.emailOtp.updateMany({
      where: { userId: placeholder!.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
      data: { codeHash: await bcrypt.hash("123456", 10) },
    });
    const verified = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set(authHeader(registered.body.data.pendingToken))
      .send({ code: "123456" })
      .expect(200);
    const invitations = verified.body.data.pendingInvitations;
    expect(invitations).toHaveLength(1);
    expect(invitations[0].membershipId).toBe(membershipId);
    expect(invitations[0].role).toBe("ADMIN");
    expect(invitations[0].tenantName).toBe("Test Tenant");

    // 4. Workspace creation is blocked for invited accounts…
    await request(app)
      .post("/api/v1/auth/create-workspace")
      .set(authHeader(verified.body.data.pendingToken))
      .send({ tenantName: "Should Not Exist", planCode: "starter" })
      .expect(409);

    // 5. …and joining issues a full session under the invited role.
    const joined = await request(app)
      .post("/api/v1/auth/join-workspace")
      .set(authHeader(verified.body.data.pendingToken))
      .send({ membershipId })
      .expect(201);
    const session = joined.body.data;
    expect(session.membership.role).toBe("ADMIN");
    expect(session.tenant.id).toBe(owner.tenantId);

    // Membership is now ACTIVE and the user is ACTIVE with a real password.
    const stored = await prisma.tenantMembership.findUnique({ where: { id: membershipId } });
    expect(stored?.status).toBe("ACTIVE");
    const user = await prisma.appUser.findUnique({ where: { email: invitedEmail } });
    expect(user?.status).toBe("ACTIVE");

    // 6. Login resolves straight into the joined workspace.
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: invitedEmail, password })
      .expect(200);
    expect(login.body.data.state).toBe("SIGNED_IN");
    expect(login.body.data.membership.role).toBe("ADMIN");
    expect(login.body.data.tenant.id).toBe(owner.tenantId);

    // Joining twice fails cleanly (invitation already consumed).
    await request(app)
      .post("/api/v1/auth/join-workspace")
      .set(authHeader(joined.body.data.accessToken))
      .send({ membershipId })
      .expect(401); // access token is not a pending token
  });
});
