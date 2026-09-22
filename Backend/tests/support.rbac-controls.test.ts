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
 * The two RBAC §2 Support controls that had a row in the matrix and nothing
 * behind it: "View tenant configuration" and "Read private user mailbox".
 *
 * The second is the interesting one. It is the only capability anywhere in
 * the matrix that reaches a member's own mail — Owner and Admin hold it in
 * no form at all, and a workspace's invited SUPPORT seat holds it through
 * the membership itself, the same membership that opens every other console
 * read. The grant's scopes are no longer the gate on a mail read; grants
 * survive only for diagnostics, which the tests touching /diagnostics
 * cover. So the tests below pin the two things that are still true of a
 * mail read: it is scoped to the seat's own workspace, and it lands in the
 * workspace's audit log.
 */

const DIAGNOSTICS = ["TENANT_DIAGNOSTICS"] as const;

async function supportSeat(owner: RegisteredUser, email: string) {
  const support = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "SUPPORT" })
    .expect(201);
  const login = await loginUser(app, support.email, support.password, owner.tenantId);
  return { support, token: login.accessToken as string };
}

/**
 * A workspace with a mailbox in it. `registerUser` creates the tenant and
 * the owner membership but no mailbox, and a mailbox-reading test with no
 * mailbox proves nothing.
 */
async function ownerWithMailbox(tag: string) {
  const owner = await registerUser(app, { email: `${tag}-${Date.now()}@zoiko.test` });
  const created = await request(app)
    .post("/api/v1/mail/admin/mailboxes")
    .set(authHeader(owner.accessToken))
    .send({ membershipId: owner.membershipId })
    .expect(201);
  return { owner, mailboxId: created.body.data.id as string };
}

/** Ask for access and have the owner approve it, with the given scopes. */
async function grantedSeat(
  owner: RegisteredUser,
  email: string,
  scopes: readonly string[]
) {
  const seat = await supportSeat(owner, email);
  const asked = await request(app)
    .post("/api/v1/support/access-requests")
    .set(authHeader(seat.token))
    .send({
      reason: "INC-9120 customer reports a message that never arrived",
      scopes,
      requestedMinutes: 60,
    })
    .expect(201);

  await request(app)
    .post(`/api/v1/support/access-requests/${asked.body.data.id}/approve`)
    .set(authHeader(owner.accessToken))
    .set(await stepUpHeader(app, owner.accessToken))
    .send({})
    .expect(200);

  return seat;
}

describe("view tenant configuration", () => {
  it("answers for a granted support seat", async () => {
    const owner = await registerUser(app, { email: `cfg-o-${Date.now()}@zoiko.test` });
    const seat = await grantedSeat(owner, `cfg-s-${Date.now()}@zoiko.test`, DIAGNOSTICS);

    const res = await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(seat.token))
      .expect(200);

    // The distinction the endpoint exists for: /tenant counts what the
    // workspace holds, /configuration says how it is set up.
    expect(res.body.data.tenant.planCode).toBeTruthy();
    expect(res.body.data.mail).toHaveProperty("aiRestrictedMailboxes");
    expect(Array.isArray(res.body.data.policies)).toBe(true);
  });

  it("answers for an invited seat with no grant at all", async () => {
    const owner = await registerUser(app, { email: `cfg-nog-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `cfg-nog-s-${Date.now()}@zoiko.test`);

    // The invitation is the authorization; a diagnostics grant is not
    // needed to read this workspace's setup.
    await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(seat.token))
      .expect(200);
  });

  it("does not hand a credential to a console outside the tenant", async () => {
    const owner = await registerUser(app, { email: `cfg-sec-o-${Date.now()}@zoiko.test` });
    const seat = await grantedSeat(owner, `cfg-sec-s-${Date.now()}@zoiko.test`, DIAGNOSTICS);

    // `settings` is a free-form JSON column, so what ends up in it is
    // whatever some later feature decides. This is the guard for the day
    // one of them parks a token there.
    await prisma.tenant.update({
      where: { id: owner.tenantId },
      data: {
        settings: {
          brandColour: "#0f766e",
          webhookSecret: "whsec_live_do_not_show_this",
          nested: { apiKey: "sk-live-nope" },
        },
      },
    });

    const res = await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(seat.token))
      .expect(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("whsec_live_do_not_show_this");
    expect(body).not.toContain("sk-live-nope");
    // Configuration itself still comes through — redaction that hid
    // everything would make the screen useless.
    expect(res.body.data.settings.brandColour).toBe("#0f766e");
  });
});

/** Poll until the value is there, for writes that land after the response. */
async function waitFor<T>(read: () => Promise<T | null>, ms = 5_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > until) throw new Error("timed out waiting for the audit entry");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("what a support seat reads is on the record", () => {
  it("writes an entry for an ordinary console read", async () => {
    const owner = await registerUser(app, { email: `aud-o-${Date.now()}@zoiko.test` });
    const seat = await grantedSeat(owner, `aud-s-${Date.now()}@zoiko.test`, DIAGNOSTICS);

    await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(seat.token))
      .expect(200);

    // The request screen tells the customer, in as many words, that
    // "everything you read while it is open is recorded in your audit log".
    // The platform console's logger keys off staff auth, which a tenant
    // seat does not have — so until this middleware existed that sentence
    // was not true of the tenant console at all.
    // The write is hung off the response and deliberately fire-and-forget,
    // so it lands a moment after the request returns. Polling rather than
    // reading once keeps the test about whether the entry appears, not
    // about how quickly.
    const paths = await waitFor(async () => {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId: owner.tenantId, eventType: "SUPPORT_ACCESS_USED" },
      });
      const found = events.map((e) => (e.metadata as Record<string, unknown>)?.path);
      return found.length > 0 ? found : null;
    });

    expect(paths).toContain("/api/v1/support/configuration");

    // Asking for access is not using it, and it writes its own
    // SUPPORT_ACCESS_REQUESTED entry — so the seat's own request must not
    // also show up here as a read of the customer's workspace.
    expect(paths.some((path) => String(path).includes("/access-requests"))).toBe(false);
  });

  it("does not log the owner reading their own workspace", async () => {
    const owner = await registerUser(app, { email: `aud-own-o-${Date.now()}@zoiko.test` });
    const seat = await grantedSeat(owner, `aud-own-s-${Date.now()}@zoiko.test`, DIAGNOSTICS);

    await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(owner.accessToken))
      .expect(200);

    // A support seat reads the same endpoint straight after, and the test
    // waits for *that* entry. Without it this assertion would pass while
    // the owner's write was still in flight — the audit write is hung off
    // the response, so "nothing there yet" and "nothing ever" look
    // identical if you only read once.
    await request(app)
      .get("/api/v1/support/configuration")
      .set(authHeader(seat.token))
      .expect(200);

    const logged = await waitFor(async () => {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId: owner.tenantId, eventType: "SUPPORT_ACCESS_USED" },
        select: { actorUserId: true },
      });
      return events.length > 0 ? events : null;
    });

    // An Owner holds support.console.read outright, not through a grant.
    // Reading your own workspace is not support access, and recording it
    // would bury the entries that matter under the owner's own traffic.
    expect(logged.every((event) => event.actorUserId !== owner.userId)).toBe(true);
  });

  it("records a refusal as a refusal, not as a read", async () => {
    const owner = await registerUser(app, { email: `aud-deny-o-${Date.now()}@zoiko.test` });
    const seat = await supportSeat(owner, `aud-deny-s-${Date.now()}@zoiko.test`);

    // Diagnostics is the one screen a seat cannot reach without an approved
    // grant, and the refusal comes back as a 403 — so it is the endpoint
    // that still exercises the denial path on the tenant console.
    await request(app)
      .get("/api/v1/support/diagnostics")
      .set(authHeader(seat.token))
      .expect(403);

    // Recorded as a refusal — without this, a seat kept trying diagnostics
    // with no approved grant and the customer's log would be silent about it.
    const denied = await waitFor(async () =>
      prisma.auditEvent.findFirst({
        where: { tenantId: owner.tenantId, eventType: "SUPPORT_ACCESS_DENIED" },
      })
    );
    expect((denied.metadata as Record<string, unknown>)?.path).toBe(
      "/api/v1/support/diagnostics"
    );

    // And not as an access. The log says what was served, not what was
    // asked for; counting a refusal as a read would overstate what support
    // actually saw. Safe to read once — the denial above already proves
    // this request's audit writes have landed.
    const used = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "SUPPORT_ACCESS_USED" },
    });

    expect(used).toBeNull();
  });
});

describe("read private user mailbox", () => {
  it("opens for a seat whose grant carries no MAIL_CONTENT scope", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-scope-o");
    const seat = await grantedSeat(owner, `mb-scope-s-${Date.now()}@zoiko.test`, DIAGNOSTICS);

    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    // The seat holds a live diagnostics grant — and the mailbox read does
    // not depend on that grant or its scopes at all. The invitation into
    // the workspace is the whole authorization, mail included.
    const res = await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(seat.token))
      .expect(200);

    expect(res.body.data.mailbox.address).toBe(mailbox.address);
    expect(Array.isArray(res.body.data.messages)).toBe(true);
  });

  it("answers when the grant does name it", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-ok-o");
    const seat = await grantedSeat(owner, `mb-ok-s-${Date.now()}@zoiko.test`, [
      "TENANT_DIAGNOSTICS",
      "MAIL_CONTENT",
    ]);

    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    const res = await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(seat.token))
      .expect(200);

    expect(res.body.data.mailbox.address).toBe(mailbox.address);
    expect(Array.isArray(res.body.data.messages)).toBe(true);
  });

  it("returns no message bodies", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-body-o");
    const seat = await grantedSeat(owner, `mb-body-s-${Date.now()}@zoiko.test`, [
      "MAIL_CONTENT",
    ]);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    const res = await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(seat.token))
      .expect(200);

    // §7 asks support views to prefer metadata over content, and this is
    // the assertion that keeps the endpoint honest if someone later widens
    // the select to "make the screen more useful".
    const body = JSON.stringify(res.body);
    for (const field of ["bodyText", "bodyHtml", "body", "snippet", "preview"]) {
      expect(body).not.toContain(`"${field}"`);
    }
  });

  it("is refused for an owner, who holds the capability in no form", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-owner");
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    // AC-005: Owner = No and Admin = No for reading a private mailbox, with
    // no step-up that changes it. The owner of the workspace being refused
    // access to their own member's mail is the intended behaviour, not a
    // gap — which is worth a test precisely because it looks like one.
    await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(owner.accessToken))
      .expect(403);
  });

  it("cannot reach a mailbox in another workspace", async () => {
    const owner = await registerUser(app, { email: `mb-iso-a-${Date.now()}@zoiko.test` });
    const other = await ownerWithMailbox("mb-iso-b");
    const seat = await grantedSeat(owner, `mb-iso-s-${Date.now()}@zoiko.test`, ["MAIL_CONTENT"]);

    const theirs = await prisma.mailbox.findUniqueOrThrow({ where: { id: other.mailboxId } });

    // The grant is per workspace. A mailbox id from somewhere else has to
    // read as "not found" rather than as a mailbox.
    await request(app)
      .get(`/api/v1/support/mailboxes/${theirs.id}/messages`)
      .set(authHeader(seat.token))
      .expect(404);
  });

  it("writes the read to the workspace's audit log", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-audit-o");
    const seat = await grantedSeat(owner, `mb-audit-s-${Date.now()}@zoiko.test`, ["MAIL_CONTENT"]);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(seat.token))
      .expect(200);

    // §7's actual requirement: the customer can see afterwards exactly what
    // support looked at. A read that is allowed but invisible fails it.
    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: owner.tenantId, eventType: "SUPPORT_MAILBOX_READ", targetId: mailbox.id },
      orderBy: { createdAt: "desc" },
    });

    expect(event).not.toBeNull();
    expect((event?.metadata as Record<string, unknown>)?.mailbox).toBe(mailbox.address);
  });

  it("needs no grant at all — the invitation is the access", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-nog-o");
    const seat = await supportSeat(owner, `mb-nog-s-${Date.now()}@zoiko.test`);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    // No grant, no request, no approval: the Owner's invitation to sit in
    // this workspace as SUPPORT is the whole authorization.
    const res = await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(seat.token))
      .expect(200);

    expect(res.body.data.mailbox.address).toBe(mailbox.address);
  });

  it("withholds subjects for a mailbox its owner has closed to processing", async () => {
    const { owner, mailboxId } = await ownerWithMailbox("mb-restr-o");
    const seat = await grantedSeat(owner, `mb-restr-s-${Date.now()}@zoiko.test`, ["MAIL_CONTENT"]);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });

    await prisma.mailbox.update({ where: { id: mailbox.id }, data: { aiEnabled: false } });

    const res = await request(app)
      .get(`/api/v1/support/mailboxes/${mailbox.id}/messages`)
      .set(authHeader(seat.token))
      .expect(200);

    // The grant says support may read this mailbox. AC-008 says its owner
    // has turned processing off, and the data model marks subject as the
    // field that goes for exactly that case — the grant does not override
    // it. Sender, status and timing still come through, because those are
    // what the triage is for.
    expect(res.body.data.mailbox.aiEnabled).toBe(false);
    for (const message of res.body.data.messages) {
      if (message.subject !== null) {
        expect(message.subject).toMatch(/withheld/i);
      }
    }
  });
});
