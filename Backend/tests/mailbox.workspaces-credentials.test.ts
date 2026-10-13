import { afterEach, describe, expect, it } from "vitest";
import type { MailboxProvisioningStatus } from "@prisma/client";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/common/utils/password.js";
import { mailboxAccessService } from "../src/modules/mail/mailbox-access.service.js";
import { stalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import { StalwartError, type MailHostingProvider } from "../src/modules/stalwart/stalwart.types.js";
import { authHeader, loginUser, registerUser, stepUpHeader } from "./helpers.js";

const app = createApp();

/**
 * The two controls on Admin → Mailboxes that decide who a mailbox opens for
 * and how its owner gets back in.
 *
 * Workspace assignment is a property of the mailbox: which workspace consoles
 * it can be opened in. A new mailbox opens in the Member workspace alone, the
 * admin widens or narrows that, and the mail routes refuse the mailbox from
 * any console it is not assigned to.
 *
 * Credentials: an admin may set the owner's password only when that password
 * reaches nowhere else, only after re-authenticating, and never for a role
 * above their own. Everyone else gets a reset code.
 */

const NEW_PASSWORD = "Fresh-Passw0rd";

let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

/** A verified account that belongs to no workspace yet. */
async function account(email: string) {
  await prisma.appUser.create({
    data: {
      email,
      displayName: email.split("@")[0]!,
      passwordHash: await hashPassword("Password123!"),
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
}

/** An Owner with an Active Member who belongs to this workspace only. */
async function workspace(prefix: string) {
  const owner = await registerUser(app, { email: `${unique(prefix)}-owner@zoiko.test` });
  const memberEmail = `${unique(prefix)}-member@zoiko.test`;
  await account(memberEmail);
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: memberEmail, role: "MEMBER" })
    .expect(201);
  const membershipId = added.body.data.id as string;
  const mailbox = await prisma.mailbox.create({
    data: { tenantId: owner.tenantId, membershipId, address: `${unique("mbx")}@zoiko.test` },
    select: { id: true, workspaces: true },
  });
  return { owner, memberEmail, membershipId, mailbox };
}

const setWorkspaces = (token: string, mailboxId: string, workspaces: unknown) =>
  request(app)
    .put(`/api/v1/mail/admin/mailboxes/${mailboxId}/workspaces`)
    .set(authHeader(token))
    .send({ workspaces });

describe("workspace assignment", () => {
  it("defaults a new mailbox to the Member workspace alone", async () => {
    const { mailbox } = await workspace("ws-default");
    expect(mailbox.workspaces).toEqual(["MEMBER"]);
  });

  it("saves the admin's choice, in a stable order, and reads it back from the list", async () => {
    const { owner, mailbox } = await workspace("ws-save");
    const response = await setWorkspaces(owner.accessToken, mailbox.id, ["OWNER", "MEMBER", "SUPPORT"]).expect(200);
    expect(response.body.data.workspaces).toEqual(["MEMBER", "SUPPORT", "OWNER"]);
    expect(response.body.data.changed).toBe(true);

    const stored = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailbox.id }, select: { workspaces: true } });
    expect(stored.workspaces).toEqual(["MEMBER", "SUPPORT", "OWNER"]);

    const listed = await request(app)
      .get("/api/v1/mail/admin/mailboxes")
      .set(authHeader(owner.accessToken))
      .expect(200);
    const rows = (listed.body.data.items ?? listed.body.data) as Array<{ id: string; workspaces: string[] }>;
    expect(rows.find((row) => row.id === mailbox.id)?.workspaces).toEqual(["MEMBER", "SUPPORT", "OWNER"]);

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_WORKSPACES_UPDATED", targetId: mailbox.id },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses an empty selection and an unknown workspace", async () => {
    const { owner, mailbox } = await workspace("ws-invalid");
    await setWorkspaces(owner.accessToken, mailbox.id, []).expect(400);
    await setWorkspaces(owner.accessToken, mailbox.id, ["MEMBER", "GUEST"]).expect(400);
  });

  it("is not available to a Member", async () => {
    const { mailbox, memberEmail, owner } = await workspace("ws-member");
    const member = await loginUser(app, memberEmail, "Password123!", owner.tenantId);
    await setWorkspaces(member.accessToken, mailbox.id, ["MEMBER", "ADMIN"]).expect(403);
  });

  it("refuses the mailbox from a workspace it is not assigned to, and admits it once assigned", async () => {
    const owner = await registerUser(app, { email: `${unique("ws-guard")}@zoiko.test` });
    const mine = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, membershipId: owner.membershipId, address: `${unique("own")}@zoiko.test` },
      select: { id: true },
    });

    // Assigned to Member only, so the Owner console cannot open it.
    const refused = await request(app).get("/api/v1/mail").set(authHeader(owner.accessToken)).expect(403);
    expect(refused.body.error.code).toBe("MAILBOX_NOT_IN_WORKSPACE");
    expect(refused.body.error.details.workspace).toBe("OWNER");
    await request(app).get("/api/v1/messages").set(authHeader(owner.accessToken)).expect(403);

    // Managing mailboxes is not opening one: the admin screen still works.
    await request(app).get("/api/v1/mail/admin/mailboxes").set(authHeader(owner.accessToken)).expect(200);

    await setWorkspaces(owner.accessToken, mine.id, ["MEMBER", "OWNER"]).expect(200);
    await request(app).get("/api/v1/mail").set(authHeader(owner.accessToken)).expect(200);
  });
});

describe("mailbox credentials", () => {
  const status = (token: string, mailboxId: string) =>
    request(app).get(`/api/v1/mail/admin/mailboxes/${mailboxId}/credentials`).set(authHeader(token));
  const reset = (token: string, mailboxId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    request(app)
      .post(`/api/v1/mail/admin/mailboxes/${mailboxId}/credentials`)
      .set({ ...authHeader(token), ...headers })
      .send(body);

  it("offers a password for a member of this workspace alone", async () => {
    const { owner, mailbox, memberEmail } = await workspace("cr-status");
    const response = await status(owner.accessToken, mailbox.id).expect(200);
    expect(response.body.data.mode).toBe("SET_PASSWORD");
    expect(response.body.data.owner.email).toBe(memberEmail);
  });

  it("offers only a reset code when the password also signs the owner in elsewhere", async () => {
    const { owner, mailbox, memberEmail } = await workspace("cr-shared");
    const user = await prisma.appUser.findUniqueOrThrow({ where: { email: memberEmail } });
    const other = await registerUser(app, { email: `${unique("cr-other")}@zoiko.test` });
    await prisma.tenantMembership.create({ data: { tenantId: other.tenantId, userId: user.id, role: "MEMBER", status: "ACTIVE" } });

    const response = await status(owner.accessToken, mailbox.id).expect(200);
    expect(response.body.data.mode).toBe("RESET_EMAIL");
    expect(response.body.data.reason).toBe("SHARED_ACCOUNT");
    await reset(owner.accessToken, mailbox.id, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, await stepUpHeader(app, owner.accessToken)).expect(409);
  });

  it("is unavailable for a shared mailbox and for the admin's own mailbox", async () => {
    const owner = await registerUser(app, { email: `${unique("cr-un")}@zoiko.test` });
    const shared = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, address: `${unique("shared")}@zoiko.test` },
      select: { id: true },
    });
    const mine = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, membershipId: owner.membershipId, address: `${unique("self")}@zoiko.test` },
      select: { id: true },
    });
    expect((await status(owner.accessToken, shared.id).expect(200)).body.data.reason).toBe("SHARED_MAILBOX");
    expect((await status(owner.accessToken, mine.id).expect(200)).body.data.reason).toBe("SELF");
  });

  it("requires a fresh step-up", async () => {
    const { owner, mailbox } = await workspace("cr-stepup");
    const response = await reset(owner.accessToken, mailbox.id, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }).expect(403);
    expect(response.body.error.details?.requiresStepUp).toBe(true);
    expect(response.body.error.details?.capability).toBe("people.credentials.reset");
  });

  it("validates the new password", async () => {
    const { owner, mailbox } = await workspace("cr-valid");
    const stepUp = await stepUpHeader(app, owner.accessToken);
    await reset(owner.accessToken, mailbox.id, { newPassword: NEW_PASSWORD, confirmPassword: "Different-1" }, stepUp).expect(400);
    await reset(owner.accessToken, mailbox.id, { newPassword: "short1", confirmPassword: "short1" }, stepUp).expect(400);
    await reset(owner.accessToken, mailbox.id, { newPassword: "lettersonly", confirmPassword: "lettersonly" }, stepUp).expect(400);
  });

  it("sets the password, signs the owner out everywhere, and the new password works", async () => {
    const { owner, mailbox, memberEmail } = await workspace("cr-ok");
    const member = await loginUser(app, memberEmail, "Password123!", owner.tenantId);
    await request(app).get("/api/v1/mail/mailbox").set(authHeader(member.accessToken)).expect(200);

    const response = await reset(
      owner.accessToken,
      mailbox.id,
      { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      await stepUpHeader(app, owner.accessToken)
    ).expect(200);
    expect(response.body.data.ownerEmail).toBe(memberEmail);
    expect(JSON.stringify(response.body)).not.toContain(NEW_PASSWORD);

    // The access token already in the member's browser stops working.
    await request(app).get("/api/v1/mail/mailbox").set(authHeader(member.accessToken)).expect(401);
    const user = await prisma.appUser.findUniqueOrThrow({ where: { email: memberEmail } });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);

    await request(app).post("/api/v1/auth/login").send({ email: memberEmail, password: "Password123!", tenantId: owner.tenantId }).expect(401);
    const fresh = await loginUser(app, memberEmail, NEW_PASSWORD, owner.tenantId);
    expect(fresh.accessToken).toBeTruthy();

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_CREDENTIALS_RESET", targetId: mailbox.id },
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain(NEW_PASSWORD);
  });

  it("never lets an Admin set an Owner's password", async () => {
    const owner = await registerUser(app, { email: `${unique("cr-ceiling")}@zoiko.test` });
    const adminEmail = `${unique("cr-admin")}@zoiko.test`;
    await account(adminEmail);
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: adminEmail, role: "ADMIN" })
      .expect(201);
    const ownerMailbox = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, membershipId: owner.membershipId, address: `${unique("own")}@zoiko.test` },
      select: { id: true },
    });
    const admin = await loginUser(app, adminEmail, "Password123!", owner.tenantId);

    expect((await status(admin.accessToken, ownerMailbox.id).expect(200)).body.data.reason).toBe("ROLE_NOT_MANAGEABLE");
    await reset(
      admin.accessToken,
      ownerMailbox.id,
      { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      await stepUpHeader(app, admin.accessToken)
    ).expect(403);
  });
});

/**
 * A mailbox hosted on the mail server has a second password there (IMAP,
 * SMTP submission). An admin's reset must change both or neither.
 */
describe("mail server password sync", () => {
  /** Only the calls this flow makes; the rest are never reached. */
  function fakeHost(fail?: StalwartError) {
    const passwords = new Map<string, string>();
    const host = {
      name: "STALWART" as const,
      isConfigured: () => true,
      setAccountPassword: async (id: string, secret: string) => {
        if (fail) throw fail;
        passwords.set(id, secret);
      },
    } as unknown as MailHostingProvider;
    return { host, passwords };
  }

  afterEach(() => mailboxAccessService.setProvider(stalwartClient));

  async function hosted(prefix: string, provisioningStatus: MailboxProvisioningStatus = "PROVISIONED") {
    const ws = await workspace(prefix);
    await prisma.mailbox.update({
      where: { id: ws.mailbox.id },
      data: { provisioningStatus, providerAccountId: provisioningStatus === "PROVISIONED" ? `acc-${ws.mailbox.id}` : null },
    });
    return ws;
  }

  const resetHosted = async (owner: { accessToken: string }, mailboxId: string) =>
    request(app)
      .post(`/api/v1/mail/admin/mailboxes/${mailboxId}/credentials`)
      .set({ ...authHeader(owner.accessToken), ...(await stepUpHeader(app, owner.accessToken)) })
      .send({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });

  it("changes the mail server password together with the Zoiko one", async () => {
    const { host, passwords } = fakeHost();
    mailboxAccessService.setProvider(host);
    const { owner, mailbox, memberEmail } = await hosted("sync-ok");

    const status = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${mailbox.id}/credentials`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(status.body.data.mailServer).toBe("HOSTED");

    const response = await resetHosted(owner, mailbox.id);
    expect(response.status).toBe(200);
    expect(response.body.data.mailServer).toBe("HOSTED");
    expect(passwords.get(`acc-${mailbox.id}`)).toBe(NEW_PASSWORD);

    // Persisted: the new password signs in, hashed rather than stored as typed.
    const user = await prisma.appUser.findUniqueOrThrow({ where: { email: memberEmail } });
    expect(user.passwordHash).not.toContain(NEW_PASSWORD);
    expect((await loginUser(app, memberEmail, NEW_PASSWORD, owner.tenantId)).accessToken).toBeTruthy();
  });

  it("changes nothing when the mail server refuses", async () => {
    mailboxAccessService.setProvider(fakeHost(new StalwartError("down", "UNAVAILABLE", true)).host);
    const { owner, mailbox, memberEmail } = await hosted("sync-fail");

    const response = await resetHosted(owner, mailbox.id);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("MAIL_SERVER_SYNC_FAILED");

    // The old password still works and no session was ended.
    expect((await loginUser(app, memberEmail, "Password123!", owner.tenantId)).accessToken).toBeTruthy();
    const audit = await prisma.auditEvent.count({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_CREDENTIALS_RESET", targetId: mailbox.id },
    });
    expect(audit).toBe(0);
  });

  it("waits while the mailbox is still being set up on the mail server", async () => {
    mailboxAccessService.setProvider(fakeHost().host);
    const { owner, mailbox } = await hosted("sync-pending", "PROVISIONING");
    const status = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${mailbox.id}/credentials`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(status.body.data.reason).toBe("MAIL_SERVER_PENDING");
    expect((await resetHosted(owner, mailbox.id)).status).toBe(409);
  });

  it("keeps Zoiko-only mailboxes working when no mail server is connected", async () => {
    const { owner, mailbox } = await workspace("sync-zoiko");
    const status = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${mailbox.id}/credentials`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(status.body.data.mailServer).toBe("ZOIKO");
    expect((await resetHosted(owner, mailbox.id)).status).toBe(200);
  });
});
