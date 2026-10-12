import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { systemMailer } from "../src/common/mailer/system-mailer.js";
import { mailboxProvisioningService } from "../src/modules/mail/mailbox-provisioning.service.js";
import { stalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import {
  StalwartError,
  type CreateHostedAccountInput,
  type HostedAccount,
  type HostedDomain,
  type MailHostingProvider,
} from "../src/modules/stalwart/stalwart.types.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();
const GIB = 1024 ** 3;

/**
 * Hosted mailbox creation (Create Email) end to end through the API, against
 * an in-memory mail host that behaves like the verified Stalwart contract:
 * domains and accounts keyed by name, duplicates refused, and failures that
 * can happen before or after the server applied a write.
 */
class FakeHost implements MailHostingProvider {
  readonly name = "STALWART" as const;
  configured = true;
  domains = new Map<string, HostedDomain>();
  accounts = new Map<string, HostedAccount>();
  createCalls: CreateHostedAccountInput[] = [];
  /** Fail the next createAccount with this error before applying it. */
  failBefore: StalwartError | null = null;
  /** Apply the next createAccount, then fail as if the response was lost. */
  failAfter: StalwartError | null = null;

  isConfigured() {
    return this.configured;
  }
  async findDomain(name: string) {
    return this.domains.get(name) ?? null;
  }
  async createDomain(name: string) {
    const domain = { id: `dom-${this.domains.size + 1}`, name };
    this.domains.set(name, domain);
    return domain;
  }
  private key(name: string, domainId: string) {
    return `${name}@${domainId}`;
  }
  async findAccount(name: string, domainId: string) {
    return this.accounts.get(this.key(name, domainId)) ?? null;
  }
  async getAccount(id: string) {
    return [...this.accounts.values()].find((a) => a.id === id) ?? null;
  }
  async createAccount(input: CreateHostedAccountInput) {
    this.createCalls.push(input);
    if (this.failBefore) {
      const error = this.failBefore;
      this.failBefore = null;
      throw error;
    }
    const key = this.key(input.name, input.domainId);
    if (this.accounts.has(key)) throw new StalwartError("exists", "ALREADY_EXISTS", false);
    const domain = [...this.domains.values()].find((d) => d.id === input.domainId)!;
    const account: HostedAccount = {
      id: `acc-${this.accounts.size + 1}`,
      name: input.name,
      domainId: input.domainId,
      emailAddress: `${input.name}@${domain.name}`,
      description: input.description,
      diskQuotaBytes: input.diskQuotaBytes,
    };
    this.accounts.set(key, account);
    if (this.failAfter) {
      const error = this.failAfter;
      this.failAfter = null;
      throw error;
    }
    return account;
  }
  async probe() {
    return { reachable: true, authenticated: true, managementCapability: true };
  }
}

let host: FakeHost;
const mutableEnv = env as { SYSTEM_MAIL_ENABLED: boolean };

beforeEach(() => {
  host = new FakeHost();
  mailboxProvisioningService.setProvider(host);
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
});

afterEach(() => {
  mailboxProvisioningService.setProvider(stalwartClient);
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
  vi.restoreAllMocks();
});

async function workspace(suffix: string) {
  const owner = await registerUser(app, { email: `prov-owner-${suffix}@zoiko.test` });
  const created = await request(app)
    .post("/api/v1/domains")
    .set(authHeader(owner.accessToken))
    .send({ domainName: `${suffix}-acme.test` })
    .expect(201);
  const domainId = created.body.data.id as string;
  await prisma.mailDomain.update({ where: { id: domainId }, data: { verificationStatus: "VERIFIED", mxStatus: "VALID" } });
  return { owner, domainId, domainName: `${suffix}-acme.test` };
}

async function joinAs(ownerToken: string, tenantId: string, role: "ADMIN" | "MEMBER", email: string) {
  const user = await registerUser(app, { email });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(ownerToken))
    .send({ email: user.email, role })
    .expect(201);
  const login = await loginUser(app, user.email, user.password, tenantId, user.mfaSecret);
  return { ...user, membershipId: added.body.data.id as string, token: login.accessToken as string };
}

const provision = (token: string, body: Record<string, unknown>, key?: string) => {
  const req = request(app).post("/api/v1/mail/admin/mailboxes/provision").set(authHeader(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send(body);
};

const body = (domainId: string, over: Record<string, unknown> = {}) => ({
  domainId,
  localPart: "john",
  displayName: "Support Team",
  quotaBytes: 5 * GIB,
  initialAccess: "INVITE",
  recoveryEmail: "john.personal@elsewhere.test",
  ...over,
});

describe("Create Email — authorization and validation", () => {
  it("lets an Owner create a mailbox, recorded against the host account", async () => {
    const w = await workspace("owner");
    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(201);

    expect(res.body.data).toMatchObject({
      address: `john@${w.domainName}`,
      displayName: "Support Team",
      provider: "STALWART",
      provisioningStatus: "PROVISIONED",
      quotaBytes: 5 * GIB,
      appliedQuotaBytes: 5 * GIB,
      invitationRecipient: "john.personal@elsewhere.test",
      membershipStatus: "INVITED",
      status: "INVITATION_PENDING",
    });
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.providerAccountId).toBe("acc-1");
    expect(host.createCalls).toHaveLength(1);
    expect(host.createCalls[0]).toMatchObject({ name: "john", diskQuotaBytes: 5 * GIB });
    expect(host.createCalls[0]!.description).toContain(`zoiko:mailbox:${row.id}`);
    // The domain was registered on the host the first time it was used.
    expect(host.domains.has(w.domainName)).toBe(true);
  });

  it("lets an Admin create a mailbox", async () => {
    const w = await workspace("admin");
    const admin = await joinAs(w.owner.accessToken, w.owner.tenantId, "ADMIN", "prov-admin@zoiko.test");
    await provision(admin.token, body(w.domainId)).expect(201);
  });

  it("refuses a Member", async () => {
    const w = await workspace("member");
    const member = await joinAs(w.owner.accessToken, w.owner.tenantId, "MEMBER", "prov-member@zoiko.test");
    await provision(member.token, body(w.domainId)).expect(403);
    await request(app).get("/api/v1/mail/admin/mailboxes/provisioning-options").set(authHeader(member.token)).expect(403);
    expect(host.createCalls).toHaveLength(0);
  });

  it("treats another workspace's domain as absent", async () => {
    const mine = await workspace("idor-a");
    const theirs = await workspace("idor-b");
    await provision(mine.owner.accessToken, body(theirs.domainId)).expect(404);
    expect(host.createCalls).toHaveLength(0);
  });

  it("refuses an unverified domain", async () => {
    const w = await workspace("unverified");
    await prisma.mailDomain.update({ where: { id: w.domainId }, data: { verificationStatus: "PENDING" } });
    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(409);
    expect(res.body.error.details.reason).toBe("DOMAIN_NOT_VERIFIED");
  });

  it("refuses an address already in use, in this workspace or another", async () => {
    const w = await workspace("dupe");
    await provision(w.owner.accessToken, body(w.domainId)).expect(201);
    const again = await provision(w.owner.accessToken, body(w.domainId, { recoveryEmail: "other@elsewhere.test" })).expect(409);
    expect(again.body.error.details.reason).toBe("ADDRESS_TAKEN");
    expect(host.createCalls).toHaveLength(1);
  });

  it("refuses invalid and reserved addresses, and quotas the plan does not offer", async () => {
    const w = await workspace("validate");
    await provision(w.owner.accessToken, body(w.domainId, { localPart: "john..smith" })).expect(422);
    await provision(w.owner.accessToken, body(w.domainId, { localPart: "-john" })).expect(422);
    await provision(w.owner.accessToken, body(w.domainId, { localPart: "postmaster" })).expect(422);
    await provision(w.owner.accessToken, body(w.domainId, { quotaBytes: 3 * GIB })).expect(422);
    await provision(w.owner.accessToken, body(w.domainId, { recoveryEmail: `john@${w.domainName}` })).expect(422);
    // Fields the server derives are not accepted from the browser (schema
    // validation, which this API answers with 400).
    await provision(w.owner.accessToken, { ...body(w.domainId), tenantId: w.owner.tenantId }).expect(400);
    expect(host.createCalls).toHaveLength(0);
  });

  it("enforces the plan's storage ceiling on quota", async () => {
    const w = await workspace("ceiling");
    const options = await request(app)
      .get("/api/v1/mail/admin/mailboxes/provisioning-options")
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    const { maxBytes, optionsBytes } = options.body.data.quota;
    if (maxBytes !== null) {
      expect(optionsBytes.every((b: number) => b <= maxBytes)).toBe(true);
      const over = [1, 5, 10, 25, 50, 100].map((g) => g * GIB).find((b) => b > maxBytes);
      if (over) await provision(w.owner.accessToken, body(w.domainId, { quotaBytes: over })).expect(422);
    }
    expect(options.body.data.providerConfigured).toBe(true);
    expect(options.body.data.domains[0]).toMatchObject({ usable: true, readiness: { ownershipVerified: true } });
  });

  it("refuses outright when the mail host is not configured, creating nothing", async () => {
    const w = await workspace("unconfigured");
    host.configured = false;
    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(503);
    expect(res.body.error.code).toBe("MAIL_HOSTING_NOT_CONFIGURED");
    expect(await prisma.mailbox.count({ where: { tenantId: w.owner.tenantId } })).toBe(0);
  });

  it("attaches the mailbox to an existing active member without inviting them", async () => {
    const w = await workspace("existing");
    const member = await joinAs(w.owner.accessToken, w.owner.tenantId, "MEMBER", "prov-existing@zoiko.test");
    const res = await provision(w.owner.accessToken, body(w.domainId, { recoveryEmail: member.email })).expect(201);
    expect(res.body.data).toMatchObject({ invitationStatus: "NOT_REQUIRED", status: "ACTIVE", membershipStatus: "ACTIVE" });
  });
});

describe("Create Email — failures and recovery", () => {
  it("records a provider timeout and finishes on retry without a second account", async () => {
    const w = await workspace("timeout");
    host.failBefore = new StalwartError("timeout", "TIMEOUT", true);
    const first = await provision(w.owner.accessToken, body(w.domainId)).expect(202);
    expect(first.body.data).toMatchObject({ provisioningStatus: "FAILED", provisioningError: "STALWART_TIMEOUT", status: "FAILED" });

    const retried = await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${first.body.data.id}/provisioning/retry`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(retried.body.data.provisioningStatus).toBe("PROVISIONED");
    expect(host.accounts.size).toBe(1);
  });

  it("adopts the account a lost response created, instead of creating another", async () => {
    // The host applied the create, then the response never arrived — the
    // same position as the host succeeding and the database write failing.
    const w = await workspace("lost");
    host.failAfter = new StalwartError("timeout", "TIMEOUT", true);
    const first = await provision(w.owner.accessToken, body(w.domainId)).expect(202);
    expect(host.accounts.size).toBe(1);

    const retried = await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${first.body.data.id}/provisioning/retry`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(retried.body.data.provisioningStatus).toBe("PROVISIONED");
    expect(host.createCalls).toHaveLength(1);
    expect(host.accounts.size).toBe(1);
  });

  it("never adopts a host account it did not create", async () => {
    const w = await workspace("foreign");
    const domain = await host.createDomain(w.domainName);
    host.accounts.set(`john@${domain.id}`, {
      id: "someone-else", name: "john", domainId: domain.id,
      emailAddress: `john@${w.domainName}`, description: "created by hand", diskQuotaBytes: null,
    });
    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(202);
    expect(res.body.data).toMatchObject({ provisioningStatus: "FAILED", provisioningError: "STALWART_ALREADY_EXISTS" });
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.providerAccountId).toBeNull();
  });

  it("replays a repeated request with the same Idempotency-Key", async () => {
    const w = await workspace("idem");
    const a = await provision(w.owner.accessToken, body(w.domainId), "create-email-key-1").expect(201);
    const b = await provision(w.owner.accessToken, body(w.domainId), "create-email-key-1").expect(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(host.createCalls).toHaveLength(1);
    expect(await prisma.mailbox.count({ where: { tenantId: w.owner.tenantId } })).toBe(1);
  });

  it("lets only one of two concurrent requests for the same address through", async () => {
    const w = await workspace("race");
    const [a, b] = await Promise.all([
      provision(w.owner.accessToken, body(w.domainId, { recoveryEmail: "one@elsewhere.test" })),
      provision(w.owner.accessToken, body(w.domainId, { recoveryEmail: "two@elsewhere.test" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(host.accounts.size).toBe(1);
  });
});

describe("Create Email — invitation", () => {
  it("does not send (or log) the invitation when system mail is off, and says so", async () => {
    const w = await workspace("nomail");
    const send = vi.spyOn(systemMailer, "sendInvitationEmail");
    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(201);
    expect(res.body.data).toMatchObject({ invitationStatus: "PENDING", invitationError: "SYSTEM_MAIL_DISABLED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("records a failed invitation, and a resend fixes it without touching the host", async () => {
    const w = await workspace("invfail");
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    const send = vi.spyOn(systemMailer, "sendInvitationEmail").mockRejectedValueOnce(new Error("smtp down"));

    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(201);
    expect(res.body.data).toMatchObject({ provisioningStatus: "PROVISIONED", invitationStatus: "FAILED" });

    send.mockResolvedValue(undefined);
    const resent = await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/invitation/resend`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(resent.body.data.invitationStatus).toBe("SENT");
    expect(host.createCalls).toHaveLength(1);

    // And not again straight away.
    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/invitation/resend`)
      .set(authHeader(w.owner.accessToken))
      .expect(429);
  });

  it("sends to the existing address, rotates the token on resend, and the token is single-use and expiring", async () => {
    const w = await workspace("token");
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    const send = vi.spyOn(systemMailer, "sendInvitationEmail").mockResolvedValue(undefined);

    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(201);
    expect(res.body.data.invitationStatus).toBe("SENT");
    expect(send.mock.calls[0]![0]).toBe("john.personal@elsewhere.test");
    const firstToken = new URL(send.mock.calls[0]![2]).searchParams.get("token")!;

    await prisma.mailbox.update({ where: { id: res.body.data.id }, data: { invitationSentAt: new Date(Date.now() - 120_000) } });
    await request(app)
      .post(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/invitation/resend`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    const secondToken = new URL(send.mock.calls[1]![2]).searchParams.get("token")!;
    expect(secondToken).not.toBe(firstToken);

    // The old link stopped working the moment a new one was sent.
    await request(app).get(`/api/v1/membership/invitations/lookup?token=${firstToken}`).expect(401);

    await request(app)
      .post("/api/v1/membership/invitations/claim")
      .send({ invitationToken: secondToken, password: "A-strong-Passw0rd!" })
      .expect(200);
    // Single use.
    await request(app)
      .post("/api/v1/membership/invitations/claim")
      .send({ invitationToken: secondToken, password: "A-strong-Passw0rd!" })
      .expect(401);

    const after = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${res.body.data.id}/provisioning`)
      .set(authHeader(w.owner.accessToken))
      .expect(200);
    expect(after.body.data).toMatchObject({ status: "ACTIVE", membershipStatus: "ACTIVE" });
  });

  it("refuses an expired invitation token", async () => {
    const w = await workspace("expired");
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    const send = vi.spyOn(systemMailer, "sendInvitationEmail").mockResolvedValue(undefined);
    await provision(w.owner.accessToken, body(w.domainId)).expect(201);
    const token = new URL(send.mock.calls[0]![2]).searchParams.get("token")!;
    await prisma.tenantMembership.updateMany({
      where: { tenantId: w.owner.tenantId, status: "INVITED" },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });
    await request(app)
      .post("/api/v1/membership/invitations/claim")
      .send({ invitationToken: token, password: "A-strong-Passw0rd!" })
      .expect(410);
  });

  it("keeps the mailbox credential and invitation token out of responses, audit and the database", async () => {
    const w = await workspace("secrets");
    mutableEnv.SYSTEM_MAIL_ENABLED = true;
    const send = vi.spyOn(systemMailer, "sendInvitationEmail").mockResolvedValue(undefined);
    const res = await provision(w.owner.accessToken, body(w.domainId)).expect(201);

    const secret = host.createCalls[0]!.secret;
    const token = new URL(send.mock.calls[0]![2]).searchParams.get("token")!;
    expect(secret.length).toBeGreaterThanOrEqual(32);

    const list = await request(app).get("/api/v1/mail/admin/mailboxes").set(authHeader(w.owner.accessToken)).expect(200);
    const audits = await prisma.auditEvent.findMany({ where: { tenantId: w.owner.tenantId } });
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: res.body.data.id } });
    const membership = await prisma.tenantMembership.findFirstOrThrow({ where: { id: row.membershipId! } });

    for (const haystack of [JSON.stringify(res.body), JSON.stringify(list.body), JSON.stringify(audits), JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? String(v) : v))]) {
      expect(haystack).not.toContain(secret);
      expect(haystack).not.toContain(token);
    }
    // Only the hash of the invitation token is stored.
    expect(membership.inviteToken).not.toBe(token);
    expect(audits.map((a) => a.eventType)).toEqual(
      expect.arrayContaining(["MAILBOX_PROVISIONING_REQUESTED", "MAILBOX_PROVISIONED", "MAILBOX_INVITATION_SENT"])
    );
  });
});
