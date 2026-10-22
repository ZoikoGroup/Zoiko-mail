import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { env, envSchema } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, mfaCodeFor, registerUser } from "./helpers.js";

const app = createApp();

/**
 * KI-003 — MFA enforcement sits behind FLAG_MFA_ENFORCEMENT_ENABLED.
 *
 * AC-002 says MFA is enforced for Owners, Admins and Support, unconditionally.
 * The code reads it through a flag (env.ts, mfa_enforcement_enabled in
 * common/flags/flags.ts) consulted by AuthService.mfaGate and by
 * MfaService.disable / MfaService.status. tests/setup.ts forces it on, so
 * every other suite tests the "on" side only.
 *
 * This file pins both sides so a change to either is deliberate:
 *  - on: a privileged sign-in is stopped at enrolment or at a challenge;
 *  - off: the gate disappears entirely — an Owner with no authenticator gets
 *    a session from a password alone, an enrolled Owner is not challenged,
 *    the factor can be removed, and status reports it as not required.
 *
 * The "off" behaviour is the known issue, not the requirement. Production
 * must keep the flag true (its schema default), which is asserted last.
 */

const mutableEnv = env as unknown as { FLAG_MFA_ENFORCEMENT_ENABLED: boolean };
let saved: boolean;

beforeEach(() => {
  saved = mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED;
});

afterEach(() => {
  mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = saved;
});

const login = (email: string, password: string, tenantId?: string) =>
  request(app).post("/api/v1/auth/login").send({ email, password, tenantId });

/**
 * An Owner who never enrolled an authenticator. Registered with the flag off
 * so the fixture does not enrol on the way in; the caller then picks the flag
 * value under test.
 */
async function ownerWithoutMfa(prefix: string) {
  mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = false;
  const owner = await registerUser(app, { email: `${prefix}-${Date.now()}@zoiko.test` });
  expect(owner.mfaSecret).toBeNull();
  const user = await prisma.appUser.findUniqueOrThrow({ where: { id: owner.userId } });
  expect(user.mfaEnrolledAt).toBeNull();
  return owner;
}

describe("with FLAG_MFA_ENFORCEMENT_ENABLED=true (the AC-002 behaviour)", () => {
  it("stops an unenrolled Owner at enrolment instead of issuing a session", async () => {
    const owner = await ownerWithoutMfa("mfa-flag-on-owner");
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = true;

    const res = await login(owner.email, owner.password, owner.tenantId).expect(200);

    expect(res.body.data.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(res.body.data.requiredBecause).toBe("OWNER");
    expect(res.body.data.mfaToken).toBeTruthy();
    expect(res.body.data.session).toBeUndefined();
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it("stops an unenrolled Admin at enrolment too", async () => {
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = false;
    const admin = await registerUser(app, {
      email: `mfa-flag-on-admin-${Date.now()}@zoiko.test`,
      creatorRole: "ADMIN",
    });
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = true;

    const res = await login(admin.email, admin.password, admin.tenantId).expect(200);

    expect(res.body.data.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(res.body.data.requiredBecause).toBe("ADMIN");
    expect(res.body.data.session).toBeUndefined();
  });

  it("challenges an enrolled Owner and refuses to remove the factor", async () => {
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = true;
    const owner = await registerUser(app, { email: `mfa-flag-on-enrolled-${Date.now()}@zoiko.test` });

    const res = await login(owner.email, owner.password, owner.tenantId).expect(200);
    expect(res.body.data.state).toBe("MFA_REQUIRED");
    expect(res.body.data.session).toBeUndefined();

    const refused = await request(app)
      .post("/api/v1/auth/mfa/disable")
      .set(authHeader(owner.accessToken))
      .send({ code: await mfaCodeFor(owner.userId, owner.mfaSecret) })
      .expect(403);
    expect(refused.body.error.details.reason).toBe("MFA_REQUIRED_FOR_ROLE");

    const status = await request(app).get("/api/v1/auth/mfa").set(authHeader(owner.accessToken)).expect(200);
    expect(status.body.data.required).toBe(true);
    expect(status.body.data.requiredBecause).toBe("OWNER");
  });
});

describe("with FLAG_MFA_ENFORCEMENT_ENABLED=false (current behaviour, KI-003 — not AC-002)", () => {
  it("signs an unenrolled Owner straight in with a password alone", async () => {
    const owner = await ownerWithoutMfa("mfa-flag-off-owner");

    const res = await login(owner.email, owner.password, owner.tenantId).expect(200);

    // No challenge of any kind: this is the gap AC-002 forbids, and the reason
    // production must run with the flag on.
    expect(res.body.data.state).toBe("SIGNED_IN");
    expect(res.body.data.mfaToken).toBeUndefined();
    const session = res.body.data.session ?? res.body.data;
    expect(session.accessToken).toBeTruthy();
  });

  it("does not challenge an Owner who has enrolled either", async () => {
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = true;
    const owner = await registerUser(app, { email: `mfa-flag-off-enrolled-${Date.now()}@zoiko.test` });
    expect(owner.mfaSecret).toBeTruthy();
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = false;

    const res = await login(owner.email, owner.password, owner.tenantId).expect(200);

    // The flag switches the whole gate off, not just the enrolment mandate:
    // an authenticator the Owner set up is not asked for.
    expect(res.body.data.state).toBe("SIGNED_IN");
    expect(res.body.data.mfaToken).toBeUndefined();
  });

  it("reports MFA as not required and lets an Owner remove it", async () => {
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = true;
    const owner = await registerUser(app, { email: `mfa-flag-off-disable-${Date.now()}@zoiko.test` });
    mutableEnv.FLAG_MFA_ENFORCEMENT_ENABLED = false;

    const status = await request(app).get("/api/v1/auth/mfa").set(authHeader(owner.accessToken)).expect(200);
    expect(status.body.data.enrolled).toBe(true);
    expect(status.body.data.required).toBe(false);
    expect(status.body.data.requiredBecause).toBeNull();

    const disabled = await request(app)
      .post("/api/v1/auth/mfa/disable")
      .set(authHeader(owner.accessToken))
      .send({ code: await mfaCodeFor(owner.userId, owner.mfaSecret) })
      .expect(200);
    expect(disabled.body.data.enrolled).toBe(false);
    const user = await prisma.appUser.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.mfaEnrolledAt).toBeNull();
    expect(user.mfaSecret).toBeNull();
  });
});

describe("the flag's default", () => {
  it("is on when FLAG_MFA_ENFORCEMENT_ENABLED is unset", () => {
    // Parse the shape alone: the full schema also validates secrets and
    // cross-field rules this assertion is not about.
    const shape = (envSchema as unknown as { _def: { schema?: { shape: Record<string, { parse: (v: unknown) => unknown }> } } })
      ._def.schema?.shape ?? (envSchema as unknown as { shape: Record<string, { parse: (v: unknown) => unknown }> }).shape;
    const field = shape.FLAG_MFA_ENFORCEMENT_ENABLED;
    expect(field).toBeDefined();
    expect(field.parse(undefined)).toBe(true);
    expect(field.parse("true")).toBe(true);
    expect(field.parse("false")).toBe(false);
  });

  it("is declared with a true fallback in env.ts", () => {
    // Belt and braces against the schema being restructured: the source line
    // itself must keep the true default.
    const source = readFileSync(resolve(process.cwd(), "src/config/env.ts"), "utf8");
    expect(source).toMatch(/FLAG_MFA_ENFORCEMENT_ENABLED:\s*boolFlag\(\s*["']true["']\s*\)/);
  });
});
