import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import {
  authHeader,
  loginUser,
  registerUser,
  stepUpHeader,
  type RegisteredUser,
} from "./helpers.js";

const app = createApp();

/**
 * Clearing a member's authenticator — RBAC §2 "people.mfa.reset".
 *
 * The capability was in the matrix from the start and no endpoint
 * implemented it, so the only way to recover a locked-out Owner or Admin was
 * to edit the database. That is the gap these tests close.
 *
 * The distinction they are mostly about: this does not turn MFA off. It
 * removes the enrolled secret so the next sign-in has to enrol a new one.
 * Security §11 forbids support staff quietly bypassing MFA, and a reset that
 * left the account reachable without a factor would be exactly that bypass
 * wearing an administrative name.
 */

async function member(owner: RegisteredUser, email: string, role: "ADMIN" | "MEMBER" | "OWNER") {
  const user = await registerUser(app, { email });
  const created = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role })
    .expect(201);
  return { user, membershipId: created.body.data.id as string };
}

const reset = (token: string, membershipId: string, stepUp?: Record<string, string>) => {
  const req = request(app)
    .post(`/api/v1/membership/members/${membershipId}/mfa/reset`)
    .set(authHeader(token));
  return stepUp ? req.set(stepUp) : req;
};

describe("an owner can clear a locked-out member's authenticator", () => {
  it("removes the secret and the recovery codes, and ends their sessions", async () => {
    const owner = await registerUser(app, { email: `mr-owner-${Date.now()}@zoiko.test` });
    const target = await member(owner, `mr-admin-${Date.now()}@zoiko.test`, "ADMIN");

    // The member signs in and enrols, the way a real one would — so the
    // test is resetting something that exists rather than asserting against
    // an account that never had a factor.
    const login = await loginUser(app, target.user.email, target.user.password, owner.tenantId);
    expect(login.accessToken).toBeTruthy();

    const before = await prisma.appUser.findUniqueOrThrow({
      where: { id: target.user.userId },
      select: { mfaSecret: true, mfaEnrolledAt: true },
    });
    expect(before.mfaEnrolledAt).not.toBeNull();
    expect(before.mfaSecret).not.toBeNull();

    const res = await reset(
      owner.accessToken,
      target.membershipId,
      await stepUpHeader(app, owner.accessToken)
    ).expect(200);

    expect(res.body.data.userId).toBe(target.user.userId);
    expect(res.body.data.message).toMatch(/new authenticator/i);

    const after = await prisma.appUser.findUniqueOrThrow({
      where: { id: target.user.userId },
      select: { mfaSecret: true, mfaEnrolledAt: true, mfaLastUsedStep: true },
    });
    expect(after.mfaSecret).toBeNull();
    expect(after.mfaEnrolledAt).toBeNull();
    expect(after.mfaLastUsedStep).toBeNull();

    expect(await prisma.mfaRecoveryCode.count({ where: { userId: target.user.userId } })).toBe(0);

    // The window between losing a device and enrolling a new one must not be
    // a window in which the old session keeps working without a factor.
    expect(
      await prisma.refreshToken.count({
        where: { tenantId: owner.tenantId, userId: target.user.userId },
      })
    ).toBe(0);
  });

  it("forces re-enrolment rather than turning MFA off", async () => {
    const owner = await registerUser(app, { email: `mr-enrol-o-${Date.now()}@zoiko.test` });
    const target = await member(owner, `mr-enrol-a-${Date.now()}@zoiko.test`, "ADMIN");
    await loginUser(app, target.user.email, target.user.password, owner.tenantId);

    await reset(
      owner.accessToken,
      target.membershipId,
      await stepUpHeader(app, owner.accessToken)
    ).expect(200);

    // The point of the whole feature. An ADMIN is a role AC-002 covers, so
    // the next sign-in has to enrol before it reaches a session — if this
    // returned SIGNED_IN the reset would be a bypass, not a recovery.
    const next = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: target.user.email,
        password: target.user.password,
        tenantId: owner.tenantId,
      })
      .expect(200);

    expect(next.body.data.state).toBe("MFA_ENROLLMENT_REQUIRED");
  });

  it("records who did it, to whom, and what it means", async () => {
    const owner = await registerUser(app, { email: `mr-audit-o-${Date.now()}@zoiko.test` });
    const target = await member(owner, `mr-audit-a-${Date.now()}@zoiko.test`, "ADMIN");
    await loginUser(app, target.user.email, target.user.password, owner.tenantId);

    await reset(
      owner.accessToken,
      target.membershipId,
      await stepUpHeader(app, owner.accessToken)
    ).expect(200);

    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MFA_RESET_BY_ADMIN" },
      orderBy: { createdAt: "desc" },
    });

    expect(event).not.toBeNull();
    expect(event?.actorUserId).toBe(owner.userId);
    const meta = event?.metadata as Record<string, unknown>;
    expect(meta.userId).toBe(target.user.userId);
    expect(meta.outcome).toBe("RE_ENROLMENT_REQUIRED");
    expect(meta.sessionsRevoked).toBe(true);
  });
});

describe("who may not do it", () => {
  it("refuses without step-up, because §5 lists this among the high-risk actions", async () => {
    const owner = await registerUser(app, { email: `mr-nostep-o-${Date.now()}@zoiko.test` });
    const target = await member(owner, `mr-nostep-a-${Date.now()}@zoiko.test`, "ADMIN");
    await loginUser(app, target.user.email, target.user.password, owner.tenantId);

    const res = await reset(owner.accessToken, target.membershipId).expect(403);
    expect(res.body.error.details?.requiresStepUp ?? res.body.error.message).toBeTruthy();

    // And the factor is still there — a refused request must not half-run.
    const after = await prisma.appUser.findUniqueOrThrow({
      where: { id: target.user.userId },
      select: { mfaEnrolledAt: true },
    });
    expect(after.mfaEnrolledAt).not.toBeNull();
  });

  it("refuses an Admin — the capability is in no role's row but Owner's", async () => {
    const owner = await registerUser(app, { email: `mr-adm-o-${Date.now()}@zoiko.test` });
    const admin = await member(owner, `mr-adm-a-${Date.now()}@zoiko.test`, "ADMIN");
    const victim = await member(owner, `mr-adm-v-${Date.now()}@zoiko.test`, "MEMBER");

    const adminLogin = await loginUser(app, admin.user.email, admin.user.password, owner.tenantId);
    await loginUser(app, victim.user.email, victim.user.password, owner.tenantId);

    await reset(
      adminLogin.accessToken,
      victim.membershipId,
      await stepUpHeader(app, adminLogin.accessToken, admin.user.password)
    ).expect(403);
  });

  it("refuses resetting your own — that is the self-service path", async () => {
    const owner = await registerUser(app, { email: `mr-self-${Date.now()}@zoiko.test` });
    const ownMembership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: owner.tenantId, userId: owner.userId },
      select: { id: true },
    });

    // Self-service asks for a code from the device you still have. Reaching
    // it through the administrative route would let a stolen session
    // re-enrol itself with no code at all.
    const res = await reset(
      owner.accessToken,
      ownMembership.id,
      await stepUpHeader(app, owner.accessToken)
    ).expect(409);
    expect(res.body.error.details?.reason).toBe("SELF_RESET_NOT_ADMINISTRATIVE");
  });

  it("refuses a member who has nothing enrolled", async () => {
    const owner = await registerUser(app, { email: `mr-none-o-${Date.now()}@zoiko.test` });
    const target = await member(owner, `mr-none-m-${Date.now()}@zoiko.test`, "MEMBER");

    // registerUser enrols during registration, so the fixture has to clear
    // the factor to reach the state this guard is about — an account with
    // nothing to reset. Answering 200 here would report a recovery that did
    // not happen and leave a misleading row in the log.
    await prisma.appUser.update({
      where: { id: target.user.userId },
      data: { mfaSecret: null, mfaEnrolledAt: null },
    });
    const res = await reset(
      owner.accessToken,
      target.membershipId,
      await stepUpHeader(app, owner.accessToken)
    ).expect(409);
    expect(res.body.error.details?.reason).toBe("MFA_NOT_ENROLLED");
  });

  it("cannot reach a membership in another workspace", async () => {
    const owner = await registerUser(app, { email: `mr-iso-a-${Date.now()}@zoiko.test` });
    const other = await registerUser(app, { email: `mr-iso-b-${Date.now()}@zoiko.test` });
    const theirs = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: other.tenantId, userId: other.userId },
      select: { id: true },
    });

    await reset(
      owner.accessToken,
      theirs.id,
      await stepUpHeader(app, owner.accessToken)
    ).expect(404);
  });
});
