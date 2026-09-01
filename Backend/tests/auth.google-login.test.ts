import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// Stubbed before the app is imported: a real ID token can only come from
// Google's consent screen, so the signature check is replaced while everything
// after it — identity linking, account creation, session issue — runs for real.
const profile = {
  providerUserId: "google-subject-1",
  email: "devon-google@zoiko.test",
  displayName: "Devon Google",
  avatarUrl: null as string | null,
};
vi.mock("../src/modules/auth/google.verifier.js", () => ({
  verifyGoogleIdToken: vi.fn(async () => profile),
}));

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { registerUser } = await import("./helpers.js");

const app = createApp();

const signInWithGoogle = () =>
  request(app).post("/api/v1/auth/google").send({ idToken: "stubbed" });

describe("Google sign-in opens a session in one step", () => {
  it("signs an existing verified account straight in, with no code step", async () => {
    const user = await registerUser(app, { email: profile.email });

    const res = await signInWithGoogle().expect(200);

    // The point of the single-step flow: selecting the account *is* the
    // sign-in. Google's ID token is already its signed assertion that it
    // verified the address, so a second emailed code proves nothing new.
    expect(res.body.data.state).toBe("SIGNED_IN");
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.membership.role).toBeTruthy();

    // No code was issued, so nothing was emailed and nothing is owed.
    const otps = await prisma.emailOtp.count({
      where: { userId: user.userId, consumedAt: null },
    });
    expect(otps).toBe(0);
  });

  it("links the Google identity to the existing account rather than duplicating it", async () => {
    await registerUser(app, { email: profile.email });
    await signInWithGoogle().expect(200);

    // One account, not two: matching on a verified email must link, because
    // creating a second user for the same address splits a person's mail.
    const users = await prisma.appUser.findMany({ where: { email: profile.email } });
    expect(users).toHaveLength(1);

    const identity = await prisma.userIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: "GOOGLE",
          providerUserId: profile.providerUserId,
        },
      },
    });
    expect(identity).not.toBeNull();
    expect(identity!.userId).toBe(users[0]!.id);
  });

  it("signs a returning identity back in and keeps its record current", async () => {
    await registerUser(app, { email: profile.email });
    await signInWithGoogle().expect(200);

    const first = await prisma.userIdentity.findUniqueOrThrow({
      where: {
        provider_providerUserId: {
          provider: "GOOGLE",
          providerUserId: profile.providerUserId,
        },
      },
    });

    const again = await signInWithGoogle().expect(200);
    expect(again.body.data.state).toBe("SIGNED_IN");

    const identities = await prisma.userIdentity.findMany({
      where: { providerUserId: profile.providerUserId },
    });
    // The second sign-in takes the identity branch, so it must reuse the row
    // rather than insert another one for the same Google subject.
    expect(identities).toHaveLength(1);
    expect(identities[0]!.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(
      first.lastUsedAt!.getTime()
    );
  });

  it("creates an active, verified, password-less account for a brand-new Google user", async () => {
    const res = await signInWithGoogle().expect(200);

    // No workspace yet, so there is nothing to sign into — but the response
    // carries a pending token so the client can go on to create one.
    expect(res.body.data.state).toBe("NO_WORKSPACE");
    expect(res.body.data.pendingToken).toBeTruthy();

    const created = await prisma.appUser.findUniqueOrThrow({
      where: { email: profile.email },
    });
    expect(created.status).toBe("ACTIVE");
    expect(created.emailVerifiedAt).not.toBeNull();
    // A Google-only account has no password. It must be null rather than an
    // empty or placeholder hash, so no string can ever be presented as one.
    expect(created.passwordHash).toBeNull();
  });

  it("refuses to link an unverified local account, so registering an address cannot capture its owner", async () => {
    // The attack this blocks: register victim@example.com, never verify it,
    // and wait for the real owner's Google sign-in to land in your account.
    await prisma.appUser.create({
      data: {
        email: profile.email,
        passwordHash: "$2b$04$abcdefghijklmnopqrstuvwxyz012345678901234567890123",
        displayName: "Squatter",
        status: "PENDING_VERIFICATION",
        emailVerifiedAt: null,
      },
    });

    const res = await signInWithGoogle().expect(409);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    // Nothing was linked, so the squatted account gained no Google identity.
    const identity = await prisma.userIdentity.findFirst({
      where: { providerUserId: profile.providerUserId },
    });
    expect(identity).toBeNull();
  });

  it("no longer exposes the OTP legs the two-step flow used", async () => {
    // These were removed with the OTP flow. verifyGoogleOtp() accepted any
    // pending token and minted a session from an EMAIL_VERIFICATION code —
    // the same purpose register() issues — so leaving them routed would have
    // left a way to exchange a registration code for a full session.
    await request(app)
      .post("/api/v1/auth/google/verify-otp")
      .send({ pendingToken: "a".repeat(40), code: "654321" })
      .expect(404);

    await request(app)
      .post("/api/v1/auth/google/resend-otp")
      .send({ pendingToken: "a".repeat(40) })
      .expect(404);
  });
});
