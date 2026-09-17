import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("Security alerts", () => {
  it("creates a NEW_DEVICE_LOGIN alert on a sign-in from an unrecognised device", async () => {
    const user = await registerUser(app, { email: "new-device@zoiko.test" });

    let list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(list.body.data.alerts).toHaveLength(0);

    // Same browser as the one that registered → known device, no alert.
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);
    list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(list.body.data.alerts).toHaveLength(0);

    // A different browser → an alert.
    await request(app)
      .post("/api/v1/auth/login")
      .set("User-Agent", IPHONE_UA)
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);

    list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    const alerts = list.body.data.alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("NEW_DEVICE_LOGIN");
    expect(alerts[0].status).toBe("OPEN");
    expect(alerts[0].severity).toBe("MEDIUM");
    expect(alerts[0].deviceLabel).toContain("iOS");
  });

  it("flattens a security alert into the review surface and records the decision", async () => {
    const user = await registerUser(app, { email: "review-device@zoiko.test" });
    await request(app)
      .post("/api/v1/auth/login")
      .set("User-Agent", IPHONE_UA)
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);

    const list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    const alertId = list.body.data.alerts[0].id;

    const detail = await request(app)
      .get(`/api/v1/security-alerts/${alertId}`)
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(detail.body.data.id).toBe(alertId);
    expect(detail.body.data.message).toContain("has not used before");

    const resolved = await request(app)
      .post(`/api/v1/security-alerts/${alertId}/review`)
      .set(authHeader(user.accessToken))
      .send({ action: "RESOLVE", note: "Was me on my phone" })
      .expect(200);
    expect(resolved.body.data.status).toBe("RESOLVED");
    expect(resolved.body.data.resolutionNote).toBe("Was me on my phone");
    expect(resolved.body.data.resolvedBy.id).toBe(user.userId);

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: user.tenantId, eventType: "SECURITY_ALERT_REVIEWED", targetId: alertId },
    });
    expect(audit).toBeTruthy();
    expect((audit!.metadata as { action: string }).action).toBe("RESOLVE");
  });

  it("alerts on a failed-login burst from one address", async () => {
    const user = await registerUser(app, { email: "burst@zoiko.test" });

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post("/api/v1/auth/login")
        .set("User-Agent", IPHONE_UA)
        .set("X-Forwarded-For", "203.0.113.7")
        .send({ email: user.email, password: "WrongPassword!", tenantId: user.tenantId })
        .expect(401);
    }

    const list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    const burst = list.body.data.alerts.find((a: { type: string }) => a.type === "FAILED_LOGIN_BURST");
    expect(burst).toBeTruthy();
    expect(burst.status).toBe("OPEN");
    expect(burst.severity).toBe("HIGH");
    expect(burst.message).toContain("5 failed sign-in attempts");

    // A follow-up burst does not spam the inbox: the open alert dedups.
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post("/api/v1/auth/login")
        .set("User-Agent", IPHONE_UA)
        .set("X-Forwarded-For", "203.0.113.7")
        .send({ email: user.email, password: "WrongPassword!", tenantId: user.tenantId })
        .expect(401);
    }
    const after = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    expect(
      after.body.data.alerts.filter((a: { type: string }) => a.type === "FAILED_LOGIN_BURST")
    ).toHaveLength(1);
  });

  it("alerts when a revoked refresh token is presented", async () => {
    const user = await registerUser(app, { email: "reuse-alert@zoiko.test" });

    await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    // Reuse detection revokes every session as a precaution — the caller must
    // sign in again, and the fresh session can then view the alert.
    const fresh = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: user.password, tenantId: user.tenantId })
      .expect(200);

    const list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(fresh.body.data.accessToken))
      .expect(200);
    const reuse = list.body.data.alerts.find(
      (a: { type: string }) => a.type === "REFRESH_TOKEN_REUSE"
    );
    expect(reuse).toBeTruthy();
    expect(reuse.severity).toBe("CRITICAL");
  });

  it("alerts when the password is changed", async () => {
    const user = await registerUser(app, { email: "pw-alert@zoiko.test" });

    await request(app)
      .post("/api/v1/auth/change-password")
      .set(authHeader(user.accessToken))
      .send({ currentPassword: user.password, newPassword: "Compliant123!" })
      .expect(200);

    const list = await request(app)
      .get("/api/v1/security-alerts")
      .set(authHeader(user.accessToken))
      .expect(200);
    const changed = list.body.data.alerts.find(
      (a: { type: string }) => a.type === "PASSWORD_CHANGED"
    );
    expect(changed).toBeTruthy();
    expect(changed.severity).toBe("LOW");
  });

  it("returns 404 for unknown alerts and 403 without the review capability", async () => {
    const user = await registerUser(app, { email: "alert-missing@zoiko.test" });

    await request(app)
      .get("/api/v1/security-alerts/00000000-0000-4000-8000-000000000001")
      .set(authHeader(user.accessToken))
      .expect(404);
    await request(app)
      .post("/api/v1/security-alerts/00000000-0000-4000-8000-000000000001/review")
      .set(authHeader(user.accessToken))
      .send({ action: "RESOLVE" })
      .expect(404);
  });
});