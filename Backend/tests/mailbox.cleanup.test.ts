import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { env } from "../src/config/env.js";
import { withCrossTenant, withTenant } from "../src/config/tenantScope.js";
import { getSecret } from "../src/common/secrets/secrets.js";
import { jobService } from "../src/modules/job/job.service.js";
import { lifecycleService } from "../src/modules/lifecycle/lifecycle.service.js";
import { mailboxCleanupService } from "../src/modules/mail/mailbox-cleanup.service.js";
import { credentialRef, ownershipMarker } from "../src/modules/mail/mailbox-identity.js";
import { mailboxProvisioningService } from "../src/modules/mail/mailbox-provisioning.service.js";
import { stalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import {
  StalwartError,
  type CreateHostedAccountInput,
  type DeleteAccountResult,
  type HostedAccount,
  type HostedDomain,
  type MailHostingProvider,
} from "../src/modules/stalwart/stalwart.types.js";
import { authHeader, loginUser, registerUser, stepUpHeader } from "./helpers.js";

const app = createApp();
const GIB = 1024 ** 3;
const mutableEnv = env as { STALWART_DELETE_ENABLED: boolean; SYSTEM_MAIL_ENABLED: boolean };

/**
 * Deleting hosted mailboxes: the request, the durable task, the worker and the
 * erasure paths — all against an in-memory mail host that follows the contract
 * the Stalwart client implements. Nothing here reaches a real server, and no
 * real mailbox is ever deleted.
 */
class FakeHost implements MailHostingProvider {
  readonly name = "STALWART" as const;
  configured = true;
  domains = new Map<string, HostedDomain>();
  accounts = new Map<string, HostedAccount>();
  messages = new Map<string, number>();
  countError: StalwartError | null = null;
  deleteError: StalwartError | null = null;
  deleteCalls: string[] = [];
  countCalls: string[] = [];
  private seq = 0;

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
  async findAccount(name: string, domainId: string) {
    return [...this.accounts.values()].find((a) => a.name === name && a.domainId === domainId) ?? null;
  }
  async getAccount(id: string) {
    return this.accounts.get(id) ?? null;
  }
  async createAccount(input: CreateHostedAccountInput) {
    const domain = [...this.domains.values()].find((d) => d.id === input.domainId)!;
    const account: HostedAccount = {
      id: `acc-${++this.seq}`,
      name: input.name,
      domainId: input.domainId,
      emailAddress: `${input.name}@${domain.name}`,
      description: input.description,
      diskQuotaBytes: input.diskQuotaBytes,
    };
    this.accounts.set(account.id, account);
    return account;
  }
  async countMessages(accountId: string) {
    this.countCalls.push(accountId);
    if (this.countError) throw this.countError;
    return this.messages.get(accountId) ?? 0;
  }
  async deleteAccount(id: string): Promise<DeleteAccountResult> {
    this.deleteCalls.push(id);
    if (this.deleteError) throw this.deleteError;
    return this.accounts.delete(id) ? "DELETED" : "ALREADY_ABSENT";
  }
  async probe() {
    return { reachable: true, authenticated: true, managementCapability: true };
  }
}

let host: FakeHost;
let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

beforeEach(async () => {
  host = new FakeHost();
  mailboxProvisioningService.setProvider(host);
  mailboxCleanupService.setProvider(host);
  mutableEnv.STALWART_DELETE_ENABLED = true;
  mutableEnv.SYSTEM_MAIL_ENABLED = false;
  // The worker takes any due task in the database, so each test starts empty.
  await withCrossTenant(() => prisma.mailProviderCleanupTask.deleteMany());
});

afterEach(() => {
  mailboxProvisioningService.setProvider(stalwartClient);
  mailboxCleanupService.setProvider(stalwartClient);
  mutableEnv.STALWART_DELETE_ENABLED = false;
});

afterAll(async () => {
  await withCrossTenant(() => prisma.mailProviderCleanupTask.deleteMany());
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function workspace(suffix = uid()) {
  const owner = await registerUser(app, { email: `cl-owner-${suffix}@zoiko.test` });
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

const provision = (token: string, over: Record<string, unknown>) =>
  request(app)
    .post("/api/v1/mail/admin/mailboxes/provision")
    .set(authHeader(token))
    .send({
      localPart: "john",
      displayName: "John",
      quotaBytes: 5 * GIB,
      initialAccess: "INVITE",
      ...over,
    });

/** A workspace with one hosted, provisioned mailbox on the fake host. */
async function hostedMailbox(local = "john") {
  const w = await workspace();
  const res = await provision(w.owner.accessToken, {
    domainId: w.domainId,
    localPart: local,
    recoveryEmail: `${local}.${w.suffix}@elsewhere.test`,
  }).expect(201);
  const mailboxId = res.body.data.id as string;
  const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } });
  const accountId = row.providerAccountId!;
  return { w, mailboxId, accountId, address: row.address, tenantId: w.owner.tenantId };
}

/** DELETE with a fresh step-up, asserting the status the caller expects. */
async function deleteRequest(token: string, mailboxId: string, status: number) {
  const step = await stepUpHeader(app, token);
  return request(app).delete(`/api/v1/mail/admin/mailboxes/${mailboxId}`).set(authHeader(token)).set(step).expect(status);
}

async function retryRequest(token: string, mailboxId: string, status: number) {
  const step = await stepUpHeader(app, token);
  return request(app).post(`/api/v1/mail/admin/mailboxes/${mailboxId}/deletion/retry`).set(authHeader(token)).set(step).expect(status);
}

const taskFor = (mailboxId: string) =>
  withCrossTenant(() => prisma.mailProviderCleanupTask.findUniqueOrThrow({ where: { mailboxId } }));

const patchTask = (mailboxId: string, data: Record<string, unknown>) =>
  withCrossTenant(() => prisma.mailProviderCleanupTask.update({ where: { mailboxId }, data }));

const past = (ms = 1000) => new Date(Date.now() - ms);

async function drain(limit = 20) {
  let processed = 0;
  for (;;) {
    const result = await mailboxCleanupService.processNext();
    if (!result.processed) return processed;
    processed += 1;
    if (processed > limit) throw new Error("the worker kept finding work");
  }
}

const mailboxRow = (id: string) => prisma.mailbox.findUnique({ where: { id } });
const secretExists = (mailboxId: string) =>
  getSecret(credentialRef(mailboxId), { purpose: "test" }).then(() => true, () => false);
const auditTypes = async (tenantId: string, mailboxId: string) =>
  (await prisma.auditEvent.findMany({ where: { tenantId, targetId: mailboxId }, select: { eventType: true } })).map((e) => e.eventType);

async function joinAs(w: Workspace, role: "ADMIN" | "MEMBER", email: string) {
  const user = await registerUser(app, { email });
  const added = await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(w.owner.accessToken))
    .send({ email: user.email, role })
    .expect(201);
  const login = await loginUser(app, user.email, user.password, w.owner.tenantId, user.mfaSecret);
  return { ...user, membershipId: added.body.data.id as string, token: login.accessToken as string };
}

// ─── Requesting a deletion ───────────────────────────────────────────────────

describe("deleting a hosted mailbox: the request", () => {
  it("leaves a mailbox that was never hosted to the existing delete path", async () => {
    const w = await workspace();
    const legacy = await prisma.mailbox.create({
      data: { tenantId: w.owner.tenantId, membershipId: w.owner.membershipId, address: `legacy-${w.suffix}@legacy.test` },
    });

    const res = await deleteRequest(w.owner.accessToken, legacy.id, 200);
    expect(res.body.data).toEqual({ deleted: true });
    expect(await mailboxRow(legacy.id)).toBeNull();
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count({ where: { mailboxId: legacy.id } }))).toBe(0);
  });

  it("still works for a never-hosted mailbox when hosted deletion is switched off", async () => {
    mutableEnv.STALWART_DELETE_ENABLED = false;
    const w = await workspace();
    const legacy = await prisma.mailbox.create({
      data: { tenantId: w.owner.tenantId, membershipId: w.owner.membershipId, address: `legacy2-${w.suffix}@legacy.test` },
    });
    await deleteRequest(w.owner.accessToken, legacy.id, 200);
    expect(await mailboxRow(legacy.id)).toBeNull();
  });

  it("is refused, and changes nothing, while hosted deletion is not enabled", async () => {
    const m = await hostedMailbox();
    mutableEnv.STALWART_DELETE_ENABLED = false;

    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 503);
    expect(res.body.error.code).toBe("MAILBOX_DELETE_DISABLED");
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).toBeNull();
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count())).toBe(0);
    expect(host.deleteCalls).toEqual([]);
  });

  it("is refused when the host is not configured at all", async () => {
    const m = await hostedMailbox();
    host.configured = false;
    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 503);
    expect(res.body.error.code).toBe("MAIL_HOSTING_NOT_CONFIGURED");
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).toBeNull();
  });

  it("fails closed when the host cannot say whether the mailbox is empty", async () => {
    const m = await hostedMailbox();
    host.countError = new StalwartError("cannot read", "COUNT_UNAVAILABLE", false);

    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 503);
    expect(res.body.error.code).toBe("MAIL_HOSTING_UNAVAILABLE");
    // Nothing was assumed: not marked, no task, nothing destroyed.
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).toBeNull();
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count())).toBe(0);
    expect(host.deleteCalls).toEqual([]);
    expect(host.accounts.has(m.accountId)).toBe(true);
  });

  it("is refused when the account holds mail on the host", async () => {
    const m = await hostedMailbox();
    host.messages.set(m.accountId, 3);
    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 409);
    expect(res.body.error.code).toBe("MAILBOX_NOT_EMPTY");
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).toBeNull();
    expect(host.deleteCalls).toEqual([]);
  });

  it("is refused when Zoiko itself holds messages in the mailbox", async () => {
    const m = await hostedMailbox();
    await withCrossTenant(async () => {
      const message = await prisma.emailMessage.create({
        data: { tenantId: m.tenantId, authorUserId: m.w.owner.userId, subject: "kept", status: "SENT" },
      });
      await prisma.mailboxMessage.create({
        data: { tenantId: m.tenantId, mailboxId: m.mailboxId, messageId: message.id, folder: "INBOX" },
      });
    });
    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 409);
    expect(res.body.error.message).toMatch(/messages/);
    expect(host.countCalls).toEqual([]);
  });

  it("is refused while the account is still being provisioned", async () => {
    const m = await hostedMailbox();
    await prisma.mailbox.update({
      where: { id: m.mailboxId },
      data: { provisioningStatus: "PROVISIONING", provisioningStartedAt: new Date() },
    });
    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 409);
    expect(res.body.error.code).toBe("PROVISIONING_IN_PROGRESS");
  });

  it("is accepted without deleting anything: the row stays, a task is written, the host is untouched", async () => {
    const m = await hostedMailbox();

    const res = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    expect(res.body.data).toMatchObject({ deleted: false, status: "DELETING", mailboxId: m.mailboxId, taskStatus: "PENDING" });

    const row = await mailboxRow(m.mailboxId);
    expect(row?.deletionRequestedAt).not.toBeNull();
    const task = await taskFor(m.mailboxId);
    expect(task).toMatchObject({
      tenantId: m.tenantId,
      status: "PENDING",
      reason: "ADMIN_DELETE",
      requireEmpty: true,
      providerAccountId: m.accountId,
      address: m.address,
      credentialRef: credentialRef(m.mailboxId),
      attempts: 0,
    });
    expect(host.accounts.has(m.accountId)).toBe(true);
    expect(host.deleteCalls).toEqual([]);
    expect(await secretExists(m.mailboxId)).toBe(true);
    expect(await auditTypes(m.tenantId, m.mailboxId)).toContain("MAILBOX_DELETION_REQUESTED");

    const view = await request(app)
      .get(`/api/v1/mail/admin/mailboxes/${m.mailboxId}/provisioning`)
      .set(authHeader(m.w.owner.accessToken))
      .expect(200);
    expect(view.body.data.status).toBe("DELETING");
  });

  it("is idempotent: asking twice leaves one task", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    const again = await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    expect(again.body.data.status).toBe("DELETING");
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count({ where: { mailboxId: m.mailboxId } }))).toBe(1);
  });

  it("stops the mailbox being re-provisioned or re-invited while it is on its way out", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);

    for (const path of ["provisioning/retry", "invitation/resend"]) {
      const res = await request(app)
        .post(`/api/v1/mail/admin/mailboxes/${m.mailboxId}/${path}`)
        .set(authHeader(m.w.owner.accessToken))
        .expect(409);
      expect(res.body.error.details?.reason).toBe("MAILBOX_DELETING");
    }
    expect(host.accounts.size).toBe(1);
  });
});

describe("deleting a hosted mailbox: who may", () => {
  it("refuses a Member", async () => {
    const m = await hostedMailbox();
    const member = await joinAs(m.w, "MEMBER", `cl-member-${uid()}@zoiko.test`);
    await request(app).delete(`/api/v1/mail/admin/mailboxes/${m.mailboxId}`).set(authHeader(member.token)).expect(403);
    await request(app).post(`/api/v1/mail/admin/mailboxes/${m.mailboxId}/deletion/retry`).set(authHeader(member.token)).expect(403);
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).toBeNull();
  });

  it("requires a fresh step-up", async () => {
    const m = await hostedMailbox();
    const res = await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${m.mailboxId}`)
      .set(authHeader(m.w.owner.accessToken))
      .expect(403);
    expect(res.body.error.details?.requiresStepUp).toBe(true);
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count())).toBe(0);
  });

  it("allows an Admin", async () => {
    const m = await hostedMailbox();
    const admin = await joinAs(m.w, "ADMIN", `cl-admin-${uid()}@zoiko.test`);
    const step = await stepUpHeader(app, admin.token, admin.password);
    await request(app)
      .delete(`/api/v1/mail/admin/mailboxes/${m.mailboxId}`)
      .set(authHeader(admin.token))
      .set(step)
      .expect(202);
  });

  it("treats another workspace's mailbox as absent", async () => {
    const m = await hostedMailbox();
    const other = await workspace();
    const res = await deleteRequest(other.owner.accessToken, m.mailboxId, 404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).toBeNull();
    const retry = await retryRequest(other.owner.accessToken, m.mailboxId, 404);
    expect(retry.body.error.code).toBe("NOT_FOUND");
  });
});

// ─── The worker ──────────────────────────────────────────────────────────────

describe("the cleanup worker", () => {
  it("removes the account, then the credential, then the Zoiko row, and records it", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    expect(await secretExists(m.mailboxId)).toBe(true);

    expect(await drain()).toBe(1);

    expect(host.deleteCalls).toEqual([m.accountId]);
    expect(host.accounts.size).toBe(0);
    expect(await mailboxRow(m.mailboxId)).toBeNull();
    expect(await secretExists(m.mailboxId)).toBe(false);

    const task = await taskFor(m.mailboxId);
    expect(task).toMatchObject({ status: "COMPLETED", outcome: "DELETED", lastErrorCode: null, lockedAt: null });
    expect(task.providerGoneAt).not.toBeNull();
    expect(task.secretRemovedAt).not.toBeNull();
    expect(task.completedAt).not.toBeNull();
    // An admin delete keeps the address in the task: the workspace still exists.
    expect(task.address).toBe(m.address);

    const types = await auditTypes(m.tenantId, m.mailboxId);
    expect(types).toEqual(expect.arrayContaining(["MAILBOX_DELETION_REQUESTED", "MAILBOX_DELETED", "MAILBOX_PROVIDER_CLEANUP_COMPLETED"]));
  });

  it("frees the address, and a new mailbox there does not adopt anything of the old one", async () => {
    const m = await hostedMailbox("recreate");
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    await drain();

    const again = await provision(m.w.owner.accessToken, {
      domainId: m.w.domainId,
      localPart: "recreate",
      recoveryEmail: `recreate.two.${m.w.suffix}@elsewhere.test`,
    }).expect(201);
    expect(again.body.data.id).not.toBe(m.mailboxId);
    expect(host.accounts.size).toBe(1);
    const [account] = [...host.accounts.values()];
    expect(account!.description).toContain(ownershipMarker(again.body.data.id));
    expect(account!.description).not.toContain(ownershipMarker(m.mailboxId));
  });

  it("does nothing, and uses no attempts, while deletion is switched off", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    mutableEnv.STALWART_DELETE_ENABLED = false;

    expect(await mailboxCleanupService.processNext()).toEqual({ processed: false, reason: "DISABLED" });
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(host.deleteCalls).toEqual([]);
    expect(await mailboxRow(m.mailboxId)).not.toBeNull();
  });

  it("keeps the row and the credential through a transient failure, then finishes", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.deleteError = new StalwartError("slow", "TIMEOUT", true);

    expect(await drain()).toBe(1);
    const failed = await taskFor(m.mailboxId);
    expect(failed).toMatchObject({ status: "PENDING", attempts: 1, lastErrorCode: "STALWART_TIMEOUT", lockedAt: null });
    expect(failed.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(await mailboxRow(m.mailboxId)).not.toBeNull();
    // The account is still there, so its credential must be too.
    expect(await secretExists(m.mailboxId)).toBe(true);
    // Backing off: it is not picked up again straight away.
    expect(await drain()).toBe(0);

    host.deleteError = null;
    await patchTask(m.mailboxId, { runAt: past() });
    expect(await drain()).toBe(1);
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED", attempts: 2 });
    expect(await mailboxRow(m.mailboxId)).toBeNull();
    expect(await secretExists(m.mailboxId)).toBe(false);
  });

  it("treats an account that is already gone as done", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.accounts.clear();

    await drain();
    expect(host.deleteCalls).toEqual([]);
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED", outcome: "ALREADY_ABSENT" });
    expect(await mailboxRow(m.mailboxId)).toBeNull();
    expect(await secretExists(m.mailboxId)).toBe(false);
  });

  it("resumes from its checkpoint after a crash, without asking the host again", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    // The account was destroyed, then the worker died before the rest.
    host.accounts.clear();
    host.countCalls = []; // the request itself counted once, before any of this
    await patchTask(m.mailboxId, {
      status: "RUNNING",
      lockedAt: past(10 * 60 * 1000),
      attempts: 1,
      providerGoneAt: new Date(),
      outcome: "DELETED",
    });

    await drain();
    expect(host.deleteCalls).toEqual([]);
    expect(host.countCalls).toEqual([]);
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED", outcome: "DELETED", attempts: 2 });
    expect(await mailboxRow(m.mailboxId)).toBeNull();
    expect(await secretExists(m.mailboxId)).toBe(false);
  });

  it("takes over a task whose worker died, once the lease has run out — and not before", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);

    await patchTask(m.mailboxId, { status: "RUNNING", lockedAt: new Date(), attempts: 1 });
    expect(await drain()).toBe(0);
    expect(host.deleteCalls).toEqual([]);

    await patchTask(m.mailboxId, { lockedAt: past(env.MAIL_CLEANUP_LEASE_MS + 5_000) });
    expect(await drain()).toBe(1);
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED" });
    expect(host.deleteCalls).toEqual([m.accountId]);
  });

  it("dead-letters a task that keeps killing its worker instead of reclaiming it for ever", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    const { maxAttempts } = await taskFor(m.mailboxId);
    await patchTask(m.mailboxId, { status: "RUNNING", lockedAt: past(env.MAIL_CLEANUP_LEASE_MS + 5_000), attempts: maxAttempts });

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "FAILED", lastErrorCode: "LEASE_EXHAUSTED" });
    expect(host.deleteCalls).toEqual([]);
    expect((await mailboxRow(m.mailboxId))?.deletionError).toBe("LEASE_EXHAUSTED");
  });

  it("lets only one of two workers have a task", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);

    const [a, b] = await Promise.all([mailboxCleanupService.processNext(), mailboxCleanupService.processNext()]);
    expect([a.processed, b.processed].sort()).toEqual([false, true]);
    expect(host.deleteCalls).toEqual([m.accountId]);
  });

  it("dead-letters after the last attempt, and says why", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    await patchTask(m.mailboxId, { maxAttempts: 2 });
    host.deleteError = new StalwartError("down", "UNAVAILABLE", true);

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "PENDING", attempts: 1 });
    await patchTask(m.mailboxId, { runAt: past() });
    await drain();

    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "FAILED", attempts: 2, lastErrorCode: "STALWART_UNAVAILABLE" });
    expect(await mailboxRow(m.mailboxId)).toMatchObject({ deletionError: "STALWART_UNAVAILABLE" });
    expect(await auditTypes(m.tenantId, m.mailboxId)).toContain("MAILBOX_PROVIDER_CLEANUP_FAILED");
  });

  it("dead-letters a refusal that no retry will fix, and an admin can queue it again", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.deleteError = new StalwartError("no permission", "FORBIDDEN", false);

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "FAILED", attempts: 1, lastErrorCode: "STALWART_FORBIDDEN" });
    expect(await mailboxRow(m.mailboxId)).toMatchObject({ deletionError: "STALWART_FORBIDDEN" });
    expect(await secretExists(m.mailboxId)).toBe(true);

    // Not yet fixed: it only retries what has failed, and only when asked.
    expect(await drain()).toBe(0);

    host.deleteError = null;
    const retried = await retryRequest(m.w.owner.accessToken, m.mailboxId, 200);
    expect(retried.body.data).toMatchObject({ status: "DELETING", taskStatus: "PENDING", attempts: 0 });
    expect((await mailboxRow(m.mailboxId))?.deletionError).toBeNull();
    expect(await auditTypes(m.tenantId, m.mailboxId)).toContain("MAILBOX_DELETION_RETRIED");

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED" });
    expect(await mailboxRow(m.mailboxId)).toBeNull();
  });

  it("will only retry a deletion that has failed", async () => {
    const m = await hostedMailbox();
    const none = await retryRequest(m.w.owner.accessToken, m.mailboxId, 409);
    expect(none.body.error.details?.reason).toBe("NOT_DELETING");

    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    const pending = await retryRequest(m.w.owner.accessToken, m.mailboxId, 409);
    expect(pending.body.error.details?.reason).toBe("NOT_FAILED");
  });

  it("keeps trying while the count cannot be read, and never deletes on a guess", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.countError = new StalwartError("cannot read", "COUNT_UNAVAILABLE", true);

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "PENDING", lastErrorCode: "STALWART_COUNT_UNAVAILABLE", attempts: 1 });
    expect(host.deleteCalls).toEqual([]);
    expect(host.accounts.has(m.accountId)).toBe(true);
    expect(await mailboxRow(m.mailboxId)).not.toBeNull();
  });

  it("puts the mailbox back, and leaves the account alone, when mail turned up after the request", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.messages.set(m.accountId, 3);

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "BLOCKED", outcome: "NON_EMPTY", lockedAt: null });
    expect(await mailboxRow(m.mailboxId)).toMatchObject({ deletionRequestedAt: null, deletionError: "NON_EMPTY" });
    expect(host.deleteCalls).toEqual([]);
    expect(host.accounts.has(m.accountId)).toBe(true);
    expect(await secretExists(m.mailboxId)).toBe(true);
    expect(await auditTypes(m.tenantId, m.mailboxId)).toContain("MAILBOX_PROVIDER_CLEANUP_BLOCKED");

    // Once the mail is gone, deleting it again starts from the beginning.
    host.messages.set(m.accountId, 0);
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "PENDING", attempts: 0, outcome: null });
    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED" });
    expect(await mailboxRow(m.mailboxId)).toBeNull();
  });
});

describe("the cleanup worker: ownership", () => {
  it("never destroys an account that lacks this mailbox's marker", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.accounts.get(m.accountId)!.description = "created by hand";
    host.countCalls = []; // the request itself counted once, before the marker changed

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "BLOCKED", outcome: "OWNERSHIP_MISMATCH" });
    expect(host.deleteCalls).toEqual([]);
    // Ownership is proved before anything else is asked, mail count included.
    expect(host.countCalls).toEqual([]);
    expect(host.accounts.has(m.accountId)).toBe(true);
    expect(await secretExists(m.mailboxId)).toBe(true);
    expect(await mailboxRow(m.mailboxId)).toMatchObject({ deletionError: "OWNERSHIP_MISMATCH" });
    expect((await mailboxRow(m.mailboxId))?.deletionRequestedAt).not.toBeNull();
  });

  it("never destroys an account carrying another mailbox's marker", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.accounts.get(m.accountId)!.description = `John [${ownershipMarker(randomUUID())}]`;
    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "BLOCKED", outcome: "OWNERSHIP_MISMATCH" });
    expect(host.deleteCalls).toEqual([]);
  });

  it("never destroys an account under a different name or domain, whatever its marker says", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    host.accounts.get(m.accountId)!.name = "someone-else";
    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "BLOCKED", outcome: "OWNERSHIP_MISMATCH" });

    await patchTask(m.mailboxId, { status: "PENDING", outcome: null, runAt: past() });
    host.accounts.get(m.accountId)!.name = "john";
    host.accounts.get(m.accountId)!.domainId = "dom-elsewhere";
    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "BLOCKED", outcome: "OWNERSHIP_MISMATCH" });
    expect(host.deleteCalls).toEqual([]);
  });

  it("finds an account the row never recorded, by name and marker, and removes it", async () => {
    const m = await hostedMailbox();
    // A provisioning that died between "account created" and the row update.
    await prisma.mailbox.update({ where: { id: m.mailboxId }, data: { providerAccountId: null, provisioningStatus: "FAILED" } });
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    expect((await taskFor(m.mailboxId)).providerAccountId).toBeNull();

    await drain();
    expect(host.deleteCalls).toEqual([m.accountId]);
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "COMPLETED", outcome: "DELETED" });
    expect(await mailboxRow(m.mailboxId)).toBeNull();
  });

  it("leaves an unrecorded account alone when it does not carry the marker", async () => {
    const m = await hostedMailbox();
    await prisma.mailbox.update({ where: { id: m.mailboxId }, data: { providerAccountId: null, provisioningStatus: "FAILED" } });
    host.accounts.get(m.accountId)!.description = "someone else's john";
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);

    await drain();
    expect(await taskFor(m.mailboxId)).toMatchObject({ status: "BLOCKED", outcome: "OWNERSHIP_MISMATCH" });
    expect(host.deleteCalls).toEqual([]);
  });
});

// ─── Erasure ─────────────────────────────────────────────────────────────────

describe("erasure of a member", () => {
  const erase = (tenantId: string, userId: string, actor: string) =>
    withCrossTenant(() => lifecycleService.anonymizeUser(tenantId, userId, { tenantId, userId: actor }));

  it("writes the cleanup task in the same transaction as the deletion, then removes the account without counting", async () => {
    const m = await hostedMailbox();
    const membership = await prisma.mailbox.findUniqueOrThrow({ where: { id: m.mailboxId }, include: { membership: true } });
    host.messages.set(m.accountId, 5);

    await erase(m.tenantId, membership.membership!.userId, m.w.owner.userId);

    expect(await mailboxRow(m.mailboxId)).toBeNull();
    expect(await taskFor(m.mailboxId)).toMatchObject({
      reason: "USER_ERASURE",
      requireEmpty: false,
      status: "PENDING",
      providerAccountId: m.accountId,
      tenantId: m.tenantId,
    });

    await drain();
    // An erasure is already an authorised destruction: the mail is not a reason to refuse.
    expect(host.countCalls).toEqual([]);
    expect(host.deleteCalls).toEqual([m.accountId]);
    expect(await secretExists(m.mailboxId)).toBe(false);
    const done = await taskFor(m.mailboxId);
    expect(done.status).toBe("COMPLETED");
    // The person asked to be forgotten: the address is not kept.
    expect(done.address).toMatch(/^redacted:[0-9a-f]{16}$/);
    expect(done.address).not.toContain(m.address);
  });

  it("keeps the erased person's address out of the audit log", async () => {
    const m = await hostedMailbox();
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: m.mailboxId }, include: { membership: true } });
    await erase(m.tenantId, row.membership!.userId, m.w.owner.userId);
    await drain();

    // What cleanup itself writes. (The events written when the mailbox was
    // created carry its address, as they always have; this is about the new rows.)
    const events = await prisma.auditEvent.findMany({
      where: { tenantId: m.tenantId, targetId: m.mailboxId, eventType: { startsWith: "MAILBOX_PROVIDER_CLEANUP" } },
    });
    expect(events.map((e) => e.eventType)).toContain("MAILBOX_PROVIDER_CLEANUP_COMPLETED");
    expect(events.some((e) => JSON.stringify(e.metadata ?? {}).includes(m.address))).toBe(false);
    expect(events.every((e) => e.actorUserId === null && e.actorType === "SYSTEM")).toBe(true);
  });

  it("writes no task when the mailbox was never hosted", async () => {
    const m = await hostedMailbox();
    const member = await joinAs(m.w, "MEMBER", `cl-legacy-${uid()}@zoiko.test`);
    const legacy = await prisma.mailbox.create({
      data: { tenantId: m.tenantId, membershipId: member.membershipId, address: `legacy-${uid()}@legacy.test` },
    });

    await erase(m.tenantId, member.userId, m.w.owner.userId);
    expect(await mailboxRow(legacy.id)).toBeNull();
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count({ where: { mailboxId: legacy.id } }))).toBe(0);
  });

  it("is all or nothing: a rolled-back erasure leaves no task behind", async () => {
    const m = await hostedMailbox();
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: m.mailboxId } });

    await withCrossTenant(() =>
      prisma.$transaction(async (tx) => {
        await mailboxCleanupService.enqueueForErasure(tx, [row], "USER_ERASURE", { userId: m.w.owner.userId });
        throw new Error("the rest of the erasure failed");
      })
    ).catch(() => undefined);

    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count({ where: { mailboxId: m.mailboxId } }))).toBe(0);
    expect(await mailboxRow(m.mailboxId)).not.toBeNull();
  });

  it("is idempotent, and lifts the emptiness check from a delete that was already open", async () => {
    const m = await hostedMailbox();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);
    await patchTask(m.mailboxId, { status: "BLOCKED", outcome: "NON_EMPTY", lastErrorCode: "NON_EMPTY", attempts: 3 });
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id: m.mailboxId } });

    await withCrossTenant(() =>
      prisma.$transaction(async (tx) => {
        await mailboxCleanupService.enqueueForErasure(tx, [row], "USER_ERASURE", {});
        await mailboxCleanupService.enqueueForErasure(tx, [row], "USER_ERASURE", {});
      })
    );

    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count({ where: { mailboxId: m.mailboxId } }))).toBe(1);
    expect(await taskFor(m.mailboxId)).toMatchObject({
      reason: "USER_ERASURE",
      requireEmpty: false,
      status: "PENDING",
      attempts: 0,
      outcome: null,
      lastErrorCode: null,
    });
  });
});

describe("erasure of a workspace", () => {
  it("leaves the cleanup task behind when the tenant is deleted, and then finishes it", async () => {
    const m = await hostedMailbox();
    const { owner } = m.w;
    host.messages.set(m.accountId, 7);

    const deletion = await request(app)
      .post("/api/v1/lifecycle/deletions")
      .set(authHeader(owner.accessToken))
      .send({ idempotencyKey: `tenant-erasure-${uid()}`, reason: "Closure" })
      .expect(202);
    await request(app).post(`/api/v1/lifecycle/${deletion.body.data.id}/approve`).set(authHeader(owner.accessToken)).expect(202);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: m.tenantId } });
    await request(app)
      .post(`/api/v1/lifecycle/${deletion.body.data.id}/confirm-deletion`)
      .set(authHeader(owner.accessToken))
      .send({ confirmation: "DELETE_TENANT_PERMANENTLY", tenantName: tenant.name })
      .expect(202);

    for (let i = 0; i < 10 && (await prisma.tenant.findUnique({ where: { id: m.tenantId } })); i++) {
      await jobService.processNext();
    }

    // The workspace and its mailbox row are gone...
    expect(await prisma.tenant.findUnique({ where: { id: m.tenantId } })).toBeNull();
    expect(await mailboxRow(m.mailboxId)).toBeNull();
    // ...the task that says an account is still on the host is not.
    expect(await taskFor(m.mailboxId)).toMatchObject({
      reason: "TENANT_ERASURE",
      requireEmpty: false,
      status: "PENDING",
      tenantId: m.tenantId,
      providerAccountId: m.accountId,
    });
    const receipt = await prisma.tenantDeletionReceipt.findUnique({ where: { requestId: deletion.body.data.id } });
    expect(receipt?.deletedRecordCounts).toMatchObject({ hostedMailboxCleanupTasks: 1 });
    // The credential is not deleted with the tenant: the account still exists.
    expect(await secretExists(m.mailboxId)).toBe(true);
    expect(host.accounts.has(m.accountId)).toBe(true);

    await drain();
    expect(host.deleteCalls).toEqual([m.accountId]);
    expect(host.countCalls).toEqual([]);
    expect(await secretExists(m.mailboxId)).toBe(false);
    const done = await taskFor(m.mailboxId);
    expect(done).toMatchObject({ status: "COMPLETED", outcome: "DELETED" });
    expect(done.address).toMatch(/^redacted:/);
    // The tenant is gone, so there is nowhere to write audit rows — and nothing failed for it.
    expect(await withCrossTenant(() => prisma.auditEvent.count({ where: { tenantId: m.tenantId } }))).toBe(0);
  });

  it("gives a workspace with no hosted mailboxes the receipt it always had", async () => {
    const w = await workspace();
    const deletion = await request(app)
      .post("/api/v1/lifecycle/deletions")
      .set(authHeader(w.owner.accessToken))
      .send({ idempotencyKey: `tenant-plain-${uid()}`, reason: "Closure" })
      .expect(202);
    await request(app).post(`/api/v1/lifecycle/${deletion.body.data.id}/approve`).set(authHeader(w.owner.accessToken)).expect(202);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: w.owner.tenantId } });
    await request(app)
      .post(`/api/v1/lifecycle/${deletion.body.data.id}/confirm-deletion`)
      .set(authHeader(w.owner.accessToken))
      .send({ confirmation: "DELETE_TENANT_PERMANENTLY", tenantName: tenant.name })
      .expect(202);
    for (let i = 0; i < 10 && (await prisma.tenant.findUnique({ where: { id: w.owner.tenantId } })); i++) {
      await jobService.processNext();
    }
    const receipt = await prisma.tenantDeletionReceipt.findUnique({ where: { requestId: deletion.body.data.id } });
    expect(receipt?.deletedRecordCounts).not.toHaveProperty("hostedMailboxCleanupTasks");
    expect(await withCrossTenant(() => prisma.mailProviderCleanupTask.count({ where: { tenantId: w.owner.tenantId } }))).toBe(0);
  });
});

// ─── Retention ───────────────────────────────────────────────────────────────

describe("retention of cleanup tasks", () => {
  const DAY = 24 * 60 * 60 * 1000;

  async function seed(status: "PENDING" | "COMPLETED" | "FAILED" | "BLOCKED", ageDays: number) {
    const mailboxId = randomUUID();
    await withCrossTenant(() =>
      prisma.mailProviderCleanupTask.create({
        data: {
          tenantId: randomUUID(),
          mailboxId,
          provider: "STALWART",
          address: "redacted:0000000000000000",
          credentialRef: credentialRef(mailboxId),
          reason: "TENANT_ERASURE",
          requireEmpty: false,
          status,
          completedAt: status === "COMPLETED" ? new Date(Date.now() - ageDays * DAY) : null,
          createdAt: new Date(Date.now() - ageDays * DAY),
        },
      })
    );
    return mailboxId;
  }

  it("keeps the 90-day default", () => {
    expect(env.MAIL_CLEANUP_RETENTION_DAYS).toBe(90);
  });

  it("purges only completed tasks older than the window", async () => {
    const old = await seed("COMPLETED", 91);
    const recent = await seed("COMPLETED", 89);
    const failed = await seed("FAILED", 400);
    const blocked = await seed("BLOCKED", 400);
    const pending = await seed("PENDING", 400);

    expect(await mailboxCleanupService.purgeCompleted()).toBe(1);

    const left = await withCrossTenant(() =>
      prisma.mailProviderCleanupTask.findMany({ select: { mailboxId: true } })
    );
    const ids = new Set(left.map((t) => t.mailboxId));
    expect(ids.has(old)).toBe(false);
    for (const kept of [recent, failed, blocked, pending]) expect(ids.has(kept)).toBe(true);
  });
});

// ─── Row-level security ──────────────────────────────────────────────────────

describe("row-level security on cleanup tasks", () => {
  async function twoTasks() {
    const [a, b] = [randomUUID(), randomUUID()];
    const [mailboxA, mailboxB] = [randomUUID(), randomUUID()];
    await withCrossTenant(async () => {
      for (const [tenantId, mailboxId] of [[a, mailboxA], [b, mailboxB]] as const) {
        await prisma.mailProviderCleanupTask.create({
          data: { tenantId, mailboxId, provider: "STALWART", address: `x@${mailboxId}.test`, credentialRef: credentialRef(mailboxId), reason: "ADMIN_DELETE", requireEmpty: true },
        });
      }
    });
    return { a, b, mailboxA, mailboxB };
  }

  it("is enabled, forced and has a policy", async () => {
    const rows = await withCrossTenant(() =>
      prisma.$queryRawUnsafe<Array<{ enabled: boolean; forced: boolean; policies: number }>>(`
        SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'mail_provider_cleanup_tasks'`)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: true, forced: true });
    expect(rows[0]!.policies).toBeGreaterThan(0);
  });

  it("has no foreign keys, which is what lets it outlive the tenant", async () => {
    const rows = await withCrossTenant(() =>
      prisma.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'mail_provider_cleanup_tasks'::regclass AND contype = 'f'`
      )
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("shows a workspace only its own tasks, even to a query that forgot its filter", async () => {
    const { a, b } = await twoTasks();
    const seen = await withTenant(a, () => prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>("SELECT tenant_id::text AS tenant_id FROM mail_provider_cleanup_tasks"));
    const tenants = new Set(seen.map((row) => row.tenant_id));
    expect(tenants.has(a)).toBe(true);
    expect(tenants.has(b)).toBe(false);
  });

  it("lets the worker's cross-tenant scope see every workspace", async () => {
    const { a, b } = await twoTasks();
    const seen = await withCrossTenant(() => prisma.mailProviderCleanupTask.findMany({ select: { tenantId: true } }));
    const tenants = new Set(seen.map((row) => row.tenantId));
    expect(tenants.has(a) && tenants.has(b)).toBe(true);
  });

  it("refuses a workspace writing a task for another", async () => {
    const { a, b } = await twoTasks();
    const mailboxId = randomUUID();
    await expect(
      withTenant(a, () =>
        prisma.mailProviderCleanupTask.create({
          data: { tenantId: b, mailboxId, provider: "STALWART", address: "x@y.test", credentialRef: credentialRef(mailboxId), reason: "ADMIN_DELETE", requireEmpty: true },
        })
      )
    ).rejects.toThrow();
  });

  it("cannot be read or changed across workspaces through the request path", async () => {
    const m = await hostedMailbox();
    const other = await workspace();
    await deleteRequest(m.w.owner.accessToken, m.mailboxId, 202);

    const seen = await withTenant(other.owner.tenantId, () => prisma.mailProviderCleanupTask.findMany({ where: { mailboxId: m.mailboxId } }));
    expect(seen).toHaveLength(0);
  });
});
