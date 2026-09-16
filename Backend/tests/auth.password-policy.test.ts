import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

describe("Password policy", () => {
  it("serves the public policy the register/reset screens render from", async () => {
    const response = await request(app)
      .get("/api/v1/auth/password-policy")
      .expect(200);

    const policy = response.body.data;
    expect(policy.minLength).toBe(8);
    expect(policy.maxLength).toBe(128);
    expect(policy.minClasses).toBe(3);
    expect(Array.isArray(policy.classes)).toBe(true);
    expect(Array.isArray(policy.forbidden)).toBe(true);
  });

  it("rejects a forbidden password at registration", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "forbidden-pw@zoiko.test",
        password: "Password123",
        displayName: "Forbidden User",
      })
      .expect(400);
  });

  it("rejects a password drawn from only one character class", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "mono-class@zoiko.test",
        password: "abcdefghij",
        displayName: "Mono User",
      })
      .expect(400);
  });

  it("rejects a password containing the account email", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "reusedlogin@zoiko.test",
        password: "Reusedlogin123!",
        displayName: "Reuse User",
      })
      .expect(400);
  });

  it("rejects a repeated-character password", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .send({
        email: "repeats@zoiko.test",
        password: "Aa1111111111!",
        displayName: "Repeat User",
      })
      .expect(400);
  });

  it("rejects a policy-violating new password on change", async () => {
    const user = await registerUser(app, { email: "change-policy@zoiko.test" });

    await request(app)
      .post("/api/v1/auth/change-password")
      .set(authHeader(user.accessToken))
      .send({ currentPassword: user.password, newPassword: "alllowercase" })
      .expect(400);

    // A compliant new password still works, so the policy is not rejecting everything.
    await request(app)
      .post("/api/v1/auth/change-password")
      .set(authHeader(user.accessToken))
      .send({ currentPassword: user.password, newPassword: "Compliant123!" })
      .expect(200);
  });
});