import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";
import { microsoftConnector } from "../src/modules/connector/m365/m365.connector.js";

const app = createApp();

// Mock the OAuth token endpoint; the Graph subscription is deferred because
// MICROSOFT_NOTIFICATION_URL stays unset in this test file.
function idToken(claims: Record<string, string | number>) {
  return jwt.sign(claims, "test-msal-id-token-secret", { expiresIn: "1h" });
}

function installTokenMock() {
  return vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/oauth2/v2.0/token")) {
      return new Response(
        JSON.stringify({
          access_token: "ms-access-token",
          refresh_token: "ms-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          id_token: idToken({
            oid: "ms-test-user-1",
            mail: "owner@zoiko.onmicrosoft.com",
            upn: "owner@zoiko.onmicrosoft.com",
            name: "Test Owner",
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`Unexpected fetch in microsoft test: ${url}`);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Microsoft 365 connector OAuth (ZM-BE-006)", () => {
  it("requires auth for the auth-url endpoint", async () => {
    await request(app).get("/api/v1/connectors/auth/microsoft").expect(401);
  });

  it("returns an MSAL auth URL for an authenticated member", async () => {
    const owner = await registerUser(app, { email: `ms-auth-${Date.now()}@zoiko.test` });
    const res = await request(app)
      .get("/api/v1/connectors/auth/microsoft")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(res.body.data.url).toContain("login.microsoftonline.com");
  });

  it("exchanges the callback code and creates a connected account", async () => {
    installTokenMock();
    const owner = await registerUser(app, { email: `ms-callback-${Date.now()}@zoiko.test` });

    const state = jwt.sign(
      {
        tenantId: owner.tenantId,
        membershipId: owner.membershipId,
        userId: owner.userId,
      },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "10m" }
    );

    const res = await request(app)
      .get("/api/v1/connectors/callback/microsoft")
      .query({ code: "auth-code-123", state })
      .expect(302);

    expect(res.headers.location).toContain("connected=true&provider=MICROSOFT_365");

    const account = await prisma.connectedAccount.findUniqueOrThrow({
      where: { provider_providerAccountId: { provider: "MICROSOFT_365", providerAccountId: "ms-test-user-1" } },
    });
    expect(account.email).toBe("owner@zoiko.onmicrosoft.com");
    expect(account.status).toBe("ACTIVE");
    expect(account.tokenSecretRef).toContain("microsoft_365/ms-test-user-1");

    // Subscriptions are registered through the Graph API when the notification
    // URL is configured; here it is absent, so reserve an explicit sanity check.
    await expect(microsoftConnector.registerSubscription(account.id, owner.tenantId)).rejects.toThrow(/NOTIFICATION_URL/);
  });

  it("rejects callbacks with an invalid state token", async () => {
    const owner = await registerUser(app, { email: `ms-badstate-${Date.now()}@zoiko.test` });
    const res = await request(app)
      .get("/api/v1/connectors/callback/microsoft")
      .query({ code: "x", state: "not-a-jwt" })
      .expect(302);
    expect(res.headers.location).toContain("error=invalid_state");
    expect(owner).toBeTruthy();
  });
});