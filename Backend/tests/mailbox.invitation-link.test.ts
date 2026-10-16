import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { systemMailer } from "../src/common/mailer/system-mailer.js";
import { mailboxProvisioningService } from "../src/modules/mail/mailbox-provisioning.service.js";
import { stalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import { StalwartError, type MailHostingProvider } from "../src/modules/stalwart/stalwart.types.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();
const GIB = 1024 ** 3;
const mutableEnv = env as { SYSTEM_MAIL_ENABLED: boolean; STALWART_ACCOUNT_PROVISIONING: boolean };

/**
 * With system email off there is no way for a new person to receive their
 * invitation, so Create Email hands the link to the Owner or Admin who made the
 * mailbox, once, to pass on themselves. The link is a credential, so these
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
  mailboxProvisioningService.setProvider(refusingHost);
});

afterEach(() => {
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
  mutableEnv.STALWART_ACCOUNT_PROVISIONING = true;
  mailboxProvisioningService.setProvider(stalwartClient);
  vi.restoreAllMocks();
});

async function workspace() {
  const suffix = uid();
  const owner = await registerUser(app, { email: `link-owner-${suffix}@zoiko.test` });
  const created = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName: `${suffix}-acme.test` })
    .expect(201);
  const domainId = created.body.data.id as string;
  await prisma.mailDomain.update({ where: { id: domainId }, data: { verificationStatus: "VERIFIED", mxStatus: "VALID" } });
  return { owner, domainId, suffix };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

const provision = (token: string, w: Workspace, over: Record<string, unknown> = {}, key?: string) => {
  const req = request(app).post("/api/v1/mail/admin/mailboxes/provision").set(authHeader(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send({
    domainId: w.domainId,
    localPart: "newhire",
    displayName: "New Hire",
    quotaBytes: 5 * GIB,
    initialAccess: "INVITE",
    recoveryEmail: `newhire.${w.suffix}@elsewhere.test`,
    ...over,
  });
};

/** JSON for a search, with the database's big integers turned into text. */
const asText = (value: unknown) => JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

const claim = (token: string) =>
  request(app).post("/api/v1/membership/invitations/claim").send({ invitationToken: token, password: "A-strong-Passw0rd!" });

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

describe("the invitation link, when email delivery is off", () => {
  it("is returned to the admin who created the mailbox, and it really works", async () => {
    const w = await workspace();
    const send = vi.spyOn(systemMailer, "sendInvitationEmail");

    const res = await provision(w.owner.accessToken, w).expect(201);
    expect(res.body.data).toMatchObject({ invitationStatus: "PENDING", invitationError: "SYSTEM_MAIL_DISABLED" });
    const link = res.body.data.invitationLink as string;
    expect(link.startsWith(`${env.APP_URL}/accept-invitation?token=`)).toBe(true);
    // Nothing was emailed: the mailer is not called even in its log-only mode.
    expect(send).not.toHaveBeenCalled();

    await claim(tokenOf(link)).expect(200);
    const after = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/provisioning`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(after.body.data.membershipStatus).toBe("ACTIVE");
    // Reading the mailbox later never shows the link again.
    expect(after.body.data).not.toHaveProperty("invitationLink");
  });

  it("is kept out of the stored replay copy, the audit log and every table", async () => {
    const w = await workspace();
    const key = `link-replay-${uid()}`;

    const first = await provision(w.owner.accessToken, w, {}, key).expect(201);
    const token = tokenOf(first.body.data.invitationLink);

    // The caller got it; the 24-hour copy kept for replays did not.
    const stored = await prisma.idempotencyRecord.findFirstOrThrow({ where: { tenantId: w.owner.tenantId, key } });
    expect(JSON.stringify(stored.responseBody)).not.toContain(token);
    expect(JSON.stringify(stored.responseBody)).not.toContain("invitationLink");

    const replay = await provision(w.owner.accessToken, w, {}, key).expect(201);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.data).not.toHaveProperty("invitationLink");

    // Audit: that it was shown is recorded, the link is not.
    const events = await prisma.auditEvent.findMany({ where: { tenantId: w.owner.tenantId } });
    expect(asText(events)).not.toContain(token);
    const notSent = events.find((e) => e.eventType === "MAILBOX_INVITATION_NOT_SENT");
    expect(notSent?.metadata).toMatchObject({ reason: "SYSTEM_MAIL_DISABLED", linkShownToAdmin: true });

    // Database: only the hash of the token is stored, never the token.
    const membership = await prisma.tenantMembership.findMany({ where: { tenantId: w.owner.tenantId } });
    const mailbox = await prisma.mailbox.findMany({ where: { tenantId: w.owner.tenantId } });
    expect(asText(membership)).not.toContain(token);
    expect(asText(mailbox)).not.toContain(token);
  });

  it("is not returned when the invitation goes out by email", async () => {
    const w = await workspace();
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    const send = vi.spyOn(systemMailer, "sendInvitationEmail").mockResolvedValue(undefined);

    const res = await provision(w.owner.accessToken, w).expect(201);
    expect(res.body.data.invitationStatus).toBe("SENT");
    expect(res.body.data.invitationLink).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("is not returned for somebody who already belongs to the workspace", async () => {
    const w = await workspace();
    const res = await provision(w.owner.accessToken, w, { recoveryEmail: w.owner.email }).expect(201);
    expect(res.body.data.invitationStatus).toBe("NOT_REQUIRED");
    expect(res.body.data.invitationLink).toBeNull();
  });

  it("is not returned for a hosted mailbox that failed on the mail server", async () => {
    mutableEnv.STALWART_ACCOUNT_PROVISIONING = true;
    const w = await workspace();

    const res = await provision(w.owner.accessToken, w).expect(202);
    expect(res.body.data).toMatchObject({ provisioningStatus: "FAILED" });
    // The invitation is only owed once the mailbox exists, so there is nothing to hand over.
    expect(res.body.data.invitationLink).toBeNull();
  });

  it("is replaced by a fresh one on resend, and the old one stops working", async () => {
    const w = await workspace();
    const created = await provision(w.owner.accessToken, w).expect(201);
    const oldToken = tokenOf(created.body.data.invitationLink);

    const resent = await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${created.body.data.id}/invitation/resend`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    const newToken = tokenOf(resent.body.data.invitationLink);
    expect(newToken).not.toBe(oldToken);

    const stale = await claim(oldToken);
    expect(stale.status).toBeGreaterThanOrEqual(400);
    await claim(newToken).expect(200);
  });

  it("is given to an Admin who creates the mailbox, and to nobody without that permission", async () => {
    const w = await workspace();
    const admin = await joinAs(w, "ADMIN");
    const member = await joinAs(w, "MEMBER");

    const byAdmin = await provision(admin.token, w, { localPart: "byadmin", recoveryEmail: `byadmin.${w.suffix}@elsewhere.test` }).expect(201);
    expect(typeof byAdmin.body.data.invitationLink).toBe("string");

    const byMember = await provision(member.token, w, { localPart: "bymember", recoveryEmail: `bymember.${w.suffix}@elsewhere.test` });
    expect(byMember.status).toBe(403);
    expect(JSON.stringify(byMember.body)).not.toContain("accept-invitation");

    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${byAdmin.body.data.id}/invitation/resend`)
      .set(authHeader(member.token))
      .expect(403);
  });
});
