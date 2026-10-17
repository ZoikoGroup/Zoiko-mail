import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { hashPassword } from "../src/common/utils/password.js";
import { mailboxProvisioningService } from "../src/modules/mail/mailbox-provisioning.service.js";
import { stalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import { ProviderMailService } from "../src/modules/provider-mail/provider-mail.service.js";
import { authHeader, registerUser, stepUpHeader } from "./helpers.js";

const app = createApp();
const GIB = 1024 ** 3;
const PASSWORD = "Password123!";
const NEW_PASSWORD = "Fresh-Passw0rd";

/**
 * Admin-created mailboxes working in the Member workspace, with Zoiko as the
 * mail store (decision D1, STALWART_ACCOUNT_PROVISIONING=false).
 *
 * Create Email used to refuse every mailbox with 503 whenever no mail server
 * was configured, which is exactly the D1 deployment: Zoiko stores the mail
 * and the server holds no accounts. This walks the whole chain an admin and
 * a member actually use — create, set the password, sign in with the mailbox
 * address, send, receive, reply.
 */

/** A mail server that must never be called: any use fails the test. */
const untouchableHost = new Proxy(
  { name: "STALWART", isConfigured: () => false },
  {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      return () => {
        throw new Error(`The mail server was called (${String(key)}) for a Zoiko-store mailbox`);
      };
    },
  }
) as never;

const mutableEnv = env as { STALWART_ACCOUNT_PROVISIONING: boolean; SYSTEM_MAIL_ENABLED: boolean };
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

beforeEach(() => {
  mailboxProvisioningService.setProvider(untouchableHost);
  mutableEnv.STALWART_ACCOUNT_PROVISIONING = false;
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
});
afterEach(() => {
  mailboxProvisioningService.setProvider(stalwartClient);
  mutableEnv.STALWART_ACCOUNT_PROVISIONING = true;
  vi.restoreAllMocks();
});

async function workspaceWithDomain() {
  const owner = await registerUser(app, { email: `${unique("zs-owner")}@zoiko.test` });
  const domainName = `${unique("zs")}.test`;
  const created = await request(app).post("/api/v1/domains").set(authHeader(owner.accessToken)).send({ domainName }).expect(201);
  await prisma.mailDomain.update({ where: { id: created.body.data.id }, data: { verificationStatus: "VERIFIED", mxStatus: "VALID" } });
  return { owner, domainId: created.body.data.id as string, domainName };
}

/** An existing account that is an active member of the workspace. */
async function activeMember(ownerToken: string) {
  const login = `${unique("person")}@personal.test`;
  await prisma.appUser.create({
    data: { email: login, displayName: "Person", passwordHash: await hashPassword(PASSWORD), status: "ACTIVE", emailVerifiedAt: new Date() },
  });
  await request(app).post("/api/v1/membership/members").set(authHeader(ownerToken)).send({ email: login, role: "MEMBER" }).expect(201);
  return login;
}

const createEmail = (token: string, domainId: string, localPart: string, recoveryEmail: string) =>
  request(app)
    .post("/api/v1/mail/admin/mailboxes/provision")
    .set(authHeader(token))
    .send({ domainId, localPart, displayName: localPart, quotaBytes: 5 * GIB, initialAccess: "INVITE", recoveryEmail });

const memberLogin = (email: string, password: string) =>
  request(app).post("/api/v1/auth/login").send({ email, password, workspace: "MEMBER" });

describe("Create Email with Zoiko as the mail store", () => {
  it("reports that mailboxes can be created, and where they live", async () => {
    const w = await workspaceWithDomain();
    const options = await request(app)
      .get("/api/v1/mail/admin/mailboxes/provisioning-options")
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(options.body.data).toMatchObject({ providerConfigured: true, hostingMode: "ZOIKO_STORE" });
  });

  it("creates a working mailbox that its owner signs into with the mailbox address, sends from and replies with", async () => {
    const w = await workspaceWithDomain();
    const infoLogin = await activeMember(w.owner.accessToken);
    const mgmtLogin = await activeMember(w.owner.accessToken);

    // 1. The admin creates both mailboxes. No mail server is involved.
    const info = await createEmail(w.owner.accessToken, w.domainId, "info", infoLogin).expect(201);
    const mgmt = await createEmail(w.owner.accessToken, w.domainId, "management", mgmtLogin).expect(201);
    expect(info.body.data).toMatchObject({ provider: null, provisioningStatus: null, status: "ACTIVE" });
    const infoAddress = `info@${w.domainName}`;
    const mgmtAddress = `management@${w.domainName}`;

    // 2. Persisted, owned by the right person, Member workspace by default.
    const stored = await prisma.mailbox.findUniqueOrThrow({
      where: { id: info.body.data.id },
      include: { membership: { include: { user: true } } },
    });
    expect(stored.address).toBe(infoAddress);
    expect(stored.membership?.user.email).toBe(infoLogin);
    expect(stored.workspaces).toEqual(["MEMBER"]);

    // 3. The admin sets the owner's password (step-up), as on the Mailboxes page.
    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${info.body.data.id}/credentials`)
      .set({ ...authHeader(w.owner.accessToken), ...(await stepUpHeader(app, w.owner.accessToken)) })
      .send({ newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })
      .expect(200);

    // 4. The owner signs into the Member workspace with the mailbox address.
    await memberLogin(infoAddress, PASSWORD).expect(401);
    const session = await memberLogin(infoAddress, NEW_PASSWORD).expect(200);
    expect(session.body.data.session.workspace).toBe("MEMBER");
    const infoToken = session.body.data.accessToken as string;
    const mgmtToken = (await memberLogin(mgmtAddress, PASSWORD).expect(200)).body.data.accessToken as string;

    // 5. info@ sends to management@ — from its own address — and it arrives.
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(infoToken))
      .send({ subject: "Leave approval", textBody: "Please approve", recipients: { to: [mgmtAddress] } })
      .expect(201);
    expect(draft.body.data.fromAddress).toBe(infoAddress);
    const sent = await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`).set(authHeader(infoToken)).expect(200);
    expect(sent.body.data.status).toBe("SENT");
    expect(await prisma.mailboxMessage.findFirst({ where: { mailboxId: mgmt.body.data.id, messageId: draft.body.data.id, folder: "INBOX" } })).not.toBeNull();

    // 6. management@ replies, to info@'s mailbox address, and it arrives.
    const reply = await request(app).post(`/api/v1/mail/${draft.body.data.id}/reply`).set(authHeader(mgmtToken)).send({ textBody: "Approved" }).expect(201);
    const replyTo = (reply.body.data.recipients as Array<{ email: string; type: string }>).filter((r) => r.type === "TO").map((r) => r.email);
    expect(replyTo).toEqual([infoAddress]);
    await request(app).post(`/api/v1/mail/drafts/${reply.body.data.id}/send`).set(authHeader(mgmtToken)).expect(200);
    expect(await prisma.mailboxMessage.findFirst({ where: { mailboxId: info.body.data.id, messageId: reply.body.data.id, folder: "INBOX" } })).not.toBeNull();
    // The reply quotes the original under an attribution line.
    expect(reply.body.data.textBody).toMatch(/^Approved\n\nOn .+, info@.+ wrote:\n> Please approve$/);

    // 7. info@ replies from Sent to its own message: that continues with the
    // person it went to, not with info@ itself ("Reply has no eligible recipient").
    const followUp = await request(app)
      .post(`/api/v1/mail/${draft.body.data.id}/reply`)
      .set(authHeader(infoToken))
      .send({ textBody: "Following up", htmlBody: "<p>Following up</p><p>quoted by the composer</p>", includesQuote: true })
      .expect(201);
    expect((followUp.body.data.recipients as Array<{ email: string; type: string }>).map((r) => [r.type, r.email])).toEqual([["TO", mgmtAddress]]);
    expect(followUp.body.data.subject).toBe("Re: Leave approval");
    // The composer already quoted the original, so the server adds nothing.
    expect(followUp.body.data.textBody).toBe("Following up");
    expect(followUp.body.data.htmlBody).toBe("<p>Following up</p><p>quoted by the composer</p>");
  });

  it("still blocks mail to outside addresses from a domain whose SPF/DKIM/DMARC are not passing", async () => {
    const w = await workspaceWithDomain();
    const login = await activeMember(w.owner.accessToken);
    await createEmail(w.owner.accessToken, w.domainId, "info", login).expect(201);
    const token = (await memberLogin(`info@${w.domainName}`, PASSWORD).expect(200)).body.data.accessToken as string;
    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(token))
      .send({ subject: "Out", textBody: "x", recipients: { to: ["someone@outside.test"] } })
      .expect(201);
    const blocked = await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`).set(authHeader(token)).expect(403);
    expect(blocked.body.error.message).toMatch(/SPF, DKIM and DMARC/);
  });

  it("invites a new person, and the invitation can be resent", async () => {
    const w = await workspaceWithDomain();
    const created = await createEmail(w.owner.accessToken, w.domainId, "newhire", `${unique("new")}@personal.test`).expect(201);
    expect(created.body.data).toMatchObject({ provider: null, provisioningStatus: null, status: "INVITATION_PENDING" });

    // Used to be refused as NOT_PROVISIONED: there is no mail server side to wait for.
    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${created.body.data.id}/invitation/resend`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
  });

  it("keeps refusing when the setting is left unset and no mail server is configured", async () => {
    mutableEnv.STALWART_ACCOUNT_PROVISIONING = true;
    const w = await workspaceWithDomain();
    const login = await activeMember(w.owner.accessToken);
    const refused = await createEmail(w.owner.accessToken, w.domainId, "info", login).expect(503);
    expect(refused.body.error.code).toBe("MAIL_HOSTING_NOT_CONFIGURED");
  });
});

describe("IMAP import", () => {
  it("keeps the message body it fetched instead of discarding it", async () => {
    const owner = await registerUser(app, { email: `${unique("imap-owner")}@zoiko.test` });
    const providerEnv = env as unknown as Record<string, unknown>;
    const saved = {
      MAIL_PROVIDER_TENANT_ID: providerEnv.MAIL_PROVIDER_TENANT_ID,
      MAIL_PROVIDER_MEMBERSHIP_ID: providerEnv.MAIL_PROVIDER_MEMBERSHIP_ID,
      MAIL_PROVIDER_FROM_ADDRESS: providerEnv.MAIL_PROVIDER_FROM_ADDRESS,
    };
    Object.assign(providerEnv, {
      MAIL_PROVIDER_TENANT_ID: owner.tenantId,
      MAIL_PROVIDER_MEMBERSHIP_ID: owner.membershipId,
      MAIL_PROVIDER_FROM_ADDRESS: owner.email,
    });
    try {
      const fakeAdapter = {
        fetchMetadata: async () => [
          {
            uid: 1,
            providerMessageId: `<${unique("msg")}@outside.test>`,
            subject: "From outside",
            from: [{ address: "sender@outside.test", name: "Sender" }],
            to: [{ address: owner.email, name: null }],
            cc: [],
            date: new Date(),
            flags: [],
            size: 1234,
            textBody: "Hello from the outside world",
            htmlBody: "<p>Hello from the outside world</p>",
          },
        ],
      };
      const service = new ProviderMailService(fakeAdapter as never);
      const result = await service.syncInbox();
      expect(result.imported).toBe(1);

      const message = await prisma.emailMessage.findFirstOrThrow({ where: { tenantId: owner.tenantId, providerType: "IMAP_SMTP" } });
      expect(message.textBody).toBe("Hello from the outside world");
      expect(message.htmlBody).toBe("<p>Hello from the outside world</p>");
      expect((message.securityFlags as { metadataOnly: boolean }).metadataOnly).toBe(false);
    } finally {
      Object.assign(providerEnv, saved);
    }
  });
});
