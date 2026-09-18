import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, mfaCodeFor, registerUser } from "./helpers.js";

const app = createApp();

/**
 * The two ways a second factor becomes a session, and the account check that
 * only one of them made.
 *
 * Verifying an existing authenticator refused any account that was not ACTIVE.
 * Enrolling a new one checked the membership and the workspace and never
 * looked at the account at all — so a non-ACTIVE account with an ACTIVE
 * membership could sign in by enrolling, and would then be refused every time
 * afterwards by the path it would actually use. One account, two answers,
 * depending on which door it came through.
 *
 * That is not a hypothetical. An admin invited before joinWorkspace learned to
 * promote INVITED accounts got in once by enrolling, then met "This account
 * cannot sign in" on every later attempt, holding a correct password and a
 * working authenticator. The message named no cause, so there was nothing to
 * act on.
 *
 * These tests pin the agreement rather than either path's implementation: the
 * same ineligible account must be refused whichever door it uses, and the
 * refusal must say which status is the problem.
 */

const PASSWORD = "Password123!";

/** An owner whose account is then forced into a non-signable status. */
async function ownerWithStatus(status: "INVITED" | "SUSPENDED") {
  const owner = await registerUser(app, {
    email: `mfa-status-${status.toLowerCase()}-${Date.now()}@zoiko.test`,
  });
  await prisma.appUser.update({ where: { id: owner.userId }, data: { status } });
  return owner;
}

/**
 * Put an owner back to having no authenticator.
 *
 * registerUser enrols one, because that is what a real owner does. The
 * enrolment door only opens for an account that has none, so this is how a
 * test reaches it — the same state as an owner who has just been given the
 * seat.
 */
async function withoutAuthenticator(userId: string) {
  await prisma.appUser.update({
    where: { id: userId },
    data: { mfaSecret: null, mfaEnrolledAt: null, mfaLastUsedStep: null },
  });
}

/** The MFA challenge a privileged sign-in stops at (AC-002). */
async function challengeFor(email: string) {
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: PASSWORD });
  return login.body.data as { state: string; mfaToken?: string };
}

describe("an account that cannot sign in is refused by both MFA paths", () => {
  it("is refused when verifying an authenticator it already has", async () => {
    const owner = await ownerWithStatus("SUSPENDED");

    // A suspended account is turned away before the challenge, which is the
    // correct place — asserted so the next test's premise stays honest.
    const state = await challengeFor(owner.email);
    expect(state.state).toBe("ACCOUNT_SUSPENDED");
  });

  it("is refused when enrolling a new authenticator, not signed in", async () => {
    const owner = await registerUser(app, { email: `mfa-enrol-${Date.now()}@zoiko.test` });
    await withoutAuthenticator(owner.userId);

    // Owners are always challenged; with nothing enrolled the challenge is the
    // enrolment door — the one that never checked the account.
    const state = await challengeFor(owner.email);
    expect(state.state).toBe("MFA_ENROLLMENT_REQUIRED");
    const mfaToken = state.mfaToken as string;

    const begun = await request(app)
      .post("/api/v1/auth/mfa/challenge/enroll")
      .set(authHeader(mfaToken))
      .expect(201);
    const secret = begun.body.data.secret as string;

    // The account stops being signable between starting enrolment and
    // finishing it, which is exactly the window the check was missing from.
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { status: "INVITED" },
    });

    const confirmed = await request(app)
      .post("/api/v1/auth/mfa/challenge/confirm")
      .set(authHeader(mfaToken))
      .send({ code: await mfaCodeFor(owner.userId, secret) });

    expect(confirmed.status).toBe(403);
    // No session may come back: enrolling must not be a way in that verifying
    // would refuse.
    expect(confirmed.body.data?.session).toBeUndefined();
    expect(confirmed.body.data?.auth).toBeUndefined();
  });

  it("says which status is the problem, and who can resolve it", async () => {
    const owner = await registerUser(app, { email: `mfa-why-${Date.now()}@zoiko.test` });
    await withoutAuthenticator(owner.userId);
    const state = await challengeFor(owner.email);
    const mfaToken = state.mfaToken as string;

    const begun = await request(app)
      .post("/api/v1/auth/mfa/challenge/enroll")
      .set(authHeader(mfaToken))
      .expect(201);

    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { status: "INVITED" },
    });

    const refused = await request(app)
      .post("/api/v1/auth/mfa/challenge/confirm")
      .set(authHeader(mfaToken))
      .send({ code: await mfaCodeFor(owner.userId, begun.body.data.secret as string) })
      .expect(403);

    // "This account cannot sign in" is true and useless. By here the caller
    // has proved a password and a second factor, so they are the account
    // holder; naming the cause costs nothing and is the whole difference
    // between a message and a dead end.
    expect(refused.body.error.message).toMatch(/invitation/i);
    expect(refused.body.error.message).not.toBe("This account cannot sign in");
  });
});
