import request from "supertest";
import bcrypt from "bcrypt";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Stubbed before the app is imported: a real ID token can only come from
// Google's consent screen, so the token check is replaced while everything
// after it — OTP issue, delivery, verification, session — runs for real.
const googleUser = {
  googleId: "google-subject-1",
  email: "devon-google@zoiko.test",
  name: "Devon Google",
  emailVerified: true,
};
vi.mock("../src/modules/auth/google-auth.js", () => ({
  verifyGoogleToken: vi.fn(async () => googleUser),
}));

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { registerUser } = await import("./helpers.js");

const app = createApp();
const TEST_CODE = "654321";

/** The issued code is bcrypt-hashed and unreadable, so plant a known one. */
async function plantCode(email: string): Promise<void> {
  const user = await prisma.appUser.findUnique({ where: { email } });
  await prisma.emailOtp.updateMany({
    where: { userId: user!.id, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash: await bcrypt.hash(TEST_CODE, 10) },
  });
}

describe("Google sign-in asks for a code before opening a session", () => {
  beforeEach(async () => {
    // A Google sign-in only continues for an address that already exists.
    await registerUser(app, { email: googleUser.email });
  });

  it("returns OTP_REQUIRED rather than a session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);

    expect(res.body.data.state).toBe("OTP_REQUIRED");
    expect(res.body.data.sentTo).toBe(googleUser.email);
    expect(res.body.data.pendingToken).toBeTruthy();
    // The whole point: no credentials are handed out at this step.
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();
  });

  it("issues a code that is stored hashed, never in the clear", async () => {
    await request(app).post("/api/v1/auth/google").send({ idToken: "stubbed" }).expect(200);

    const user = await prisma.appUser.findUnique({ where: { email: googleUser.email } });
    const otp = await prisma.emailOtp.findFirst({
      where: { userId: user!.id, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    expect(otp).not.toBeNull();
    expect(otp!.codeHash).toMatch(/^\$2[aby]\$/);
    expect(otp!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("exchanges a correct code for a real session", async () => {
    const start = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);
    await plantCode(googleUser.email);

    const done = await request(app)
      .post("/api/v1/auth/google/verify-otp")
      .send({ pendingToken: start.body.data.pendingToken, code: TEST_CODE })
      .expect(200);

    expect(done.body.data.state).toBe("SIGNED_IN");
    expect(done.body.data.accessToken).toBeTruthy();
    expect(done.body.data.refreshToken).toBeTruthy();
    expect(done.body.data.membership.role).toBeTruthy();
  });

  it("refuses a wrong code and does not open a session", async () => {
    const start = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);
    await plantCode(googleUser.email);

    const res = await request(app)
      .post("/api/v1/auth/google/verify-otp")
      .send({ pendingToken: start.body.data.pendingToken, code: "000000" })
      .expect(400);
    expect(res.body.error.code).toMatch(/OTP/);
  });

  it("consumes the code, so replaying it fails", async () => {
    const start = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);
    await plantCode(googleUser.email);
    const token = start.body.data.pendingToken;

    await request(app)
      .post("/api/v1/auth/google/verify-otp")
      .send({ pendingToken: token, code: TEST_CODE })
      .expect(200);

    // A one-time code that still works the second time is not one-time.
    await request(app)
      .post("/api/v1/auth/google/verify-otp")
      .send({ pendingToken: token, code: TEST_CODE })
      .expect(400);
  });

  it("rejects a pending token that was not issued by us", async () => {
    await request(app)
      .post("/api/v1/auth/google/verify-otp")
      .send({ pendingToken: "a".repeat(40), code: TEST_CODE })
      .expect(401);
  });

  it("refuses to re-send inside the cooldown window", async () => {
    const start = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);

    // A code was issued moments ago. Allowing an immediate re-send would make
    // this a way to spray mail at any address that owns an account.
    const res = await request(app)
      .post("/api/v1/auth/google/resend-otp")
      .send({ pendingToken: start.body.data.pendingToken })
      .expect(429);
    expect(res.body.error.code).toBe("OTP_COOLDOWN");
  });

  it("re-sends once the cooldown has passed, for an already-verified address", async () => {
    const start = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);

    // Backdate the issued code past the cooldown. This is the case that the
    // registration resend refuses outright: every established account has a
    // verified email, so reusing that path made re-sending impossible.
    const user = await prisma.appUser.findUnique({ where: { email: googleUser.email } });
    expect(user!.emailVerifiedAt).not.toBeNull();
    await prisma.emailOtp.updateMany({
      where: { userId: user!.id },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });

    await request(app)
      .post("/api/v1/auth/google/resend-otp")
      .send({ pendingToken: start.body.data.pendingToken })
      .expect(200);
  });
});
