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
 * The two administrator-side connector actions RBAC §2 names and nothing
 * implemented — "Disconnect connected account: Admin = Tenant scope" and
 * "Rotate provider credentials: Owner Yes / Admin if policy, Step-up".
 *
 * Both capabilities were in the matrix with no route behind them. The member
 * path existed and scoped every query by `membershipId`, so an Owner could
 * not act on an account they did not personally hold — which is the whole
 * content of the "Tenant scope" column.
 */

async function connectedAccount(owner: RegisteredUser, email: string) {
  const created = await request(app)
    .post("/api/v1/connectors")
    .set(authHeader(owner.accessToken))
    .send({
      provider: "GMAIL",
      providerAccountId: `gmail-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      email,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    })
    .expect(201);
  return created.body.data.id as string;
}

async function memberWithAccount(owner: RegisteredUser, email: string) {
  const user = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "MEMBER" })
    .expect(201);
  const login = await loginUser(app, user.email, user.password, owner.tenantId);

  const created = await request(app)
    .post("/api/v1/connectors")
    .set(authHeader(login.accessToken))
    .send({
      provider: "GMAIL",
      providerAccountId: `gmail-m-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      email: `inbox-${Date.now()}@gmail.test`,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    })
    .expect(201);

  return { user, token: login.accessToken as string, accountId: created.body.data.id as string };
}

describe("tenant-scope disconnect", () => {
  it("lets an owner disconnect an account they do not personally hold", async () => {
    const owner = await registerUser(app, { email: `cd-owner-${Date.now()}@zoiko.test` });
    const member = await memberWithAccount(owner, `cd-member-${Date.now()}@zoiko.test`);

    // The member's own route is scoped by membershipId, so before this
    // existed the owner had no way in at all — not a permission problem, an
    // absent one.
    await request(app)
      .delete(`/api/v1/connectors/admin/${member.accountId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const after = await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: member.accountId },
      select: { status: true, tokenSecretRef: true, disconnectedAt: true },
    });
    expect(after.status).toBe("DISCONNECTED");
    expect(after.tokenSecretRef).toBeNull();
    expect(after.disconnectedAt).not.toBeNull();
  });

  it("records who disconnected it", async () => {
    const owner = await registerUser(app, { email: `cd-audit-o-${Date.now()}@zoiko.test` });
    const member = await memberWithAccount(owner, `cd-audit-m-${Date.now()}@zoiko.test`);

    await request(app)
      .delete(`/api/v1/connectors/admin/${member.accountId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const event = await prisma.auditEvent.findFirst({
      where: {
        tenantId: owner.tenantId,
        eventType: "CONNECTED_ACCOUNT_DISCONNECTED",
        targetId: member.accountId,
      },
    });
    expect(event).not.toBeNull();
    // The owner did it, not the member whose account it was.
    expect(event?.actorUserId).toBe(owner.userId);
  });

  it("refuses a member — the capability is Owner and Admin only", async () => {
    const owner = await registerUser(app, { email: `cd-deny-o-${Date.now()}@zoiko.test` });
    const a = await memberWithAccount(owner, `cd-deny-a-${Date.now()}@zoiko.test`);
    const b = await memberWithAccount(owner, `cd-deny-b-${Date.now()}@zoiko.test`);

    // A member reaching the tenant-scope route to disconnect a colleague is
    // exactly what the separate route exists to refuse.
    await request(app)
      .delete(`/api/v1/connectors/admin/${b.accountId}`)
      .set(authHeader(a.token))
      .expect(403);

    const untouched = await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: b.accountId },
      select: { status: true },
    });
    expect(untouched.status).not.toBe("DISCONNECTED");
  });

  it("cannot reach an account in another workspace", async () => {
    const owner = await registerUser(app, { email: `cd-iso-a-${Date.now()}@zoiko.test` });
    const other = await registerUser(app, { email: `cd-iso-b-${Date.now()}@zoiko.test` });
    const theirs = await connectedAccount(other, `iso-${Date.now()}@gmail.test`);

    await request(app)
      .delete(`/api/v1/connectors/admin/${theirs}`)
      .set(authHeader(owner.accessToken))
      .expect(404);
  });

  it("leaves the member's own disconnect working", async () => {
    const owner = await registerUser(app, { email: `cd-own-o-${Date.now()}@zoiko.test` });
    const member = await memberWithAccount(owner, `cd-own-m-${Date.now()}@zoiko.test`);

    // The regression this pair of routes exists to avoid: gating the single
    // shared route on a tenant-scope capability would have taken this away
    // from every member.
    await request(app)
      .delete(`/api/v1/connectors/${member.accountId}`)
      .set(authHeader(member.token))
      .expect(200);
  });
});

describe("credential rotation", () => {
  it("needs step-up, because §5 counts a provider-credential action as high-risk", async () => {
    const owner = await registerUser(app, { email: `cr-step-${Date.now()}@zoiko.test` });
    const accountId = await connectedAccount(owner, `rot-${Date.now()}@gmail.test`);

    const res = await request(app)
      .post(`/api/v1/connectors/admin/${accountId}/rotate`)
      .set(authHeader(owner.accessToken))
      .expect(403);
    expect(res.body.error.details?.requiresStepUp ?? res.body.error.message).toBeTruthy();
  });

  it("refuses to rotate a disconnected account", async () => {
    const owner = await registerUser(app, { email: `cr-disc-${Date.now()}@zoiko.test` });
    const accountId = await connectedAccount(owner, `rot-d-${Date.now()}@gmail.test`);
    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: { status: "DISCONNECTED" },
    });

    const res = await request(app)
      .post(`/api/v1/connectors/admin/${accountId}/rotate`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .expect(409);
    expect(res.body.error.details?.reason).toBe("ACCOUNT_DISCONNECTED");
  });

  it("records the attempt even when the provider refuses", async () => {
    const owner = await registerUser(app, { email: `cr-fail-${Date.now()}@zoiko.test` });
    const accountId = await connectedAccount(owner, `rot-f-${Date.now()}@gmail.test`);

    // No real refresh token behind this fixture, so the provider path fails
    // — which is the case an operator chasing a suspected leak most needs
    // to see, because it means somebody has to go and reconnect.
    await request(app)
      .post(`/api/v1/connectors/admin/${accountId}/rotate`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .expect(502);

    const event = await prisma.auditEvent.findFirst({
      where: {
        tenantId: owner.tenantId,
        eventType: "CONNECTOR_CREDENTIALS_ROTATION_FAILED",
        targetId: accountId,
      },
    });
    expect(event).not.toBeNull();

    // Whatever else the row carries, it must never carry the credential.
    const meta = JSON.stringify(event?.metadata ?? {});
    expect(meta).not.toMatch(/token|secret|refresh_token/i);
  });

  it("cannot rotate an account in another workspace", async () => {
    const owner = await registerUser(app, { email: `cr-iso-a-${Date.now()}@zoiko.test` });
    const other = await registerUser(app, { email: `cr-iso-b-${Date.now()}@zoiko.test` });
    const theirs = await connectedAccount(other, `rot-iso-${Date.now()}@gmail.test`);

    await request(app)
      .post(`/api/v1/connectors/admin/${theirs}/rotate`)
      .set(authHeader(owner.accessToken))
      .set(await stepUpHeader(app, owner.accessToken))
      .expect(404);
  });
});
