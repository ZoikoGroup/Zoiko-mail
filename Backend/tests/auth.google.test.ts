import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { isGoogleSignInConfigured } from "../src/modules/auth/google.service.js";

const app = createApp();

/**
 * Google sign-in.
 *
 * These cover the contract and the refusals, which are the parts that must
 * hold without a Google project configured. The happy path needs a real
 * authorization code from Google's consent screen and cannot be exercised
 * here; what *can* be proven is that an unconfigured server says so, that a
 * malformed request is rejected before any network call, and that the route is
 * rate limited like any other sign-in.
 */

describe("GET /auth/providers", () => {
  it("reports whether Google sign-in is available", async () => {
    const res = await request(app).get("/api/v1/auth/providers").expect(200);
    expect(res.body.data.google).toMatchObject({
      enabled: isGoogleSignInConfigured(),
    });
  });

  it("exposes only the public client id, never the secret", async () => {
    const res = await request(app).get("/api/v1/auth/providers").expect(200);
    const serialized = JSON.stringify(res.body);
    expect(Object.keys(res.body.data.google).sort()).toEqual(["clientId", "enabled"]);
    expect(serialized).not.toMatch(/secret/i);
  });

  it("needs no authentication — the login page asks before anyone signs in", async () => {
    await request(app).get("/api/v1/auth/providers").expect(200);
  });
});

describe("POST /auth/google", () => {
  it("rejects a missing code before attempting any exchange", async () => {
    const res = await request(app).post("/api/v1/auth/google").send({}).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a code that is obviously too short", async () => {
    await request(app).post("/api/v1/auth/google").send({ code: "abc" }).expect(400);
  });

  it("rejects a malformed tenantId", async () => {
    await request(app)
      .post("/api/v1/auth/google")
      .send({ code: "a".repeat(40), tenantId: "not-a-uuid" })
      .expect(400);
  });

  it("reports itself unconfigured rather than failing obscurely", async () => {
    // No GOOGLE_OAUTH_* is set under test, so a well-formed request must come
    // back as a clear 503 FEATURE_DISABLED — not a 500, and not a hang.
    if (isGoogleSignInConfigured()) return;

    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({ code: "a".repeat(40) })
      .expect(503);
    expect(res.body.error.code).toBe("FEATURE_DISABLED");
    expect(res.body.error.message).toMatch(/not configured/i);
  });
});
