import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();
const mutableEnv = env as { SYSTEM_MAIL_ENABLED: boolean };

/**
 * Inviting somebody to the workspace, on a deployment that cannot send email.
 * The invitation exists but nobody receives it, so the admin is handed the link
 * to pass on. The link is a credential: it has to reach the admin and work, and
 * not be kept anywhere else.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

beforeEach(() => {
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
});
afterEach(() => {
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
});

const invite = (token: string, email: string, key?: string) => {
  const req = request(app).post("/api/v1/membership/invitations").set(authHeader(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send({ email, role: "MEMBER" });
};

const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

const claim = (token: string) =>
  request(app).post("/api/v1/membership/invitations/claim").send({ invitationToken: token, password: "A-strong-Passw0rd!" });

describe("the invitation link, when email delivery is off", () => {
  it("is returned to the admin, and the person can use it to join", async () => {
    const owner = await registerUser(app, { email: `il-owner-${uid()}@zoiko.test` });
    const email = `il-new-${uid()}@zoiko.test`;

    const res = await invite(owner.accessToken, email).expect(201);
    const link = res.body.data.invitationLink as string;
    expect(link).toMatch(new RegExp(`^${env.APP_URL}/invitation/accept\\?token=[A-Za-z0-9_-]{22}$`));
    expect(tokenOf(link)).toBe(res.body.data.invitationToken);

    // No email, no account yet: the link alone is enough to set a password and join.
    await claim(tokenOf(link)).expect(200);
    const member = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: owner.tenantId, user: { email } },
    });
    expect(member.status).toBe("ACTIVE");
  });

  it("is kept out of the stored replay copy, and a replay does not show it again", async () => {
    const owner = await registerUser(app, { email: `il-owner-${uid()}@zoiko.test` });
    const email = `il-replay-${uid()}@zoiko.test`;
    const key = `invite-replay-${uid()}`;

    const first = await invite(owner.accessToken, email, key).expect(201);
    const token = tokenOf(first.body.data.invitationLink);

    const stored = await prisma.idempotencyRecord.findFirstOrThrow({ where: { tenantId: owner.tenantId, key } });
    const body = JSON.stringify(stored.responseBody);
    expect(body).not.toContain(token);
    expect(body).not.toContain("invitationLink");
    expect(body).not.toContain("invitationToken");

    const replay = await invite(owner.accessToken, email, key).expect(201);
    expect(replay.body.data.membership.id).toBe(first.body.data.membership.id);
    expect(replay.body.data).not.toHaveProperty("invitationLink");
    expect(replay.body.data).not.toHaveProperty("invitationToken");
  });

  it("is not returned when the invitation goes out by email", async () => {
    const owner = await registerUser(app, { email: `il-owner-${uid()}@zoiko.test` });
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    const res = await invite(owner.accessToken, `il-mail-${uid()}@zoiko.test`).expect(201);
    expect(res.body.data.invitationLink).toBeNull();
  });

  it("is replaced by a new one when the same address is invited again, and the old one stops working", async () => {
    const owner = await registerUser(app, { email: `il-owner-${uid()}@zoiko.test` });
    const email = `il-again-${uid()}@zoiko.test`;

    const first = await invite(owner.accessToken, email).expect(201);
    const second = await invite(owner.accessToken, email).expect(201);
    const oldToken = tokenOf(first.body.data.invitationLink);
    const newToken = tokenOf(second.body.data.invitationLink);
    expect(newToken).not.toBe(oldToken);

    expect((await claim(oldToken)).status).toBeGreaterThanOrEqual(400);
    await claim(newToken).expect(200);
  });

  it("is never stored in the database in the clear", async () => {
    const owner = await registerUser(app, { email: `il-owner-${uid()}@zoiko.test` });
    const res = await invite(owner.accessToken, `il-store-${uid()}@zoiko.test`).expect(201);
    const token = tokenOf(res.body.data.invitationLink);

    const memberships = await prisma.tenantMembership.findMany({ where: { tenantId: owner.tenantId } });
    const audit = await prisma.auditEvent.findMany({ where: { tenantId: owner.tenantId } });
    const asText = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(asText(memberships)).not.toContain(token);
    expect(asText(audit)).not.toContain(token);
  });

  it("is given only to somebody who is allowed to invite", async () => {
    const owner = await registerUser(app, { email: `il-owner-${uid()}@zoiko.test` });
    const person = await registerUser(app, { email: `il-member-${uid()}@zoiko.test` });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: person.email, role: "MEMBER" })
      .expect(201);
    const login = await loginUser(app, person.email, person.password, owner.tenantId, person.mfaSecret);

    const refused = await invite(login.accessToken as string, `il-x-${uid()}@zoiko.test`);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain("invitation/accept");
  });
});
