import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma.js";
import { totp } from "../src/modules/auth/totp.js";
import { __mfaInternals } from "../src/modules/auth/mfa.service.js";

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
  /**
   * The TOTP secret this fixture enrolled with.
   *
   * Registration creates an Owner, and AC-002 requires a second factor before
   * an Owner gets a session — so every fixture now enrols during setup and
   * keeps the secret, which is what lets a later sign-in produce a valid code.
   */
  mfaSecret: string | null;
}

/**
 * A code that will be accepted right now.
 *
 * The spent-step check (RFC 6238 §5.2) means one code cannot be used twice,
 * and the suite signs the same fixtures in repeatedly inside a single
 * thirty-second window — so the spent marker is cleared first. That protection
 * is asserted directly in tests/mfa.test.ts, which does not use this helper.
 */
export async function mfaCodeFor(userId: string, secret?: string | null): Promise<string> {
  let base32 = secret ?? null;
  if (!base32) {
    const user = await prisma.appUser.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaSecret: true },
    });
    if (!user.mfaSecret) throw new Error("That account has no enrolled authenticator");
    base32 = __mfaInternals.decryptSecret(user.mfaSecret);
  }
  await prisma.appUser.update({ where: { id: userId }, data: { mfaLastUsedStep: null } });
  return totp(base32);
}

/**
 * Carry a sign-in through the MFA gate — AC-002.
 *
 * Handles both states an Owner, Admin or Support sign-in can land in:
 * enrolling when the account has no authenticator, and answering the
 * challenge when it does.
 */
export async function completeMfa(
  app: Express,
  state: { state: string; mfaToken?: string; user?: { id: string } },
  secret?: string | null
): Promise<{
  /** The state the sign-in reached: SIGNED_IN, or STAFF_CONSOLE for staff. */
  auth: Record<string, any>;
  session: Record<string, any>;
  mfaSecret: string | null;
}> {
  const token = state.mfaToken;
  if (!token) throw new Error(`No challenge token on state ${state.state}`);

  if (state.state === "MFA_ENROLLMENT_REQUIRED") {
    const offer = await request(app)
      .post("/api/v1/auth/mfa/challenge/enroll")
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);
    const enrolled = offer.body.data.secret as string;
    const confirmed = await request(app)
      .post("/api/v1/auth/mfa/challenge/confirm")
      .set({ Authorization: `Bearer ${token}` })
      .send({ code: totp(enrolled) })
      .expect(200);
    const auth = confirmed.body.data.auth;
    return { auth, session: auth.session ?? auth, mfaSecret: enrolled };
  }

  const userId = state.user?.id;
  if (!userId) throw new Error("Challenge state carried no user");
  const verified = await request(app)
    .post("/api/v1/auth/mfa/challenge/verify")
    .set({ Authorization: `Bearer ${token}` })
    .send({ code: await mfaCodeFor(userId, secret) })
    .expect(200);
  const auth = verified.body.data;
  return { auth, session: auth.session ?? auth, mfaSecret: secret ?? null };
}

/**
 * Carry an auth response through the MFA gate, response-shaped.
 *
 * AC-002 stops a privileged sign-in at a challenge, so a test that cares about
 * what happens *after* sign-in has to answer it first. The result is shaped
 * like the original response — state at the top, session both nested and
 * flattened — so the assertions around the call site keep reading the way they
 * did before the control existed.
 */
export async function throughMfa(
  app: Express,
  response: { body: { data: any } },
  secret?: string | null
): Promise<{ body: { data: any } }> {
  const data = response.body.data;
  if (data?.state !== "MFA_REQUIRED" && data?.state !== "MFA_ENROLLMENT_REQUIRED") {
    return response;
  }
  const completed = await completeMfa(app, data, secret);
  return { body: { data: { ...completed.auth, ...completed.session } } };
}

/**
 * Sign a platform-staff account in and return its console token.
 *
 * AC-002 names Support actors alongside Owners and Admins, and a staff
 * console reaches across every workspace — so a staff sign-in goes through the
 * same challenge, and this carries it.
 */
export async function platformSignIn(
  app: Express,
  email: string,
  password: string,
  mfaSecret?: string | null
): Promise<string> {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password })
    .expect(200);
  const data = response.body.data;
  const auth =
    data.state === "MFA_REQUIRED" || data.state === "MFA_ENROLLMENT_REQUIRED"
      ? (await completeMfa(app, data, mfaSecret)).auth
      : data;
  if (auth.state !== "STAFF_CONSOLE") {
    throw new Error(`Expected a staff console session, got ${auth.state}`);
  }
  return auth.platformToken as string;
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

  let mfaSecret: string | null = null;

  if (shouldCreate) {
    const workspaceResponse = await request(app)
      .post("/api/v1/auth/create-workspace")
      .set({ Authorization: `Bearer ${pendingToken}` })
      .send({ tenantName: payload.tenantName, planCode: payload.planCode })
      .expect(201);
    let data = workspaceResponse.body.data;

    // Creating a workspace makes this account an Owner, and AC-002 requires a
    // second factor before an Owner is handed a session. So the fixture does
    // what a real Owner does: enrol, confirm, and sign in with the same code.
    if (data.state === "MFA_ENROLLMENT_REQUIRED") {
      const completed = await completeMfa(app, data);
      mfaSecret = completed.mfaSecret;
      data = completed.session;
    } else {
      data = data.session ?? data;
    }

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
    mfaSecret,
  };
}

export async function loginUser(
  app: Express,
  email: string,
  password: string,
  tenantId?: string,
  mfaSecret?: string | null
) {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, tenantId })
    .expect(200);

  const data = response.body.data;
  // A privileged sign-in stops at the MFA gate; carry it through so callers
  // get the session they asked for (AC-002).
  if (data?.state === "MFA_REQUIRED" || data?.state === "MFA_ENROLLMENT_REQUIRED") {
    const completed = await completeMfa(app, data, mfaSecret);
    // The state reported back is the one the sign-in reached, not the one it
    // paused at: callers want to know they are signed in, and the gate itself
    // is asserted in tests/mfa.test.ts.
    return {
      ...completed.session,
      session: completed.session,
      state: completed.auth.state ?? "SIGNED_IN",
      platformToken: completed.auth.platformToken,
    };
  }
  if (data?.session) {
    return { ...data.session, ...data };
  }
  return data;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
