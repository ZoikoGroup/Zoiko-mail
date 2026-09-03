import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Stubbed before the app is imported: a real ID token can only come from
// Google's consent screen, so the token check is replaced while the rest of
// the flow — identity lookup, linking, account creation, session — runs real.
const googleProfile = {
  providerUserId: "google-subject-1",
  email: "devon-google@zoiko.test",
  displayName: "Devon Google",
  avatarUrl: null,
};
vi.mock("../src/modules/auth/google.verifier.js", () => ({
  verifyGoogleIdToken: vi.fn(async () => googleProfile),
}));

const { createApp } = await import("../src/app.js");
const { prisma } = await import("../src/config/prisma.js");
const { registerUser } = await import("./helpers.js");

const app = createApp();

describe("Google sign-in opens a session directly, no code needed", () => {
  beforeEach(async () => {
    await registerUser(app, { email: googleProfile.email });
  });

  it("signs an existing account in directly with a session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);

    expect(res.body.data.state).toBe("SIGNED_IN");
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.membership.role).toBeTruthy();
  });

  it("links a Google identity on first sign-in and remembers it on the next", async () => {
    await request(app).post("/api/v1/auth/google").send({ idToken: "stubbed" }).expect(200);

    const user = await prisma.appUser.findUnique({ where: { email: googleProfile.email } });
    const identity = await prisma.userIdentity.findFirst({
      where: { userId: user!.id, provider: "GOOGLE" },
    });
    expect(identity).not.toBeNull();
    expect(identity!.providerUserId).toBe(googleProfile.providerUserId);

    const again = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);
    expect(again.body.data.state).toBe("SIGNED_IN");
    expect(again.body.data.accessToken).toBeTruthy();
  });

  it("never opens an OTP step", async () => {
    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);
    expect(res.body.data.state).not.toBe("OTP_REQUIRED");
  });

  it("registers a brand-new Google-only account directly", async () => {
    const email = "fresh-google@zoiko.test";
    const { verifyGoogleIdToken } = await import("../src/modules/auth/google.verifier.js");
    vi.mocked(verifyGoogleIdToken).mockResolvedValueOnce({
      providerUserId: "google-subject-2",
      email,
      displayName: "Fresh Google",
      avatarUrl: null,
    });

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ idToken: "stubbed" })
      .expect(200);

    const created = await prisma.appUser.findUnique({ where: { email } });
    expect(created).not.toBeNull();
    const identity = await prisma.userIdentity.findFirst({
      where: { userId: created!.id, provider: "GOOGLE" },
    });
    expect(identity!.providerUserId).toBe("google-subject-2");

    // A fresh account has no workspace yet, so it lands in NO_WORKSPACE —
    // still a working sign-in, with no code and no OTP_REQUIRED state.
    expect(res.body.data.state).toBe("NO_WORKSPACE");
  });
});
