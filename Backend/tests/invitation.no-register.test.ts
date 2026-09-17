import { describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * The invitee who never registers.
 *
 * invitation.test.ts already covers the invited account that goes through
 * /auth/register, and that path works — register flips the INVITED
 * placeholder to PENDING_VERIFICATION, which is the one status
 * joinWorkspace knew how to promote.
 *
 * This is the other way in, and it is the one people actually take. The
 * invitation email links to /accept-invitation, that page needs a session,
 * and the invitee has no password yet because createInvitation gave the
 * placeholder a random one. So they use "forgot password", which proves they
 * control the address, and sign in. Login answers INVITATION_PENDING, they
 * accept, and /auth/register is never involved.
 *
 * Their AppUser therefore stayed INVITED for ever. The membership went
 * ACTIVE, the session was minted and signed correctly, and then
 * tenantContext refused every single request with 403 "User account is
 * disabled" — so the workspace they had just joined was unusable, and the
 * console bounced them to the sign-in page with nothing to explain why.
 *
 * The assertion that matters is the last one in each test: not what the
 * database says, but whether the session the join handed back can actually
 * be used. That is the thing the user experiences.
 */

const PASSWORD = "Password123!";

/** Set a password the way an invitee does: reset by emailed code. */
async function setPasswordByReset(email: string, userId: string) {
  await request(app).post("/api/v1/auth/forgot-password").send({ email }).expect(200);

  // The code is hashed, so the test replaces it rather than reading it —
  // the same trick invitation.test.ts uses for the verification OTP.
  await prisma.emailOtp.updateMany({
    where: { userId, purpose: "PASSWORD_RESET", consumedAt: null },
    data: { codeHash: await bcrypt.hash("123456", 10) },
  });

  await request(app)
    .post("/api/v1/auth/reset-password")
    .send({ email, code: "123456", newPassword: PASSWORD })
    .expect(200);
}

async function inviteFreshPerson(owner: { accessToken: string }, role: "MEMBER" | "ADMIN") {
  const email = `no-reg-${role.toLowerCase()}-${Date.now()}@zoiko.test`;

  const created = await request(app)
    .post("/api/v1/membership/invitations")
    .set(authHeader(owner.accessToken))
    .send({ email, role })
    .expect(201);

  const placeholder = await prisma.appUser.findUnique({ where: { email } });
  // The precondition for everything below: an account nobody has registered.
  expect(placeholder?.status).toBe("INVITED");

  return { email, membershipId: created.body.data.membership.id as string, userId: placeholder!.id };
}

describe("an invitee who sets a password by reset instead of registering", () => {
  it("can use the workspace they just joined", async () => {
    const owner = await registerUser(app, { email: `no-reg-owner-${Date.now()}@zoiko.test` });
    const { email, membershipId, userId } = await inviteFreshPerson(owner, "MEMBER");

    await setPasswordByReset(email, userId);

    // Login cannot sign them in yet — the only membership is still INVITED —
    // so it hands back the pending token the acceptance screen uses.
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(login.body.data.state).toBe("INVITATION_PENDING");
    const pendingToken = login.body.data.pendingToken as string;
    expect(pendingToken).toBeTruthy();

    const joined = await request(app)
      .post("/api/v1/auth/join-workspace")
      .set(authHeader(pendingToken))
      .send({ membershipId })
      .expect(201);
    expect(joined.body.data.state).toBe("SIGNED_IN");

    const user = await prisma.appUser.findUnique({ where: { email } });
    expect(user?.status).toBe("ACTIVE");
    // Accepting proves control of the address, so the account is verified
    // too — membership.service.acceptInvitation has always said the same.
    expect(user?.emailVerifiedAt).not.toBeNull();

    // The one that matters. Before the fix this was 403 "User account is
    // disabled": a session that authenticates and can do nothing, which is
    // indistinguishable from being signed out and is why the console
    // returned people to the login screen.
    const accessToken = joined.body.data.session.accessToken as string;
    await request(app)
      .get("/api/v1/auth/me")
      .set(authHeader(accessToken))
      .expect(200);
  });

  it("is told to enrol a second factor when the seat is an Admin one", async () => {
    const owner = await registerUser(app, { email: `no-reg-owner2-${Date.now()}@zoiko.test` });
    const { email, membershipId, userId } = await inviteFreshPerson(owner, "ADMIN");

    await setPasswordByReset(email, userId);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);

    const joined = await request(app)
      .post("/api/v1/auth/join-workspace")
      .set(authHeader(login.body.data.pendingToken))
      .send({ membershipId })
      .expect(201);

    // AC-002. Worth pinning from the accept path specifically, because the
    // console's acceptance screen used to assume every join ends signed in:
    // it read an accessToken that an MFA challenge does not carry, stored
    // nothing, and sent the new admin to the member workspace holding no
    // session at all.
    expect(joined.body.data.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(joined.body.data.session).toBeUndefined();
  });
});
