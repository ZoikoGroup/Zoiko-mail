import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { systemMailer } from "../src/common/mailer/system-mailer.js";
import { hashToken } from "../src/common/utils/tokenHash.js";
import { mailboxProvisioningService } from "../src/modules/mail/mailbox-provisioning.service.js";
import { stalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import { StalwartError, type MailHostingProvider } from "../src/modules/stalwart/stalwart.types.js";
import { authHeader, loginUser, registerUser, stepUpHeader } from "./helpers.js";

const app = createApp();
const GIB = 1024 ** 3;
const PASSWORD = "A-strong-Passw0rd!";
const mutableEnv = env as { SYSTEM_MAIL_ENABLED: boolean; STALWART_ACCOUNT_PROVISIONING: boolean; APP_URL: string };
const originalAppUrl = env.APP_URL;

/**
 * Setting up a new mailbox with a link, and no email at all.
 *
 * Create Email makes the mailbox and hands the Owner or Admin a setup link to
 * share. The person opens it, sees their new address, chooses a password, and
 * signs in with that address. None of it depends on email: SYSTEM_MAIL_ENABLED
 * governs sending, and nothing here sends. The link is a credential, so these
 * tests are as much about where it must not end up as about it working.
 */

/** A mail server that refuses everything, for the hosted-mode failure case. */
const refusingHost: MailHostingProvider = {
  name: "STALWART",
  isConfigured: () => true,
  findDomain: async () => {
    throw new StalwartError("no permission", "FORBIDDEN", false);
  },
  createDomain: async () => {
    throw new StalwartError("no permission", "FORBIDDEN", false);
  },
  findAccount: async () => null,
  getAccount: async () => null,
  countMessages: async () => {
    throw new StalwartError("not used", "COUNT_UNAVAILABLE", false);
  },
  deleteAccount: async () => {
    throw new StalwartError("not used", "UNEXPECTED_RESPONSE", false);
  },
  createAccount: async () => {
    throw new StalwartError("no permission", "FORBIDDEN", false);
  },
  setAccountPassword: async () => {
    throw new StalwartError("no permission", "FORBIDDEN", false);
  },
  probe: async () => ({ reachable: true, authenticated: true, managementCapability: false }),
};

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

beforeEach(() => {
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
  mutableEnv.STALWART_ACCOUNT_PROVISIONING = false;
  mutableEnv.APP_URL = originalAppUrl;
  mailboxProvisioningService.setProvider(refusingHost);
});

afterEach(() => {
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
  mutableEnv.STALWART_ACCOUNT_PROVISIONING = true;
  mutableEnv.APP_URL = originalAppUrl;
  mailboxProvisioningService.setProvider(stalwartClient);
  vi.restoreAllMocks();
});

async function workspace() {
  const suffix = uid();
  const owner = await registerUser(app, { email: `link-owner-${suffix}@zoiko.test` });
  const domainName = `${suffix}-acme.test`;
  const created = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName })
    .expect(201);
  const domainId = created.body.data.id as string;
  await prisma.mailDomain.update({ where: { id: domainId }, data: { verificationStatus: "VERIFIED", mxStatus: "VALID" } });
  return { owner, domainId, domainName, suffix };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

const provision = (token: string, w: Workspace, over: Record<string, unknown> = {}, key?: string) => {
  const req = request(app).post("/api/v1/mail/admin/mailboxes/provision").set(authHeader(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send({
    domainId: w.domainId,
    localPart: "support",
    displayName: "Support Team",
    quotaBytes: 5 * GIB,
    initialAccess: "INVITE",
    ...over,
  });
};

const regenerate = (token: string, mailboxId: string) =>
  request(app).post(`/api/v1/mail/admin/mailboxes/${mailboxId}/invitation/resend`).set(authHeader(token));

const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const lookup = (token: string) => request(app).post("/api/v1/membership/invitations/lookup").send({ token });
const claim = (token: string, password = PASSWORD) =>
  request(app).post("/api/v1/membership/invitations/claim").send({ invitationToken: token, password });

async function joinAs(w: Workspace, role: "ADMIN" | "MEMBER") {
  const user = await registerUser(app, { email: `link-${role.toLowerCase()}-${uid()}@zoiko.test` });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(w.owner.accessToken))
    .send({ email: user.email, role })
    .expect(201);
  const login = await loginUser(app, user.email, user.password, w.owner.tenantId, user.mfaSecret);
  return { ...user, token: login.accessToken as string };
}

describe("creating a mailbox gives a setup link, with no email involved", () => {
  for (const mailOn of [false, true]) {
    it(`returns a working link when SYSTEM_MAIL_ENABLED=${mailOn}, and sends nothing`, async () => {
      mutableEnv.SYSTEM_MAIL_ENABLED = mailOn;
      const send = vi.spyOn(systemMailer, "sendInvitationEmail").mockResolvedValue(undefined);
      const w = await workspace();

      const res = await provision(w.owner.accessToken, w).expect(201);
      expect(res.body.data).toMatchObject({
        address: `support@${w.domainName}`,
        invitationStatus: "PENDING",
        invitationError: null,
        invitationRecipient: `support@${w.domainName}`,
        membershipStatus: "INVITED",
        status: "INVITATION_PENDING",
      });
      expect(res.body.data.invitationLink).toMatch(/\/invitation\/accept\?token=[A-Za-z0-9_-]{22}$/);
      expect(send).not.toHaveBeenCalled();
      await lookup(tokenOf(res.body.data.invitationLink)).expect(200);
    });
  }

  it("no longer accepts a separate invitation address", async () => {
    const w = await workspace();
    const refused = await provision(w.owner.accessToken, w, { recoveryEmail: "someone@elsewhere.test" }).expect(400);
    expect(refused.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("builds the link from the configured site address, for development and for production", async () => {
    for (const site of ["http://localhost:3000", "https://sso.zoikomail.com"]) {
      mutableEnv.APP_URL = site;
      const w = await workspace();
      const res = await provision(w.owner.accessToken, w).expect(201);
      expect(res.body.data.invitationLink).toMatch(new RegExp(`^${site}/invitation/accept\\?token=[A-Za-z0-9_-]{22}$`));
    }
  });

  it("uses a long, unpredictable token and stores only its hash, with an expiry", async () => {
    const w = await workspace();
    const a = await provision(w.owner.accessToken, w, { localPart: "one" }).expect(201);
    const b = await provision(w.owner.accessToken, w, { localPart: "two" }).expect(201);
    const tokenA = tokenOf(a.body.data.invitationLink);
    const tokenB = tokenOf(b.body.data.invitationLink);
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]{22}$/); // 128 random bits, base64url
    expect(tokenA).not.toBe(tokenB);

    const membership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: w.owner.tenantId, user: { email: `one@${w.domainName}` } },
    });
    expect(membership.status).toBe("INVITED");
    expect(membership.inviteToken).toBe(hashToken(tokenA));
    expect(membership.inviteExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives no link when the mailbox goes to somebody who already signs in with that address", async () => {
    const w = await workspace();
    const existing = await registerUser(app, { email: `support@${w.domainName}` });
    await request(app)
      .post("/api/v1/membership/members")
      .set(authHeader(w.owner.accessToken))
      .send({ email: existing.email, role: "MEMBER" })
      .expect(201);
    const res = await provision(w.owner.accessToken, w).expect(201);
    expect(res.body.data).toMatchObject({ invitationStatus: "NOT_REQUIRED", status: "ACTIVE" });
    expect(res.body.data.invitationLink).toBeNull();
  });

  it("gives no link for a hosted mailbox the mail server refused, and one once it is finished", async () => {
    mutableEnv.STALWART_ACCOUNT_PROVISIONING = true;
    const w = await workspace();
    const failed = await provision(w.owner.accessToken, w).expect(202);
    expect(failed.body.data).toMatchObject({ provisioningStatus: "FAILED", status: "FAILED" });
    expect(failed.body.data.invitationLink).toBeNull();

    // Finished as a Zoiko-store mailbox: now there is somebody to set up.
    mutableEnv.STALWART_ACCOUNT_PROVISIONING = false;
    const retried = await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${failed.body.data.id}/provisioning/retry`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(retried.body.data.invitationLink).toMatch(/\/invitation\/accept\?token=[A-Za-z0-9_-]{22}$/);
  });
});

describe("the person sets their password from the link", () => {
  it("sees their new address, chooses a password and signs in with that address", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const token = tokenOf(res.body.data.invitationLink);

    const found = await lookup(token).expect(200);
    expect(found.body.data).toMatchObject({ email: `support@${w.domainName}`, needsPassword: true, alreadyAccepted: false });

    await claim(token).expect(200);
    const signedIn = await request(app).post("/api/v1/auth/login").send({ email: `support@${w.domainName}`, password: PASSWORD });
    expect(signedIn.status).toBe(200);

    const after = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/provisioning`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(after.body.data).toMatchObject({ status: "ACTIVE", membershipStatus: "ACTIVE", passwordSetup: "COMPLETED" });
  });

  it("refuses a password that breaks the rules, and leaves the link usable", async () => {
    const w = await workspace();
    const token = tokenOf((await provision(w.owner.accessToken, w).expect(201)).body.data.invitationLink);
    for (const weak of ["short1A", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHereAtAll"]) {
      await claim(token, weak).expect(400);
    }
    await claim(token).expect(200);
  });

  it("works once: a second use is told the setup is already done", async () => {
    const w = await workspace();
    const token = tokenOf((await provision(w.owner.accessToken, w).expect(201)).body.data.invitationLink);
    await claim(token).expect(200);
    const again = await claim(token, "Another-Passw0rd!").expect(409);
    expect(again.body.error.details.reason).toBe("ALREADY_ACCEPTED");
    expect((await lookup(token).expect(200)).body.data.alreadyAccepted).toBe(true);
    // The first password still stands: the link is not a standing password reset.
    const signedIn = await request(app).post("/api/v1/auth/login").send({ email: `support@${w.domainName}`, password: PASSWORD });
    expect(signedIn.status).toBe(200);
  });

  it("lets only one of two simultaneous submissions through", async () => {
    const w = await workspace();
    const token = tokenOf((await provision(w.owner.accessToken, w).expect(201)).body.data.invitationLink);
    const [a, b] = await Promise.all([claim(token), claim(token, "Second-Passw0rd!")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("refuses a link that was never issued", async () => {
    await lookup("not-a-real-token-but-long-enough").expect(401);
    await claim("not-a-real-token-but-long-enough").expect(401);
  });

  it("refuses an expired link, and an admin can issue a replacement that works", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const token = tokenOf(res.body.data.invitationLink);
    await prisma.tenantMembership.updateMany({
      where: { tenantId: w.owner.tenantId, status: "INVITED" },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });
    await lookup(token).expect(410);
    // Presenting it ends that invitation, so a replacement has to reopen it.
    await claim(token).expect(410);
    // Still waiting for its first sign-in, not ready.
    const waiting = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/provisioning`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(waiting.body.data).toMatchObject({ status: "INVITATION_PENDING", passwordSetup: "PENDING" });

    const fresh = await regenerate(w.owner.accessToken, res.body.data.id).expect(200);
    const newToken = tokenOf(fresh.body.data.invitationLink);
    await claim(token).expect(401);
    await claim(newToken).expect(200);
  });

  it("refuses a revoked link", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const token = tokenOf(res.body.data.invitationLink);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: res.body.data.id } });
    await request(app)
      .delete(`/api/v1/membership/invitations/${mailbox.membershipId}`)
      .set(authHeader(w.owner.accessToken))
      .expect((r) => expect(r.status).toBeLessThan(300));
    expect((await lookup(token)).status).toBeGreaterThanOrEqual(400);
    expect((await claim(token)).status).toBeGreaterThanOrEqual(400);
  });

  it("is answered with no caching and no referrer, by both forms of the lookup", async () => {
    const w = await workspace();
    const token = tokenOf((await provision(w.owner.accessToken, w).expect(201)).body.data.invitationLink);
    for (const res of [
      await lookup(token).expect(200),
      await request(app).get(`/api/v1/membership/invitations/lookup?token=${encodeURIComponent(token)}`).expect(200),
    ]) {
      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    }
    const claimed = await claim(token).expect(200);
    expect(claimed.headers["cache-control"]).toContain("no-store");
  });
});

describe("generating a new link", () => {
  it("replaces the old link, which stops working, and makes no second invitation", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const oldToken = tokenOf(res.body.data.invitationLink);

    const fresh = await regenerate(w.owner.accessToken, res.body.data.id).expect(200);
    const newToken = tokenOf(fresh.body.data.invitationLink);
    expect(newToken).not.toBe(oldToken);
    await lookup(oldToken).expect(401);
    await lookup(newToken).expect(200);

    const memberships = await prisma.tenantMembership.count({
      where: { tenantId: w.owner.tenantId, user: { email: `support@${w.domainName}` } },
    });
    expect(memberships).toBe(1);
  });

  it("refuses once the mailbox has been set up", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    await claim(tokenOf(res.body.data.invitationLink)).expect(200);
    const refused = await regenerate(w.owner.accessToken, res.body.data.id).expect(409);
    expect(refused.body.error.details.reason).toBe("INVITATION_NOT_PENDING");
  });

  it("replays a retried create without a second mailbox, and keeps the link out of the stored copy", async () => {
    const w = await workspace();
    const key = `setup-link-${uid()}`;
    const first = await provision(w.owner.accessToken, w, {}, key).expect(201);
    const token = tokenOf(first.body.data.invitationLink);

    const stored = await prisma.idempotencyRecord.findFirstOrThrow({ where: { tenantId: w.owner.tenantId, key } });
    expect(JSON.stringify(stored.responseBody)).not.toContain(token);
    expect(JSON.stringify(stored.responseBody)).not.toContain("invitationLink");

    const replay = await provision(w.owner.accessToken, w, {}, key).expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.data).not.toHaveProperty("invitationLink");
    expect(await prisma.mailbox.count({ where: { tenantId: w.owner.tenantId } })).toBe(1);
  });

  it("is never written to the audit log or any table in the clear", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const fresh = await regenerate(w.owner.accessToken, res.body.data.id).expect(200);
    const asText = (value: unknown) => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const events = await prisma.auditEvent.findMany({ where: { tenantId: w.owner.tenantId } });
    const memberships = await prisma.tenantMembership.findMany({ where: { tenantId: w.owner.tenantId } });
    const mailboxes = await prisma.mailbox.findMany({ where: { tenantId: w.owner.tenantId } });
    for (const link of [res.body.data.invitationLink, fresh.body.data.invitationLink]) {
      for (const haystack of [asText(events), asText(memberships), asText(mailboxes)]) {
        expect(haystack).not.toContain(tokenOf(link));
      }
    }
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(["MAILBOX_SETUP_LINK_ISSUED", "MAILBOX_SETUP_LINK_REGENERATED"])
    );
  });
});

describe("who may create and regenerate setup links", () => {
  it("lets an Admin of the workspace, and refuses a Member", async () => {
    const w = await workspace();
    const admin = await joinAs(w, "ADMIN");
    const member = await joinAs(w, "MEMBER");

    const byAdmin = await provision(admin.token, w, { localPart: "byadmin" }).expect(201);
    expect(byAdmin.body.data.invitationLink).toMatch(/\/invitation\/accept\?token=[A-Za-z0-9_-]{22}$/);
    await regenerate(admin.token, byAdmin.body.data.id).expect(200);

    const byMember = await provision(member.token, w, { localPart: "bymember" });
    expect(byMember.status).toBe(403);
    expect(JSON.stringify(byMember.body)).not.toContain("invitation/accept");
    await regenerate(member.token, byAdmin.body.data.id).expect(403);
  });

  it("treats another workspace's mailbox as absent", async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const res = await provision(mine.owner.accessToken, mine).expect(201);
    const refused = await regenerate(theirs.owner.accessToken, res.body.data.id).expect(404);
    expect(JSON.stringify(refused.body)).not.toContain("invitation/accept");
  });
});

describe("a setup link cannot be taken over from outside", () => {
  it("refuses another workspace inviting an address on a domain this one verified", async () => {
    const mine = await workspace();
    await provision(mine.owner.accessToken, mine).expect(201);
    const other = await workspace();

    // The attack: invite the pending address elsewhere, then use that
    // workspace's own link to set the password on the shared account.
    const refused = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(other.owner.accessToken))
      .send({ email: `support@${mine.domainName}`, role: "MEMBER" })
      .expect(409);
    expect(refused.body.error.details.reason).toBe("ADDRESS_MANAGED_ELSEWHERE");
    expect(JSON.stringify(refused.body)).not.toContain("invitation/accept");
    // Before any mailbox exists, too: the domain alone is enough.
    await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(other.owner.accessToken))
      .send({ email: `nobody-yet@${mine.domainName}`, role: "MEMBER" })
      .expect(409);
  });

  it("does not give a mailbox to an account that belongs to another workspace", async () => {
    const w = await workspace();
    // Somebody already signs in elsewhere with this address, and not here.
    await registerUser(app, { email: `boss@${w.domainName}` });
    const refused = await provision(w.owner.accessToken, w, { localPart: "boss" }).expect(409);
    expect(refused.body.error.details.reason).toBe("ADDRESS_MANAGED_ELSEWHERE");
    expect(await prisma.mailbox.count({ where: { tenantId: w.owner.tenantId } })).toBe(0);
  });

  it("does not let self-registration claim an account waiting for its setup link", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const refused = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: `support@${w.domainName}`, password: "Squatter-Passw0rd!", displayName: "Squatter" })
      .expect(409);
    expect(refused.body.error.details.reason).toBe("SETUP_LINK_REQUIRED");
    // The real person's link still works.
    await claim(tokenOf(res.body.data.invitationLink)).expect(200);
  });

  it("does not reopen an invitation an admin cancelled", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const mailbox = await prisma.mailbox.findUniqueOrThrow({ where: { id: res.body.data.id } });
    await request(app)
      .delete(`/api/v1/membership/invitations/${mailbox.membershipId}`)
      .set(authHeader(w.owner.accessToken))
      .expect((r) => expect(r.status).toBeLessThan(300));

    const refused = await regenerate(w.owner.accessToken, res.body.data.id).expect(409);
    expect(refused.body.error.details.reason).toBe("INVITATION_NOT_PENDING");
    const membership = await prisma.tenantMembership.findUniqueOrThrow({ where: { id: mailbox.membershipId! } });
    expect(membership.status).toBe("REMOVED");
  });

  it("ends the setup link when its mailbox is deleted", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    const token = tokenOf(res.body.data.invitationLink);
    await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${res.body.data.id}`)
      .set(authHeader(w.owner.accessToken))
      .set(await stepUpHeader(app, w.owner.accessToken))
      .expect((r) => expect(r.status).toBeLessThan(300));

    await lookup(token).expect(401);
    await claim(token).expect(401);
    // Recreating the address starts a fresh setup, not the old one.
    const again = await provision(w.owner.accessToken, w).expect(201);
    expect(again.body.data).toMatchObject({ status: "INVITATION_PENDING", passwordSetup: "PENDING" });
    await claim(tokenOf(again.body.data.invitationLink)).expect(200);
  });

  it("leaves an expired invitation pending, so a new link renews it", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w).expect(201);
    await prisma.tenantMembership.updateMany({
      where: { tenantId: w.owner.tenantId, status: "INVITED" },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });
    await claim(tokenOf(res.body.data.invitationLink)).expect(410);
    const membership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: w.owner.tenantId, user: { email: `support@${w.domainName}` } },
    });
    expect(membership.status).toBe("INVITED");
  });
});

describe("workspace invitations hand over the raw token only when nothing was emailed", () => {
  it("returns no token or link once the invitation went out by email", async () => {
    const w = await workspace();
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    vi.spyOn(systemMailer, "sendInvitationEmail").mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/v1/membership/invitations")
      .set(authHeader(w.owner.accessToken))
      .send({ email: `emailed-${uid()}@elsewhere.test`, role: "MEMBER" })
      .expect(201);
    expect(res.body.data.invitationToken).toBeNull();
    expect(res.body.data.invitationLink).toBeNull();
  });
});
