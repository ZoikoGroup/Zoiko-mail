import request from "supertest";
import type { Express } from "express";

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
    .send(payload)
    .expect(201);

  const pendingToken = registerResponse.body.data.pendingToken;
  // By default, create a workspace for the newly registered user.
  const shouldCreate = overrides.createWorkspace !== false;
  let tenantId: string | null = null;
  let membershipId: string | null = null;
  let userId: string = registerResponse.body.data.user.id;
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
