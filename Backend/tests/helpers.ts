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
  }> = {}
): Promise<RegisteredUser> {
  const payload = {
    email: overrides.email ?? `user-${Date.now()}@zoiko.test`,
    password: overrides.password ?? "Password123!",
    displayName: overrides.displayName ?? "Test User",
    tenantName: overrides.tenantName ?? "Test Tenant",
    planCode: overrides.planCode ?? "starter",
  };

  const response = await request(app)
    .post("/api/v1/auth/register")
    .send(payload)
    .expect(201);

  return {
    email: payload.email,
    password: payload.password,
    tenantId: response.body.data.tenant.id,
    membershipId: response.body.data.membership.id,
    userId: response.body.data.user.id,
    accessToken: response.body.data.tokens.accessToken,
    refreshToken: response.body.data.tokens.refreshToken,
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

  return response.body.data;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
