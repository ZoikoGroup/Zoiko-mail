import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, completeMfa, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";
import { totp } from "../src/modules/auth/totp.js";
import { __mfaInternals } from "../src/modules/auth/mfa.service.js";

const app = createApp();

/**
 * Multi-factor authentication — AC-002, Security §5.
 *
 * "MFA is enforced for Owners, Admins and Support actors." The product had no
 * second factor at all, and the admin dashboard carried a hardcoded
 * `MFA_SUPPORTED = false` so it would stop reporting a control that did not
 * exist.
 *
 * The rules pinned here are the ones that make it an enforcement rather than
 * an option: a privileged account cannot obtain a session without it, a code
 * cannot be replayed, the factor cannot be removed while the role requires
 * it, and a member is not compelled into it.
 *
 * These tests set their own codes throughout. The suite-wide helpers clear the
 * spent-step marker so that dozens of fixtures can sign in inside one
 * thirty-second window; relying on them here would hide exactly what is under
 * test.
 */

const login = (email: string, password: string, tenantId?: string) =>
  request(app).post("/api/v1/auth/login").send({ email, password, tenantId });

/** The stored secret, as the server holds it. */
async function storedSecret(userId: string): Promise<string> {
  const user = await prisma.appUser.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaSecret: true },
  });
  return __mfaInternals.decryptSecret(user.mfaSecret!);
}

/**
 * A code that will be accepted right now.
 *
 * Registration spends a step confirming its own enrolment, so a code computed
 * immediately afterwards is the one already used. Clearing the marker is the
 * same accommodation the shared helpers make; the replay rule itself is
 * asserted in its own block below.
 */
async function freshCode(userId: string, secret: string): Promise<string> {
  await prisma.appUser.update({ where: { id: userId }, data: { mfaLastUsedStep: null } });
  return totp(secret);
}

/** A member of the owner's workspace, with the role under test. */
async function memberWithRole(
  ownerToken: string,
  role: "ADMIN" | "MEMBER" | "SUPPORT",
  email: string
) {
  const user = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(ownerToken))
    .send({ email, role })
    .expect(201);
  return user;
}

describe("a privileged sign-in cannot skip the second factor", () => {
  it("stops an Owner at a challenge instead of issuing a session", async () => {
    const owner = await registerUser(app, { email: `mfa-owner-${Date.now()}@zoiko.test` });

    const res = await login(owner.email, owner.password, owner.tenantId).expect(200);

    expect(res.body.data.state).toBe("MFA_REQUIRED");
    // No session at all, rather than a session that can only do a little: one
    // rule at one point, instead of a rule every route has to understand.
    expect(res.body.data.session).toBeUndefined();
    expect(res.body.data.mfaToken).toBeTruthy();
  });

  it("issues the session once the code is right", async () => {
    const owner = await registerUser(app, { email: `mfa-ok-${Date.now()}@zoiko.test` });
    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);

    // A fresh window, so the code is not the one registration already spent.
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { mfaLastUsedStep: null },
    });
    const verified = await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(challenge.body.data.mfaToken))
      .send({ code: totp(await storedSecret(owner.userId)) })
      .expect(200);

    expect(verified.body.data.state).toBe("SIGNED_IN");
    expect(verified.body.data.session.accessToken).toBeTruthy();
  });

  it("refuses a wrong code", async () => {
    const owner = await registerUser(app, { email: `mfa-wrong-${Date.now()}@zoiko.test` });
    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);

    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(challenge.body.data.mfaToken))
      .send({ code: "000000" })
      .expect(401);
  });

  it("refuses a challenge token that is really an access token", async () => {
    const owner = await registerUser(app, { email: `mfa-swap-${Date.now()}@zoiko.test` });

    // The tokens share a signing secret, so the type claim is what separates
    // them; without that check an access token would answer its own challenge.
    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(owner.accessToken))
      .send({ code: totp(await storedSecret(owner.userId)) })
      .expect(401);
  });

  it("leaves a member alone", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `mfa-mowner-${suffix}@zoiko.test` });
    const member = await memberWithRole(owner.accessToken, "MEMBER", `mfa-member-${suffix}@zoiko.test`);

    const res = await login(member.email, member.password, owner.tenantId).expect(200);

    // AC-002 names Owners, Admins and Support. Compelling every member into an
    // authenticator would be a different decision than the one made there.
    expect(res.body.data.state).toBe("SIGNED_IN");
  });

  it("stops an Admin, who is named in AC-002", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `mfa-aowner-${suffix}@zoiko.test` });
    const admin = await memberWithRole(owner.accessToken, "ADMIN", `mfa-admin-${suffix}@zoiko.test`);

    const res = await login(admin.email, admin.password, owner.tenantId).expect(200);
    expect(res.body.data.state).toBe("MFA_REQUIRED");
  });

  it("stops a Support actor too", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `mfa-sowner-${suffix}@zoiko.test` });
    const support = await memberWithRole(owner.accessToken, "SUPPORT", `mfa-support-${suffix}@zoiko.test`);

    const res = await login(support.email, support.password, owner.tenantId).expect(200);
    expect(res.body.data.state).toBe("MFA_REQUIRED");
  });

  it("stops platform staff, whose console reaches every workspace", async () => {
    const staff = await registerUser(app, { email: `mfa-staff-${Date.now()}@zoiko.test` });
    await prisma.appUser.update({
      where: { id: staff.userId },
      data: { platformRole: "SUPER_ADMIN" },
    });

    const res = await login(staff.email, staff.password).expect(200);

    expect(res.body.data.state).toBe("MFA_REQUIRED");
    expect(res.body.data.platformToken).toBeUndefined();

    // And the console token only appears once the challenge is answered.
    const completed = await completeMfa(app, res.body.data, staff.mfaSecret);
    expect(completed.auth.state).toBe("STAFF_CONSOLE");
    expect(completed.auth.platformToken).toBeTruthy();
  });
});

describe("enrolment", () => {
  it("is required before a newly privileged account gets a session", async () => {
    const suffix = String(Date.now());
    const owner = await registerUser(app, { email: `mfa-eowner-${suffix}@zoiko.test` });
    const promoted = await memberWithRole(
      owner.accessToken,
      "ADMIN",
      `mfa-promoted-${suffix}@zoiko.test`
    );
    // Strip the enrolment the fixture completed, to model somebody who has
    // never set an authenticator up.
    await prisma.appUser.update({
      where: { id: promoted.userId },
      data: { mfaSecret: null, mfaEnrolledAt: null, mfaLastUsedStep: null },
    });

    const res = await login(promoted.email, promoted.password, owner.tenantId).expect(200);

    expect(res.body.data.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(res.body.data.requiredBecause).toBe("ADMIN");
  });

  it("can be completed from the challenge, which is the only way in", async () => {
    const owner = await registerUser(app, { email: `mfa-fresh-${Date.now()}@zoiko.test` });
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { mfaSecret: null, mfaEnrolledAt: null, mfaLastUsedStep: null },
    });
    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);
    const token = challenge.body.data.mfaToken as string;

    const offer = await request(app)
      .post("/api/v1/auth/mfa/challenge/enroll")
      .set(authHeader(token))
      .expect(201);
    expect(offer.body.data.uri).toContain("otpauth://totp/");

    const confirmed = await request(app)
      .post("/api/v1/auth/mfa/challenge/confirm")
      .set(authHeader(token))
      .send({ code: totp(offer.body.data.secret) })
      .expect(200);

    // The code that proved the authenticator also completes the sign-in,
    // rather than asking for a second code seconds later.
    expect(confirmed.body.data.auth.state).toBe("SIGNED_IN");
    expect(confirmed.body.data.recoveryCodes).toHaveLength(10);
  });

  it("refuses to confirm with the wrong code, and stays unenrolled", async () => {
    const owner = await registerUser(app, { email: `mfa-badconf-${Date.now()}@zoiko.test` });
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { mfaSecret: null, mfaEnrolledAt: null },
    });
    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);
    const token = challenge.body.data.mfaToken as string;
    await request(app).post("/api/v1/auth/mfa/challenge/enroll").set(authHeader(token)).expect(201);

    await request(app)
      .post("/api/v1/auth/mfa/challenge/confirm")
      .set(authHeader(token))
      .send({ code: "000000" })
      .expect(401);

    const user = await prisma.appUser.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(user.mfaEnrolledAt).toBeNull();
  });

  it("will not start a second enrolment over a live one", async () => {
    const owner = await registerUser(app, { email: `mfa-second-${Date.now()}@zoiko.test` });

    // Enrolling again silently would strand whichever device held the old
    // secret, so it has to be removed first.
    const refused = await request(app)
      .post("/api/v1/auth/mfa/enroll")
      .set(authHeader(owner.accessToken))
      .expect(409);
    expect(refused.body.error.details.alreadyEnrolled).toBe(true);
  });

  it("stores the secret encrypted, not in the clear", async () => {
    const owner = await registerUser(app, { email: `mfa-crypt-${Date.now()}@zoiko.test` });

    const row = await prisma.appUser.findUniqueOrThrow({
      where: { id: owner.userId },
      select: { mfaSecret: true },
    });

    // A TOTP secret is not a hash: whoever reads it can mint codes forever.
    expect(row.mfaSecret).not.toBe(owner.mfaSecret);
    expect(row.mfaSecret).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(__mfaInternals.decryptSecret(row.mfaSecret!)).toBe(owner.mfaSecret);
  });
});

describe("a code is spent once", () => {
  it("refuses the same code twice, inside its own window", async () => {
    const owner = await registerUser(app, { email: `mfa-replay-${Date.now()}@zoiko.test` });
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { mfaLastUsedStep: null },
    });
    const code = totp(await storedSecret(owner.userId));

    const first = await login(owner.email, owner.password, owner.tenantId).expect(200);
    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(first.body.data.mfaToken))
      .send({ code })
      .expect(200);

    const second = await login(owner.email, owner.password, owner.tenantId).expect(200);
    const replayed = await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(second.body.data.mfaToken))
      .send({ code })
      .expect(401);

    // RFC 6238 §5.2. Without this, a code observed in transit stays valid for
    // the rest of its ninety-second window.
    expect(replayed.body.error.details.reason).toBe("CODE_ALREADY_USED");
  });
});

describe("recovery codes", () => {
  it("let a locked-out user in, once each", async () => {
    const owner = await registerUser(app, { email: `mfa-rec-${Date.now()}@zoiko.test` });
    // Re-issue a known set: enrolment showed them once and kept only hashes.
    const codes = (
      await request(app)
        .post("/api/v1/auth/mfa/recovery-codes")
        .set(authHeader(owner.accessToken))
        .send({ code: await freshCode(owner.userId, owner.mfaSecret!) })
        .expect(200)
    ).body.data.recoveryCodes as string[];

    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);
    const used = await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(challenge.body.data.mfaToken))
      .send({ code: codes[0] })
      .expect(200);
    expect(used.body.data.state).toBe("SIGNED_IN");

    const again = await login(owner.email, owner.password, owner.tenantId).expect(200);
    // Single-use: a recovery code that still worked would be a password with
    // extra steps.
    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(again.body.data.mfaToken))
      .send({ code: codes[0] })
      .expect(401);
  });

  it("are stored hashed", async () => {
    const owner = await registerUser(app, { email: `mfa-rechash-${Date.now()}@zoiko.test` });
    const codes = (
      await request(app)
        .post("/api/v1/auth/mfa/recovery-codes")
        .set(authHeader(owner.accessToken))
        .send({ code: await freshCode(owner.userId, owner.mfaSecret!) })
        .expect(200)
    ).body.data.recoveryCodes as string[];

    const stored = await prisma.mfaRecoveryCode.findMany({
      where: { userId: owner.userId },
      select: { codeHash: true },
    });
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(codes).not.toContain(row.codeHash);
      expect(row.codeHash.startsWith("$2")).toBe(true);
    }
  });

  it("are replaced as a set, voiding the old ones", async () => {
    const owner = await registerUser(app, { email: `mfa-recnew-${Date.now()}@zoiko.test` });
    const first = (
      await request(app)
        .post("/api/v1/auth/mfa/recovery-codes")
        .set(authHeader(owner.accessToken))
        .send({ code: await freshCode(owner.userId, owner.mfaSecret!) })
        .expect(200)
    ).body.data.recoveryCodes as string[];

    await request(app)
      .post("/api/v1/auth/mfa/recovery-codes")
      .set(authHeader(owner.accessToken))
      .send({ code: first[0] })
      .expect(200);

    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);
    // An old code surviving a regeneration would keep a previous device
    // holder in.
    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(challenge.body.data.mfaToken))
      .send({ code: first[1] })
      .expect(401);
  });
});

describe("what MFA cannot be talked out of", () => {
  it("refuses to be removed while the role requires it", async () => {
    const owner = await registerUser(app, { email: `mfa-keep-${Date.now()}@zoiko.test` });

    const refused = await request(app)
      .post("/api/v1/auth/mfa/disable")
      .set(authHeader(owner.accessToken))
      .send({ code: await freshCode(owner.userId, owner.mfaSecret!) })
      .expect(403);

    // This is the difference between a default and an enforcement.
    expect(refused.body.error.details.reason).toBe("MFA_REQUIRED_FOR_ROLE");
    expect(refused.body.error.details.role).toBe("OWNER");
    expect(
      (await prisma.appUser.findUniqueOrThrow({ where: { id: owner.userId } })).mfaEnrolledAt
    ).not.toBeNull();
  });

  it("locks out an account that keeps guessing", async () => {
    const owner = await registerUser(app, { email: `mfa-brute-${Date.now()}@zoiko.test` });
    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);
    const token = challenge.body.data.mfaToken as string;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post("/api/v1/auth/mfa/challenge/verify")
        .set(authHeader(token))
        .send({ code: "000000" })
        .expect(401);
    }

    // Six digits is a small space and the challenge is reachable with only a
    // password, so guessing has to cost something.
    const locked = await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(token))
      .send({ code: totp(await storedSecret(owner.userId)) })
      .expect(429);
    expect(locked.body.error.details.retryAfterMinutes).toBeGreaterThan(0);
  });
});

describe("the account can see where it stands", () => {
  it("reports enrolment, the reason it is required, and codes left", async () => {
    const owner = await registerUser(app, { email: `mfa-status-${Date.now()}@zoiko.test` });

    const status = await request(app)
      .get("/api/v1/auth/mfa")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(status.body.data.enrolled).toBe(true);
    expect(status.body.data.required).toBe(true);
    expect(status.body.data.requiredBecause).toBe("OWNER");
    expect(status.body.data.remainingRecoveryCodes).toBe(10);
  });
});

describe("the audit trail", () => {
  it("records the challenge, the failure and the success", async () => {
    const owner = await registerUser(app, { email: `mfa-audit-${Date.now()}@zoiko.test` });
    const challenge = await login(owner.email, owner.password, owner.tenantId).expect(200);
    const token = challenge.body.data.mfaToken as string;
    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(token))
      .send({ code: "000000" })
      .expect(401);
    await prisma.appUser.update({
      where: { id: owner.userId },
      data: { mfaLastUsedStep: null },
    });
    await request(app)
      .post("/api/v1/auth/mfa/challenge/verify")
      .set(authHeader(token))
      .send({ code: totp(await storedSecret(owner.userId)) })
      .expect(200);

    const types = (
      await prisma.auditEvent.findMany({
        where: { actorUserId: owner.userId },
        select: { eventType: true },
      })
    ).map((event) => event.eventType);

    // Security §18 lists the MFA challenge in the identity category, and a run
    // of failures against a privileged account is exactly the signal it exists
    // to capture.
    expect(types).toContain("MFA_ENROLLED");
    expect(types).toContain("MFA_CHALLENGE_ISSUED");
    expect(types).toContain("MFA_CHALLENGE_FAILED");
    expect(types).toContain("MFA_CHALLENGE_SUCCEEDED");
  });
});
