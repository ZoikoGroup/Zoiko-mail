import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { prisma } from "../src/config/prisma.js";

const app = createApp();

/**
 * Aliases and forwarding — Data Model §6.17, §6.18, Security §9.
 *
 * PRD §11.2 lists both as controlled-pilot Must-Have and neither existed:
 * no model, no columns, no endpoints. The rules worth pinning are the
 * routing guarantees (an address resolves to one place) and the audit
 * requirement — §9 singles out forwarding, because forwarding is how mail
 * quietly leaves an organisation.
 */

async function ownerWithMailbox(suffix: string) {
  const owner = await registerUser(app, { email: `af-owner-${suffix}@zoiko.test` });
  const created = await request(app)
    .post("/api/v1/mail/admin/mailboxes")
    .set(authHeader(owner.accessToken))
    .send({ membershipId: owner.membershipId })
    .expect(201);
  return { owner, mailboxId: created.body.data.id as string, address: created.body.data.address as string };
}

const addAlias = (token: string, mailboxId: string, address: string) =>
  request(app)
    .post(`/api/v1/mail/admin/mailboxes/${mailboxId}/aliases`)
    .set(authHeader(token))
    .send({ address });

const addForwarding = (
  token: string,
  mailboxId: string,
  body: Record<string, unknown>
) =>
  request(app)
    .post(`/api/v1/mail/admin/mailboxes/${mailboxId}/forwarding`)
    .set(authHeader(token))
    .send(body);

const routing = (token: string, mailboxId: string) =>
  request(app)
    .get(`/api/v1/mail/admin/mailboxes/${mailboxId}/routing`)
    .set(authHeader(token));

describe("aliases", () => {
  it("adds one and lists it against the mailbox", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);

    const created = await addAlias(owner.accessToken, mailboxId, `Sales-${suffix}@Acme.test`).expect(201);

    // Normalised on the way in, because routing is case-insensitive and the
    // uniqueness index is not.
    expect(created.body.data.address).toBe(`sales-${suffix}@acme.test`);

    const list = await routing(owner.accessToken, mailboxId).expect(200);
    expect(list.body.data.aliases).toHaveLength(1);
    expect(list.body.data.aliases[0].status).toBe("ACTIVE");
  });

  it("refuses an alias that is already in use", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    await addAlias(owner.accessToken, mailboxId, `dupe-${suffix}@acme.test`).expect(201);
    await addAlias(owner.accessToken, mailboxId, `dupe-${suffix}@acme.test`).expect(409);
  });

  it("refuses an alias taken by a mailbox in the same workspace", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId, address } = await ownerWithMailbox(suffix);

    // The alias-only unique index cannot see this collision, and it would
    // make routing ambiguous in the other direction.
    const refused = await addAlias(owner.accessToken, mailboxId, address).expect(409);
    expect(refused.body.error.message).toMatch(/belongs to a mailbox/i);
  });

  it("keeps alias addresses unique across workspaces, since routing is global", async () => {
    const suffix = String(Date.now());
    const first = await ownerWithMailbox(`a-${suffix}`);
    const second = await ownerWithMailbox(`b-${suffix}`);

    await addAlias(first.owner.accessToken, first.mailboxId, `shared-${suffix}@acme.test`).expect(201);

    // §6.17 makes this unique globally rather than per tenant: an address has
    // to route somewhere unambiguous.
    const refused = await addAlias(
      second.owner.accessToken,
      second.mailboxId,
      `shared-${suffix}@acme.test`
    ).expect(409);
    // Deliberately does not disclose that it belongs to another workspace.
    expect(JSON.stringify(refused.body)).not.toContain(first.owner.tenantId);
  });

  it("frees the address again once removed", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    const created = await addAlias(owner.accessToken, mailboxId, `reuse-${suffix}@acme.test`).expect(201);

    await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${mailboxId}/aliases/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Removal deletes the row rather than soft-deleting it, so the address is
    // reusable instead of being held hostage by a tombstone.
    await addAlias(owner.accessToken, mailboxId, `reuse-${suffix}@acme.test`).expect(201);
  });

  it("audits creation and removal", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    const created = await addAlias(owner.accessToken, mailboxId, `audit-${suffix}@acme.test`).expect(201);
    await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${mailboxId}/aliases/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const types = (
      await prisma.auditEvent.findMany({
        where: { tenantId: owner.tenantId, targetId: mailboxId },
        select: { eventType: true },
      })
    ).map((e) => e.eventType);

    expect(types).toContain("MAILBOX_ALIAS_CREATED");
    expect(types).toContain("MAILBOX_ALIAS_REMOVED");
  });
});

describe("forwarding", () => {
  it("adds a rule that keeps a copy by default", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);

    const created = await addForwarding(owner.accessToken, mailboxId, {
      forwardToAddress: `archive-${suffix}@example.test`,
    }).expect(201);

    // A rule that silently stops delivering to the mailbox is a surprising
    // default for something an operator sets on someone else's mail.
    expect(created.body.data.keepCopy).toBe(true);
    expect(created.body.data.status).toBe("ACTIVE");
  });

  it("honours keepCopy false when asked explicitly", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    const created = await addForwarding(owner.accessToken, mailboxId, {
      forwardToAddress: `redirect-${suffix}@example.test`,
      keepCopy: false,
    }).expect(201);
    expect(created.body.data.keepCopy).toBe(false);
  });

  it("refuses a mailbox forwarding to itself", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId, address } = await ownerWithMailbox(suffix);

    // A loop the uniqueness index cannot catch.
    await addForwarding(owner.accessToken, mailboxId, { forwardToAddress: address }).expect(422);
  });

  it("refuses the same destination twice", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    await addForwarding(owner.accessToken, mailboxId, {
      forwardToAddress: `twice-${suffix}@example.test`,
    }).expect(201);
    await addForwarding(owner.accessToken, mailboxId, {
      forwardToAddress: `twice-${suffix}@example.test`,
    }).expect(409);
  });

  it("audits creation, which §9 requires by name", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    await addForwarding(owner.accessToken, mailboxId, {
      forwardToAddress: `watched-${suffix}@example.test`,
      keepCopy: false,
    }).expect(201);

    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_FORWARDING_CREATED" },
    });
    const metadata = event?.metadata as { forwardTo?: string; keepCopy?: boolean };

    // Where the mail goes and whether a copy stays behind are the two facts
    // an investigator needs; a bare "forwarding changed" answers neither.
    expect(metadata.forwardTo).toBe(`watched-${suffix}@example.test`);
    expect(metadata.keepCopy).toBe(false);
    expect(event?.actorUserId).toBe(owner.userId);
  });

  it("removes a rule and audits that too", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    const created = await addForwarding(owner.accessToken, mailboxId, {
      forwardToAddress: `gone-${suffix}@example.test`,
    }).expect(201);

    await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${mailboxId}/forwarding/${created.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const list = await routing(owner.accessToken, mailboxId).expect(200);
    expect(list.body.data.forwarding).toHaveLength(0);

    const removed = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "MAILBOX_FORWARDING_REMOVED" },
    });
    expect(removed).not.toBeNull();
  });
});

describe("routing configuration stays inside its workspace", () => {
  it("refuses another workspace's mailbox", async () => {
    const suffix = String(Date.now());
    const { mailboxId } = await ownerWithMailbox(suffix);
    const outsider = await registerUser(app, { email: `af-outsider-${suffix}@zoiko.test` });

    await routing(outsider.accessToken, mailboxId).expect(404);
    await addAlias(outsider.accessToken, mailboxId, `sneak-${suffix}@acme.test`).expect(404);
    await addForwarding(outsider.accessToken, mailboxId, {
      forwardToAddress: `sneak-${suffix}@example.test`,
    }).expect(404);
  });

  it("refuses a member, who cannot manage mailbox settings", async () => {
    const suffix = String(Date.now());
    const { owner, mailboxId } = await ownerWithMailbox(suffix);
    const memberEmail = `af-member-${suffix}@zoiko.test`;
    const member = await registerUser(app, { email: memberEmail });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(owner.accessToken))
      .send({ email: memberEmail, role: "MEMBER" })
      .expect(201);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: memberEmail, password: member.password, tenantId: owner.tenantId })
      .expect(200);
    const session = login.body.data.session ?? login.body.data;

    // §9 puts aliases and forwarding under "Admin/Owner can manage".
    await addForwarding(session.accessToken, mailboxId, {
      forwardToAddress: `member-${suffix}@example.test`,
    }).expect(403);
  });
});
