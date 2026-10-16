import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * An address whose account is not active cannot be invited, and the refusal
 * used to say "User account is disabled" for every case. On a deployment with
 * email off that wording hid the commonest cause: somebody started signing up,
 * never received a verification code, and so was never verified. These tests
 * pin that the refusal still happens, and that it tells the inviter what to do.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Signed up and left at the verification step, as on a deployment that cannot email the code. */
async function startedSigningUp(email: string) {
  await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "Password123!", displayName: "Half Signed-Up" })
    .expect(201);
  const user = await prisma.appUser.findUniqueOrThrow({ where: { email } });
  expect(user.status).toBe("PENDING_VERIFICATION");
  return user;
}

const invite = (token: string, email: string) =>
  request(app).post("/api/v1/membership/invitations").set(authHeader(token)).send({ email, role: "MEMBER" });

const add = (token: string, email: string) =>
  request(app).post("/api/v1/membership/members").set(authHeader(token)).send({ email, role: "MEMBER" });

function expectActionableRefusal(res: request.Response) {
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("CONFLICT");
  expect(res.body.error.details).toMatchObject({ reason: "ACCOUNT_NOT_ACTIVE" });
  // Says what to do, and no longer calls a half-finished sign-up "disabled".
  expect(res.body.error.message).toMatch(/finish verifying their email/i);
  expect(res.body.error.message).not.toMatch(/disabled/i);
  // Which state it is in is not the inviter's to learn.
  expect(JSON.stringify(res.body)).not.toMatch(/PENDING_VERIFICATION|SUSPENDED/);
}

describe("inviting an address whose account is not active", () => {
  it("explains what to do for somebody who never finished signing up", async () => {
    const owner = await registerUser(app, { email: `st-owner-${uid()}@zoiko.test` });
    const user = await startedSigningUp(`st-pending-${uid()}@zoiko.test`);

    expectActionableRefusal(await invite(owner.accessToken, user.email));
    expectActionableRefusal(await add(owner.accessToken, user.email));

    // Nothing was created for them in this workspace.
    expect(await prisma.tenantMembership.count({ where: { tenantId: owner.tenantId, userId: user.id } })).toBe(0);
  });

  it("refuses a suspended account the same way", async () => {
    const owner = await registerUser(app, { email: `st-owner-${uid()}@zoiko.test` });
    const user = await registerUser(app, { email: `st-susp-${uid()}@zoiko.test` });
    await prisma.appUser.update({ where: { id: user.userId }, data: { status: "SUSPENDED" } });

    expectActionableRefusal(await invite(owner.accessToken, user.email));
    expectActionableRefusal(await add(owner.accessToken, user.email));
  });

  it("refuses a disabled account the same way", async () => {
    const owner = await registerUser(app, { email: `st-owner-${uid()}@zoiko.test` });
    const user = await registerUser(app, { email: `st-dis-${uid()}@zoiko.test` });
    await prisma.appUser.update({ where: { id: user.userId }, data: { status: "DISABLED" } });

    expectActionableRefusal(await invite(owner.accessToken, user.email));
    expectActionableRefusal(await add(owner.accessToken, user.email));
  });

  it("still invites an active account, and one that was already invited", async () => {
    const owner = await registerUser(app, { email: `st-owner-${uid()}@zoiko.test` });
    const active = await registerUser(app, { email: `st-active-${uid()}@zoiko.test` });
    await invite(owner.accessToken, active.email).expect(201);

    const fresh = `st-fresh-${uid()}@zoiko.test`;
    await invite(owner.accessToken, fresh).expect(201);
    // Inviting the same address again (a re-invite) is allowed.
    await invite(owner.accessToken, fresh).expect(201);
  });

  it("only lets people with permission to invite learn anything at all", async () => {
    const owner = await registerUser(app, { email: `st-owner-${uid()}@zoiko.test` });
    const outsider = await registerUser(app, { email: `st-outsider-${uid()}@zoiko.test` });
    const user = await startedSigningUp(`st-pending-${uid()}@zoiko.test`);
    // An unrelated workspace's owner is still refused the same way; a request with no session is refused outright.
    await request(app).post("/api/v1/membership/invitations").send({ email: user.email, role: "MEMBER" }).expect(401);
    expectActionableRefusal(await invite(outsider.accessToken, user.email));
    expect(owner.tenantId).not.toBe(outsider.tenantId);
  });
});
