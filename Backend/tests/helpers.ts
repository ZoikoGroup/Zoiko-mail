import request from "supertest";
import type { Express } from "express";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/common/utils/password.js";

export interface RegisteredUser {
  email: string;
  password: string;
  tenantId: string;
  membershipId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

/** Planted OTP code — see the comment in registerUser. */
const TEST_OTP_CODE = "123456";

/**
 * Drives the real three-step signup funnel and returns an authenticated user.
 *
 *   1. POST /auth/register          → identity only, returns a pendingToken
 *   2. POST /auth/verify-otp        → consumes the emailed code, returns a NEW pendingToken
 *   3. POST /auth/create-workspace  → creates the tenant and issues the session
 *
 * Registration deliberately issues no session (see RegisterResponse in
 * auth.types.ts): no tenant or membership exists yet, so there is nothing to
 * sign into. An earlier version of this helper read `data.tenant` straight off
 * the register response, which is why the suite could not get past step 1.
 */
export async function registerUser(
  app: Express,
  overrides: Partial<{
    email: string;
    password: string;
    displayName: string;
    tenantName: string;
    planCode: string;
  }> = {}
): Promise<RegisteredUser> {
  const payload = {
    email: overrides.email ?? `user-${Date.now()}-${Math.round(process.hrtime()[1] / 1000)}@zoiko.test`,
    password: overrides.password ?? "Password123!",
    displayName: overrides.displayName ?? "Test User",
    tenantName: overrides.tenantName ?? "Test Tenant",
    planCode: overrides.planCode ?? "starter",
  };

  const registered = await request(app)
    .post("/api/v1/auth/register")
    .send({
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName,
    })
    .expect(201);

  const userId: string = registered.body.data.user.id;

  // Issued codes are bcrypt-hashed and cannot be read back, and the mailer is
  // disabled under test. Overwrite the hash with a known code so the suite still
  // exercises the real /verify-otp endpoint rather than bypassing verification.
  await prisma.emailOtp.updateMany({
    where: { userId, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash: await hashPassword(TEST_OTP_CODE) },
  });

  const verified = await request(app)
    .post("/api/v1/auth/verify-otp")
    .set("Authorization", `Bearer ${registered.body.data.pendingToken}`)
    .send({ code: TEST_OTP_CODE })
    .expect(200);

  // verify-otp mints a fresh pending token; the register one must not be reused.
  const session = await request(app)
    .post("/api/v1/auth/create-workspace")
    .set("Authorization", `Bearer ${verified.body.data.pendingToken}`)
    .send({ tenantName: payload.tenantName, planCode: payload.planCode })
    .expect(201);

  return {
    email: payload.email,
    password: payload.password,
    tenantId: session.body.data.tenant.id,
    membershipId: session.body.data.membership.id,
    userId: session.body.data.user.id,
    accessToken: session.body.data.accessToken,
    refreshToken: session.body.data.refreshToken,
  };
}

/**
 * Logs in and returns the AuthState payload. Callers that need tokens should
 * read `.session`, because login resolves to one of several states (workspace
 * selection, suspended, staff console) and only SIGNED_IN carries a session.
 */
export async function loginUser(
  app: Express,
  email: string,
  password: string,
  tenantId?: string
) {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, tenantId })
    .expect(200);

  return response.body.data;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
