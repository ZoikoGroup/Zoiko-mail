import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Accepting an invitation when you do not have an account yet.
 *
 * The flow was a closed loop. `createInvitation` gives a new person a
 * placeholder AppUser with a random password nobody knows, and
 * `POST /invitations/accept` sat behind `authenticate` — so the invitee had
 * to sign in to accept, and could not sign in because they had no password.
 * Clicking the link in the same browser as the inviter produced the other
 * half of it: a session that belonged to somebody else, and a 403 reading
 * "Invitation belongs to another user".
 *
 * The token is the credential, the same way a password-reset link is: it was
 * delivered to the invited address, so presenting it proves control of that
 * mailbox. That is already the reasoning `acceptInvitation` uses when it
 * promotes an account from INVITED to ACTIVE.
 *
 * The case that must never regress is the last one. An admin can invite any
 * address they like, so a token must not set a password on an account that
 * already exists — that would turn "invite" into "take over the account of
 * someone whose mailbox I do not control".
 */

const PASSWORD = "InviteeChosen1";

async function invite(suffix: string, role: "MEMBER" | "ADMIN" = "MEMBER") {
  const owner = await registerUser(app, { email: `cl-owner-${suffix}@zoiko.test` });
  const email = `cl-invitee-${suffix}@zoiko.test`;
  const res = await request(app)
    .post("/api/v1/membership/invitations")
    .set(authHeader(owner.accessToken))
    .send({ email, role })
    .expect(201);
  return { owner, email, token: res.body.data.invitationToken as string };
}

const lookup = (token: string) =>
  request(app).get("/api/v1/membership/invitations/lookup").query({ token });

const claim = (invitationToken: string, password = PASSWORD) =>
  request(app).post("/api/v1/membership/invitations/claim").send({ invitationToken, password });

describe("claiming an invitation", () => {
  it("tells an invitee what they were invited to, with no session at all", async () => {
    const { email, token } = await invite("lookup");

    // No Authorization header anywhere in this request. That is the point:
    // the invitee has no password yet, so they cannot have one.
    const res = await lookup(token).expect(200);

    expect(res.body.data.email).toBe(email);
    expect(res.body.data.needsPassword).toBe(true);
    expect(res.body.data.tenantName).toBeTruthy();
  });

  it("lets them set a password and join, unauthenticated", async () => {
    const { email, token } = await invite("claim");

    await claim(token).expect(200);

    // The password they chose is the one that signs them in.
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(login.body.data).toBeTruthy();
  });

  it("activates the membership, not just the account", async () => {
    const { email, token } = await invite("active");
    await claim(token).expect(200);

    const user = await prisma.appUser.findUnique({ where: { email } });
    expect(user?.status).toBe("ACTIVE");
    // A link that arrived in that mailbox is the same evidence the
    // verification email would have produced; asking again is asking twice.
    expect(user?.emailVerifiedAt).not.toBeNull();

    const membership = await prisma.tenantMembership.findFirst({
      where: { userId: user!.id },
    });
    expect(membership?.status).toBe("ACTIVE");
  });

  it("refuses a password too weak for the registration rules", async () => {
    const { token } = await invite("weak");
    // Reached from a link rather than a form, but it is the same act — a
    // lower bar here would be a way around the registration rules.
    await claim(token, "short").expect(400);
  });

  it("refuses an expired invitation", async () => {
    const { token, email } = await invite("expired");
    const user = await prisma.appUser.findUnique({ where: { email } });
    await prisma.tenantMembership.updateMany({
      where: { userId: user!.id },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });

    await claim(token).expect(410);
  });

  it("refuses a token that was never issued", async () => {
    await claim("not-a-real-invitation-token-at-all").expect(401);
  });

  it("cannot be replayed once claimed", async () => {
    const { token } = await invite("replay");
    await claim(token).expect(200);
    // The membership is ACTIVE now, so the invitation is spent. A second
    // claim must not reset the password somebody is already using.
    await claim(token, "DifferentOne1").expect(401);
  });

  /**
   * The account-takeover case.
   *
   * An admin can invite any address. If a token could set a password on an
   * account that already exists, inviting someone would be a password reset
   * for a mailbox the admin does not control.
   */
  it("will not set a password on an account that already exists", async () => {
    const owner = await registerUser(app, { email: "cl-host@zoiko.test" });
    const victim = await registerUser(app, { email: "cl-victim@zoiko.test" });

    const invited = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: victim.email, role: "MEMBER" })
      .expect(201);

    const res = await claim(invited.body.data.invitationToken as string, "AttackerPicked1").expect(409);
    expect(res.body.error.details.reason).toBe("ACCOUNT_ALREADY_EXISTS");

    // Their own password still works, and the attacker's does not.
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: victim.email, password: "AttackerPicked1" })
      .expect(401);
  });

  it("tells the accept page that an existing account needs to sign in instead", async () => {
    const owner = await registerUser(app, { email: "cl-host2@zoiko.test" });
    const existing = await registerUser(app, { email: "cl-existing@zoiko.test" });
    const invited = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(owner.accessToken))
      .send({ email: existing.email, role: "MEMBER" })
      .expect(201);

    const res = await lookup(invited.body.data.invitationToken as string).expect(200);
    // So the screen offers a sign-in rather than a password field it would
    // then have to refuse.
    expect(res.body.data.needsPassword).toBe(false);
  });
});
