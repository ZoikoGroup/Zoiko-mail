import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma.js";

const hashPassword = (value: string) => bcrypt.hash(value, 10);
const TEST_OTP_CODE = "123456";

export interface RegisteredUser {
  email: string;
  password: string;
  tenantId: string;
  membershipId: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(
  app: Express,
  overrides: Partial<{
    email: string;
    password: string;
    displayName: string;
    tenantName: string;
    planCode: string;
    createWorkspace?: boolean; // optional flag, defaults to true
  }> = {}
): Promise<RegisteredUser> {
  const payload = {
    email: overrides.email ?? `user-${Date.now()}@zoiko.test`,
    password: overrides.password ?? "Password123!",
    displayName: overrides.displayName ?? "Test User",
    tenantName: overrides.tenantName ?? "Test Tenant",
    planCode: overrides.planCode ?? "starter",
  };

  // Register the user (pending token flow)
  const registerResponse = await request(app)
    .post("/api/v1/auth/register")
    .send({
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName,
    })
    .expect(201);

  let userId = registerResponse.body.data.user.id;

  // Issued codes are bcrypt-hashed and cannot be read back, and the mailer is
  // disabled under test. Overwrite the hash with a known code so the suite still
  // exercises the real /verify-otp endpoint rather than bypassing verification.
  await prisma.emailOtp.updateMany({
    where: { userId, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash: await hashPassword(TEST_OTP_CODE) },
  });

  const verified = await request(app)
    .post("/api/v1/auth/verify-otp")
    .set("Authorization", `Bearer ${registerResponse.body.data.pendingToken}`)
    .send({ code: TEST_OTP_CODE })
    .expect(200);

  // verify-otp mints a fresh pending token; the register one is now consumed and
  // must not be reused. Exactly one create-workspace call may succeed per
  // registration — a second returns 409, since the user already owns a tenant.
  const pendingToken = verified.body.data.pendingToken;

  // By default, create a workspace for the newly registered user.
  const shouldCreate = overrides.createWorkspace !== false;
  let tenantId: string | null = null;
  let membershipId: string | null = null;
  let accessToken: string | null = null;
  let refreshToken: string | null = null;

  if (shouldCreate) {
    const workspaceResponse = await request(app)
      .post("/api/v1/auth/create-workspace")
      .set({ Authorization: `Bearer ${pendingToken}` })
      .send({ tenantName: payload.tenantName, planCode: payload.planCode })
      .expect(201);
    const data = workspaceResponse.body.data;
    tenantId = data.tenant.id;
    membershipId = data.membership.id;
    userId = data.user.id;
    accessToken = data.accessToken ?? data.tokens?.accessToken;
    refreshToken = data.refreshToken ?? data.tokens?.refreshToken;
  }

  // Also narrows the nullable locals to satisfy RegisteredUser.
  if (!tenantId || !membershipId || !accessToken || !refreshToken) {
    throw new Error("Test user registration did not create a complete workspace session");
  }

  return {
    email: payload.email,
    password: payload.password,
    tenantId,
    membershipId,
    userId,
    accessToken,
    refreshToken,
  };
}

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

  const data = response.body.data;
  if (data?.session) {
    return { ...data.session, ...data };
  }
  return data;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
