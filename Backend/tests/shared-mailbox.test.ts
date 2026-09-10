import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Shared mailboxes — Security §10 and §9.1.
 *
 * `Mailbox.membershipId` was NOT NULL UNIQUE, so every mailbox belonged to
 * exactly one person and a shared mailbox could not be represented at all.
 * Two admin screens said so on their own faces. It is nullable now, and a
 * mailbox with no membership is one the workspace owns.
 *
 * The rules that matter here are that assignment is required before access,
 * that read/send/manage/assign are separable, and that revoking access takes
 * effect on the next request rather than whenever a cache happens to expire.
 */

/** An owner plus a member of the same workspace, each with a session. */
async function workspace(suffix: string) {
  const owner = await registerUser(app, { email: `sm-owner-${suffix}@zoiko.test` });
  const memberEmail = `sm-member-${suffix}@zoiko.test`;
  const member = await registerUser(app, { email: memberEmail });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email: memberEmail, role: "MEMBER" })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
    .expect(200);
  const session = login.body.data.session ?? login.body.data;
  return {
    owner,
    member: {
      ...member,
      accessToken: session.accessToken as string,
      membershipId: added.body.data.id as string,
    },
  };
}

const createShared = (token: string, address: string, type = "SHARED") =>
  request(app)
    .post("/api/v1/mail/admin/shared-mailboxes")
    .set(authHeader(token))
    .send({ address, type });

const assign = (
  token: string,
  mailboxId: string,
  body: Record<string, unknown>
) =>
  request(app)
    .post(`/api/v1/mail/admin/shared-mailboxes/${mailboxId}/assignees`)
    .set(authHeader(token))
    .send(body);

const readMailbox = (token: string, mailboxId: string) =>
  request(app)
    .get(`/api/v1/mail?folder=INBOX&mailboxId=${mailboxId}`)
    .set(authHeader(token));

describe("creating a shared mailbox", () => {
  it("creates one that belongs to the workspace rather than to a person", async () => {
    const { owner } = await workspace(String(Date.now()));

    const created = await createShared(owner.accessToken, "support@acme.test").expect(201);

    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: created.body.data.id } });
    // The whole point of the schema change: no owning membership.
    expect(row.membershipId).toBeNull();
    expect(row.type).toBe("SHARED");
    expect(row.address).toBe("support@acme.test");
  });

  it("creates a distribution address as its own type", async () => {
    const { owner } = await workspace(String(Date.now()));
    const created = await createShared(owner.accessToken, "all@acme.test", "DISTRIBUTION").expect(201);
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row.type).toBe("DISTRIBUTION");
  });

  it("refuses an address already in use", async () => {
    const { owner } = await workspace(String(Date.now()));
    await createShared(owner.accessToken, "dupe@acme.test").expect(201);
    await createShared(owner.accessToken, "dupe@acme.test").expect(409);
  });

  it("lists shared mailboxes with the number of people assigned", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `team-${suffix}@acme.test`).expect(201);
    await assign(owner.accessToken, created.body.data.id, { membershipId: member.membershipId }).expect(200);

    const list = await request(app)
      .get("/api/v1/mail/admin/shared-mailboxes")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const group = list.body.data.groups.find((g: { id: string }) => g.id === created.body.data.id);
    expect(group.memberCount).toBe(1);
    expect(group.status).toBe("ACTIVE");
  });

  it("keeps personal mailboxes out of the shared listing", async () => {
    const suffix = String(Date.now());
    const { owner } = await workspace(suffix);
    await request(app)
      .post("/api/v1/mail/admin/mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ membershipId: owner.membershipId })
      .expect(201);

    const list = await request(app)
      .get("/api/v1/mail/admin/shared-mailboxes")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(list.body.data.groups).toHaveLength(0);
  });

  it("refuses a member, who does not hold workspace.groups.manage", async () => {
    const suffix = String(Date.now());
    const { member } = await workspace(suffix);
    await createShared(member.accessToken, `nope-${suffix}@acme.test`).expect(403);
  });
});

describe("assignment is required before access", () => {
  it("hides an unassigned shared mailbox rather than refusing it", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `hidden-${suffix}@acme.test`).expect(201);

    // 404, not 403: whether a particular shared mailbox exists is itself
    // something an unassigned member has no claim to know.
    await readMailbox(member.accessToken, created.body.data.id).expect(404);
  });

  it("opens it once the member is assigned", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `open-${suffix}@acme.test`).expect(201);

    await assign(owner.accessToken, created.body.data.id, {
      membershipId: member.membershipId,
      canRead: true,
    }).expect(200);

    const inbox = await readMailbox(member.accessToken, created.body.data.id).expect(200);
    expect(inbox.body.data.items).toEqual([]);
  });

  it("closes it again the moment access is revoked", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `revoke-${suffix}@acme.test`).expect(201);
    const mailboxId = created.body.data.id;

    await assign(owner.accessToken, mailboxId, { membershipId: member.membershipId }).expect(200);
    await readMailbox(member.accessToken, mailboxId).expect(200);

    await request(app)
      .delete(`/api/v1/mail/admin/shared-mailboxes/${mailboxId}/assignees/${member.membershipId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    // §10: "removing user access must invalidate active shared mailbox
    // sessions". Access is read per request rather than cached, so the very
    // next call fails — the member's token is unchanged and still valid.
    await readMailbox(member.accessToken, mailboxId).expect(404);
  });
});

describe("the four permissions are separable", () => {
  it("grants read without send by default", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `ro-${suffix}@acme.test`).expect(201);

    const granted = await assign(owner.accessToken, created.body.data.id, {
      membershipId: member.membershipId,
    }).expect(200);

    // Omitted permissions default closed: widening access should be typed
    // out rather than inherited.
    expect(granted.body.data).toMatchObject({
      canRead: true,
      canSend: false,
      canManage: false,
      canAssign: false,
    });
  });

  it("records each permission independently", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `perm-${suffix}@acme.test`).expect(201);

    const granted = await assign(owner.accessToken, created.body.data.id, {
      membershipId: member.membershipId,
      canRead: false,
      canSend: true,
      canManage: true,
      canAssign: false,
    }).expect(200);

    expect(granted.body.data).toMatchObject({
      canRead: false,
      canSend: true,
      canManage: true,
      canAssign: false,
    });
  });

  it("refuses a read to someone assigned without it", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `nosend-${suffix}@acme.test`).expect(201);

    await assign(owner.accessToken, created.body.data.id, {
      membershipId: member.membershipId,
      canRead: false,
      canSend: true,
    }).expect(200);

    // Assigned, but not for reading — 403 rather than 404, because they do
    // know the mailbox exists.
    const refused = await readMailbox(member.accessToken, created.body.data.id).expect(403);
    expect(refused.body.error.details.permission).toBe("canRead");
  });

  it("treats re-assigning as a permission change, not a duplicate", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `edit-${suffix}@acme.test`).expect(201);

    await assign(owner.accessToken, created.body.data.id, {
      membershipId: member.membershipId,
    }).expect(200);
    const updated = await assign(owner.accessToken, created.body.data.id, {
      membershipId: member.membershipId,
      canSend: true,
    }).expect(200);

    expect(updated.body.data.canSend).toBe(true);
    const rows = await prisma.mailboxAccess.count({
      where: { mailboxId: created.body.data.id, membershipId: member.membershipId },
    });
    expect(rows).toBe(1);
  });
});

describe("assignment changes leave evidence", () => {
  it("audits a grant, a widening and a revocation", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const created = await createShared(owner.accessToken, `audit-${suffix}@acme.test`).expect(201);
    const mailboxId = created.body.data.id;

    await assign(owner.accessToken, mailboxId, { membershipId: member.membershipId }).expect(200);
    await assign(owner.accessToken, mailboxId, {
      membershipId: member.membershipId,
      canSend: true,
    }).expect(200);
    await request(app)
      .delete(`/api/v1/mail/admin/shared-mailboxes/${mailboxId}/assignees/${member.membershipId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const events = await prisma.auditEvent.findMany({
      where: { tenantId: owner.tenantId, targetId: mailboxId },
      orderBy: { createdAt: "asc" },
      select: { eventType: true, metadata: true },
    });
    const types = events.map((e) => e.eventType);

    // §10 requires creation and removal to be audited at minimum.
    expect(types).toContain("SHARED_MAILBOX_CREATED");
    expect(types).toContain("SHARED_MAILBOX_ACCESS_GRANTED");
    expect(types).toContain("SHARED_MAILBOX_ACCESS_CHANGED");
    expect(types).toContain("SHARED_MAILBOX_ACCESS_REVOKED");

    // The widening carries what it widened from, so it reads as a change
    // rather than as a fresh grant.
    const changed = events.find((e) => e.eventType === "SHARED_MAILBOX_ACCESS_CHANGED");
    const metadata = changed?.metadata as { before?: { canSend?: boolean }; after?: { canSend?: boolean } };
    expect(metadata.before?.canSend).toBe(false);
    expect(metadata.after?.canSend).toBe(true);
  });
});

describe("shared mailboxes stay inside their workspace", () => {
  it("will not let another workspace read or assign one", async () => {
    const suffix = String(Date.now());
    const { owner } = await workspace(suffix);
    const outsider = await registerUser(app, { email: `sm-outsider-${suffix}@zoiko.test` });
    const created = await createShared(owner.accessToken, `iso-${suffix}@acme.test`).expect(201);
    const mailboxId = created.body.data.id;

    await request(app)
      .get(`/api/v1/mail/admin/shared-mailboxes/${mailboxId}/assignees`)
      .set(authHeader(outsider.accessToken))
      .expect(404);

    await assign(outsider.accessToken, mailboxId, {
      membershipId: outsider.membershipId,
    }).expect(404);

    await readMailbox(outsider.accessToken, mailboxId).expect(404);
  });

  it("refuses to assign a membership from another workspace", async () => {
    const suffix = String(Date.now());
    const { owner } = await workspace(suffix);
    const outsider = await registerUser(app, { email: `sm-foreign-${suffix}@zoiko.test` });
    const created = await createShared(owner.accessToken, `foreign-${suffix}@acme.test`).expect(201);

    await assign(owner.accessToken, created.body.data.id, {
      membershipId: outsider.membershipId,
    }).expect(404);
  });
});

describe("a personal mailbox is unaffected", () => {
  it("still opens without any assignment", async () => {
    const suffix = String(Date.now());
    const { owner } = await workspace(suffix);
    const own = await request(app)
      .post("/api/v1/mail/admin/mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ membershipId: owner.membershipId })
      .expect(201);

    // Nobody has to be assigned to their own mailbox, and the default
    // listing still resolves without a mailboxId at all.
    await readMailbox(owner.accessToken, own.body.data.id).expect(200);
    await request(app)
      .get("/api/v1/mail?folder=INBOX")
      .set(authHeader(owner.accessToken))
      .expect(200);
  });

  it("is not readable by another member just because they are in the workspace", async () => {
    const suffix = String(Date.now());
    const { owner, member } = await workspace(suffix);
    const own = await request(app)
      .post("/api/v1/mail/admin/mailboxes")
      .set(authHeader(owner.accessToken))
      .send({ membershipId: owner.membershipId })
      .expect(201);

    // AC-005: a workspace role is not mailbox access.
    await readMailbox(member.accessToken, own.body.data.id).expect(404);
  });
});
