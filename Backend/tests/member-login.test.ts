import { describe, expect, it } from "vitest";
import type { MembershipRole } from "@prisma/client";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { hashPassword } from "../src/common/utils/password.js";
import { authHeader, registerUser, stepUpHeader, throughMfa } from "./helpers.js";
import { verifyPassword } from "../src/common/utils/password.js";

const app = createApp();

/**
 * The Member sign-in and the console gate.
 *
 * The Member login opens the Member workspace for anyone, whatever their role,
 * and the session acts as a member. The standard login opens the role's own
 * console only when the admin's Workspace Access setting on the person's
 * mailbox lists it — with two safeguards: an Owner always reaches Owner, and a
 * person without a personal mailbox falls back to their role. Every mailbox
 * carries a Member sign-in link that prefills the form and signs nobody in.
 */

const PASSWORD = "Password123!";

let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

/** An Owner, signed in to the Owner console. */
async function ownerOf(prefix: string) {
  return registerUser(app, { email: `${unique(prefix)}-owner@zoiko.test` });
}

/** A person with `role` in the owner's workspace, optionally with a personal mailbox. */
async function person(
  owner: Awaited<ReturnType<typeof ownerOf>>,
  role: MembershipRole,
  mailboxWorkspaces?: MembershipRole[]
) {
  const email = `${unique(role.toLowerCase())}@zoiko.test`;
  await prisma.appUser.create({
    data: {
      email,
      displayName: email.split("@")[0]!,
      passwordHash: await hashPassword(PASSWORD),
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role })
    .expect(201);
  const membershipId = added.body.data.id as string;
  const mailbox = mailboxWorkspaces
    ? await prisma.mailbox.create({
        data: {
          tenantId: owner.tenantId,
          membershipId,
          address: `${unique("mbx")}@zoiko.test`,
          workspaces: mailboxWorkspaces,
        },
        select: { id: true, memberLoginKey: true },
      })
    : null;
  return { email, membershipId, mailbox };
}

/** Sign in through /auth/login (and past MFA when the role needs it). */
async function signIn(
  email: string,
  extras: { tenantId?: string; workspace?: string } = {},
  mfaSecret?: string | null
) {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: PASSWORD, ...extras })
    .expect(200);
  const data = (await throughMfa(app, response, mfaSecret)).body.data;
  const session = data.session ?? data;
  return {
    state: data.state as string,
    data,
    workspace: session.workspace as string | undefined,
    accessToken: session.accessToken as string,
    refreshToken: session.refreshToken as string,
  };
}

const me = (token: string) => request(app).get("/api/v1/auth/me").set(authHeader(token));

describe("Member login", () => {
  it("opens the Member workspace for an Admin whose mailbox is assigned to Admin, acting as a member", async () => {
    const owner = await ownerOf("ml-admin");
    const admin = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);

    const session = await signIn(admin.email, { workspace: "MEMBER" });
    expect(session.state).toBe("SIGNED_IN");
    expect(session.workspace).toBe("MEMBER");

    const who = await me(session.accessToken).expect(200);
    expect(who.body.data.workspace).toBe("MEMBER");
    expect(who.body.data.membership.role).toBe("MEMBER");

    // The role still holds admin rights, but this session does not.
    await request(app).get("/api/v1/mail/admin/mailboxes").set(authHeader(session.accessToken)).expect(403);
  });

  it("opens the Member workspace for an Owner too", async () => {
    const owner = await ownerOf("ml-owner");
    const session = await signIn(owner.email, { workspace: "MEMBER" }, owner.mfaSecret);
    expect(session.workspace).toBe("MEMBER");
    const who = await me(session.accessToken).expect(200);
    expect(who.body.data.membership.role).toBe("MEMBER");
  });

  it("opens the Member workspace for a Support seat, which could not hold one before", async () => {
    const owner = await ownerOf("ml-support");
    const support = await person(owner, "SUPPORT", ["MEMBER", "SUPPORT"]);
    const session = await signIn(support.email, { workspace: "MEMBER" });
    expect(session.workspace).toBe("MEMBER");
    const who = await me(session.accessToken).expect(200);
    expect(who.body.data.membership.role).toBe("MEMBER");
  });

  it("accepts only MEMBER as a requested workspace", async () => {
    const owner = await ownerOf("ml-escalate");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: PASSWORD, workspace: "ADMIN" })
      .expect(400);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: PASSWORD, workspace: "OWNER" })
      .expect(400);
  });

  it("keeps the Member intent through workspace selection", async () => {
    const owner = await ownerOf("ml-select");
    const admin = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);
    // A second workspace, so sign-in has to ask which.
    const other = await ownerOf("ml-select-other");
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(other.accessToken))
      .send({ email: admin.email, role: "MEMBER" })
      .expect(201);

    const first = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: PASSWORD, workspace: "MEMBER" })
      .expect(200);
    expect(first.body.data.state).toBe("WORKSPACE_SELECTION");

    const picked = await request(app)
      .post("/api/v1/auth/select-workspace")
      .send({ selectionToken: first.body.data.selectionToken, tenantId: owner.tenantId })
      .expect(200);
    const data = (await throughMfa(app, picked)).body.data;
    expect(data.state).toBe("SIGNED_IN");
    expect((data.session ?? data).workspace).toBe("MEMBER");
  });
});

describe("console gate on the standard login", () => {
  it("opens the Admin console only when the admin's mailbox is assigned to it", async () => {
    const owner = await ownerOf("gate-admin");
    const authorised = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);
    const memberOnly = await person(owner, "ADMIN", ["MEMBER"]);

    expect((await signIn(authorised.email)).workspace).toBe("ADMIN");

    // Not authorised: lands in Member, never in Admin.
    const reduced = await signIn(memberOnly.email);
    expect(reduced.workspace).toBe("MEMBER");
    await request(app).get("/api/v1/mail/admin/mailboxes").set(authHeader(reduced.accessToken)).expect(403);
  });

  it("does not close the Admin console when the first mail is opened through the Member login", async () => {
    const owner = await ownerOf("gate-firstuse");
    const admin = await person(owner, "ADMIN");
    const memberSession = await signIn(admin.email, { workspace: "MEMBER" });
    // Opening mail creates the person's own mailbox on first use.
    await request(app).get("/api/v1/mail").set(authHeader(memberSession.accessToken)).expect(200);
    const created = await prisma.mailbox.findUniqueOrThrow({
      where: { membershipId: admin.membershipId },
      select: { workspaces: true },
    });
    expect(created.workspaces).toEqual(["MEMBER", "ADMIN"]);
    expect((await signIn(admin.email)).workspace).toBe("ADMIN");
  });

  it("falls back to the role for a person with no personal mailbox", async () => {
    const owner = await ownerOf("gate-nomailbox");
    const admin = await person(owner, "ADMIN");
    expect((await signIn(admin.email)).workspace).toBe("ADMIN");
  });

  it("always lets an Owner into the Owner console", async () => {
    const owner = await ownerOf("gate-owner");
    await prisma.mailbox.create({
      data: {
        tenantId: owner.tenantId,
        membershipId: owner.membershipId,
        address: `${unique("own")}@zoiko.test`,
        workspaces: ["MEMBER"],
      },
    });
    const session = await signIn(owner.email, {}, owner.mfaSecret);
    expect(session.workspace).toBe("OWNER");
  });

  it("opens the Support console only when assigned, otherwise the Member workspace", async () => {
    const owner = await ownerOf("gate-support");
    const assigned = await person(owner, "SUPPORT", ["SUPPORT"]);
    const unassigned = await person(owner, "SUPPORT", ["MEMBER"]);
    expect((await signIn(assigned.email)).workspace).toBe("SUPPORT");
    expect((await signIn(unassigned.email)).workspace).toBe("MEMBER");
  });

  it("ends a live Admin session on its next request when Admin is unticked, and refuses to refresh it", async () => {
    const owner = await ownerOf("gate-revoke");
    const admin = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);
    const session = await signIn(admin.email);
    expect(session.workspace).toBe("ADMIN");
    await request(app).get("/api/v1/mail/admin/mailboxes").set(authHeader(session.accessToken)).expect(200);

    await request(app)
      .put(`/api/v1/mail/admin/mailboxes/${admin.mailbox!.id}/workspaces`)
      .set(authHeader(owner.accessToken))
      .send({ workspaces: ["MEMBER"] })
      .expect(200);

    const refused = await request(app)
      .get("/api/v1/mail/admin/mailboxes")
      .set(authHeader(session.accessToken))
      .expect(403);
    expect(refused.body.error.code).toBe("WORKSPACE_ACCESS_NOT_ASSIGNED");

    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: session.refreshToken })
      .expect(403);
    expect(refresh.body.error.code).toBe("WORKSPACE_ACCESS_NOT_ASSIGNED");

    // Signing in again lands in the Member workspace.
    expect((await signIn(admin.email)).workspace).toBe("MEMBER");
  });

  it("stops an admin unticking their own current console, but lets another admin do it", async () => {
    const owner = await ownerOf("gate-self");
    const admin = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);
    const session = await signIn(admin.email);

    const own = await request(app)
      .put(`/api/v1/mail/admin/mailboxes/${admin.mailbox!.id}/workspaces`)
      .set(authHeader(session.accessToken))
      .send({ workspaces: ["MEMBER"] })
      .expect(409);
    expect(own.body.error.details.reason).toBe("OWN_CURRENT_WORKSPACE");

    await request(app)
      .put(`/api/v1/mail/admin/mailboxes/${admin.mailbox!.id}/workspaces`)
      .set(authHeader(owner.accessToken))
      .send({ workspaces: ["MEMBER"] })
      .expect(200);
  });
});

describe("Member sign-in link", () => {
  it("is generated for every new mailbox and listed on the Mailboxes page", async () => {
    const owner = await ownerOf("link-list");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    expect(member.mailbox!.memberLoginKey).toMatch(/^[0-9a-f]{32}$/);

    const listed = await request(app).get("/api/v1/mail/admin/mailboxes").set(authHeader(owner.accessToken)).expect(200);
    const rows = (listed.body.data.items ?? listed.body.data) as Array<{ id: string; memberLoginUrl: string }>;
    const row = rows.find((entry) => entry.id === member.mailbox!.id)!;
    expect(row.memberLoginUrl).toMatch(new RegExp(`/login/member/${member.mailbox!.memberLoginKey}$`));
  });

  it("resolves to the workspace and the owner's email, publicly, and signs nobody in", async () => {
    const owner = await ownerOf("link-resolve");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const resolved = await request(app).get(`/api/v1/auth/member-login/${member.mailbox!.memberLoginKey}`).expect(200);
    expect(resolved.body.data).toMatchObject({ tenantId: owner.tenantId, email: member.email, shared: false });
    expect(resolved.body.data.accessToken).toBeUndefined();

    // The link's details plus the password: a Member session in that workspace.
    const session = await signIn(member.email, { tenantId: owner.tenantId, workspace: "MEMBER" });
    expect(session.workspace).toBe("MEMBER");
  });

  it("gives a shared mailbox's link no email", async () => {
    const owner = await ownerOf("link-shared");
    const shared = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, address: `${unique("team")}@zoiko.test`, type: "SHARED" },
      select: { memberLoginKey: true },
    });
    const resolved = await request(app).get(`/api/v1/auth/member-login/${shared.memberLoginKey}`).expect(200);
    expect(resolved.body.data).toMatchObject({ shared: true, email: null, tenantId: owner.tenantId });
  });

  it("refuses unknown and malformed links", async () => {
    const unknown = await request(app).get(`/api/v1/auth/member-login/${"0".repeat(32)}`).expect(404);
    expect(unknown.body.error.code).toBe("MEMBER_LOGIN_LINK_INVALID");
    await request(app).get("/api/v1/auth/member-login/not-a-key").expect(400);
  });

  it("can be regenerated by an admin, retiring the old link and leaving an audit record", async () => {
    const owner = await ownerOf("link-regen");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const old = member.mailbox!.memberLoginKey;

    const regenerated = await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${member.mailbox!.id}/member-login-link/regenerate`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    const next = regenerated.body.data.memberLoginKey as string;
    expect(next).toMatch(/^[0-9a-f]{32}$/);
    expect(next).not.toBe(old);
    expect(regenerated.body.data.memberLoginUrl).toMatch(new RegExp(`/login/member/${next}$`));

    await request(app).get(`/api/v1/auth/member-login/${old}`).expect(404);
    await request(app).get(`/api/v1/auth/member-login/${next}`).expect(200);

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_MEMBER_LOGIN_LINK_REGENERATED", targetId: member.mailbox!.id },
    });
    expect(audit).not.toBeNull();
  });

  it("cannot be regenerated by a Member", async () => {
    const owner = await ownerOf("link-member");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const session = await signIn(member.email);
    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${member.mailbox!.id}/member-login-link/regenerate`)
      .set(authHeader(session.accessToken))
      .expect(403);
  });
});

/**
 * The reported failure: an admin sets a mailbox's password on the Mailboxes
 * page, and the Member login rejects it. The password was saved correctly —
 * on the owner's account, whose email differs from the mailbox address — but
 * sign-in looked accounts up by account email only, so the mailbox address
 * people are actually given was an "unknown email".
 */
describe("signing in with a mailbox address", () => {
  const NEW_PASSWORD = "Fresh-Passw0rd";

  const login = (email: string, password: string, extras: Record<string, unknown> = {}) =>
    request(app).post("/api/v1/auth/login").send({ email, password, ...extras });

  async function adminSetsPassword(owner: Awaited<ReturnType<typeof ownerOf>>, mailboxId: string) {
    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${mailboxId}/credentials`)
      .set({ ...authHeader(owner.accessToken), ...(await stepUpHeader(app, owner.accessToken)) })
      .send({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      .expect(200);
  }

  it("accepts the password an admin set, at the mailbox address, on the Member login", async () => {
    const owner = await ownerOf("addr-reset");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const address = (await prisma.mailbox.findUniqueOrThrow({ where: { id: member.mailbox!.id } })).address;
    expect(address).not.toBe(member.email);

    await adminSetsPassword(owner, member.mailbox!.id);

    // Persisted: the stored hash verifies the new password and not the old one.
    const stored = await prisma.appUser.findUniqueOrThrow({ where: { email: member.email } });
    expect(await verifyPassword(NEW_PASSWORD, stored.passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(false);

    const viaMailbox = await login(address, NEW_PASSWORD, { workspace: "MEMBER" }).expect(200);
    expect(viaMailbox.body.data.state).toBe("SIGNED_IN");
    expect(viaMailbox.body.data.session.workspace).toBe("MEMBER");
    expect(viaMailbox.body.data.tenant.id).toBe(owner.tenantId);
    // The address is case-insensitive, as people type it.
    await login(address.toUpperCase(), NEW_PASSWORD, { workspace: "MEMBER" }).expect(200);

    // The account email still works, and the old password does not.
    await login(member.email, NEW_PASSWORD, { workspace: "MEMBER" }).expect(200);
    await login(address, PASSWORD, { workspace: "MEMBER" }).expect(401);
  });

  it("opens the mailbox's own workspace when the owner belongs to several", async () => {
    const owner = await ownerOf("addr-tenant");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const other = await ownerOf("addr-tenant-other");
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(other.accessToken))
      .send({ email: member.email, role: "MEMBER" })
      .expect(201);
    const address = (await prisma.mailbox.findUniqueOrThrow({ where: { id: member.mailbox!.id } })).address;

    // By account email the person must choose; by mailbox address the mailbox decides.
    expect((await login(member.email, PASSWORD, { workspace: "MEMBER" }).expect(200)).body.data.state).toBe(
      "WORKSPACE_SELECTION"
    );
    const viaMailbox = await login(address, PASSWORD, { workspace: "MEMBER" }).expect(200);
    expect(viaMailbox.body.data.state).toBe("SIGNED_IN");
    expect(viaMailbox.body.data.tenant.id).toBe(owner.tenantId);
  });

  it("keeps access to the workspaces assigned to the mailbox", async () => {
    const owner = await ownerOf("addr-scope");
    const admin = await person(owner, "ADMIN", ["MEMBER"]);
    const address = (await prisma.mailbox.findUniqueOrThrow({ where: { id: admin.mailbox!.id } })).address;

    // Assigned to Member only: the standard login cannot open Admin by address either.
    const standard = await login(address, PASSWORD).expect(200);
    const data = (await throughMfa(app, standard)).body.data;
    expect((data.session ?? data).workspace).toBe("MEMBER");

    // A member whose mailbox is not assigned to Member signs in, but the mail
    // routes refuse the mailbox there.
    const member = await person(owner, "MEMBER", ["SUPPORT"]);
    const memberAddress = (await prisma.mailbox.findUniqueOrThrow({ where: { id: member.mailbox!.id } })).address;
    const session = await login(memberAddress, PASSWORD, { workspace: "MEMBER" }).expect(200);
    const refused = await request(app)
      .get("/api/v1/mail")
      .set(authHeader(session.body.data.accessToken))
      .expect(403);
    expect(refused.body.error.code).toBe("MAILBOX_NOT_IN_WORKSPACE");
  });

  it("refuses an address owned by different people in different workspaces", async () => {
    const shared = `${unique("same")}@zoiko.test`;
    for (const prefix of ["addr-amb-a", "addr-amb-b"]) {
      const owner = await ownerOf(prefix);
      const member = await person(owner, "MEMBER");
      await prisma.mailbox.create({
        data: { tenantId: owner.tenantId, membershipId: member.membershipId, address: shared },
      });
    }
    const refused = await login(shared, PASSWORD).expect(401);
    expect(refused.body.error.message).toBe("Invalid email or password");
  });

  it("never signs anyone in through a shared mailbox or a removed owner's mailbox", async () => {
    const owner = await ownerOf("addr-none");
    const team = await prisma.mailbox.create({
      data: { tenantId: owner.tenantId, address: `${unique("team")}@zoiko.test`, type: "SHARED" },
      select: { address: true },
    });
    await login(team.address, PASSWORD).expect(401);

    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const address = (await prisma.mailbox.findUniqueOrThrow({ where: { id: member.mailbox!.id } })).address;
    await prisma.tenantMembership.update({ where: { id: member.membershipId }, data: { status: "REMOVED" } });
    await login(address, PASSWORD).expect(401);
  });

  it("sends a reset code for a mailbox address to the owner's account", async () => {
    const owner = await ownerOf("addr-forgot");
    const member = await person(owner, "MEMBER", ["MEMBER"]);
    const address = (await prisma.mailbox.findUniqueOrThrow({ where: { id: member.mailbox!.id } })).address;
    const user = await prisma.appUser.findUniqueOrThrow({ where: { email: member.email } });

    await request(app).post("/api/v1/auth/forgot-password").send({ email: address }).expect(200);
    const requested = await prisma.auditEvent.findFirst({
      where: { eventType: "PASSWORD_RESET_REQUESTED", targetId: user.id },
    });
    expect(requested).not.toBeNull();
  });
});

/**
 * The Member login is email and password only. The second factor stays on
 * every sign-in that opens a privileged console.
 */
describe("second factor", () => {
  const login = (email: string, extras: Record<string, unknown> = {}) =>
    request(app).post("/api/v1/auth/login").send({ email, password: PASSWORD, ...extras }).expect(200);

  it("is not asked on the Member login, even for an Admin or Owner", async () => {
    const owner = await ownerOf("mfa-member");
    const admin = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);

    const adminMember = await login(admin.email, { workspace: "MEMBER" });
    expect(adminMember.body.data.state).toBe("SIGNED_IN");
    expect(adminMember.body.data.session.workspace).toBe("MEMBER");

    const ownerMember = await login(owner.email, { workspace: "MEMBER" });
    expect(ownerMember.body.data.state).toBe("SIGNED_IN");
    expect(ownerMember.body.data.session.workspace).toBe("MEMBER");
    // And it is still a member session, not an owner one.
    await request(app)
      .get("/api/v1/mail/admin/mailboxes")
      .set(authHeader(ownerMember.body.data.accessToken))
      .expect(403);
  });

  it("is still asked on the standard login for the Admin and Owner consoles", async () => {
    const owner = await ownerOf("mfa-standard");
    const admin = await person(owner, "ADMIN", ["MEMBER", "ADMIN"]);
    expect((await login(admin.email)).body.data.state).toMatch(/^MFA_(REQUIRED|ENROLLMENT_REQUIRED)$/);
    expect((await login(owner.email)).body.data.state).toMatch(/^MFA_(REQUIRED|ENROLLMENT_REQUIRED)$/);
  });
});
