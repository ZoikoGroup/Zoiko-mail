import { createHash } from "node:crypto";
import { Prisma, type MailProviderCleanupReason, type MailProviderCleanupTask } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { withCrossTenant } from "../../config/tenantScope.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { deleteSecret } from "../../common/secrets/secrets.js";
import { auditService } from "../audit/audit.service.js";
import { stalwartClient } from "../stalwart/stalwart.client.js";
import { StalwartError, type HostedAccount, type MailHostingProvider } from "../stalwart/stalwart.types.js";
import { credentialRef, ownershipMarker } from "./mailbox-identity.js";

interface CleanupContext {
  tenantId: string;
  userId: string;
  requestId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The mailbox a cascading erasure is about to delete. */
export interface ErasedMailbox {
  id: string;
  tenantId: string;
  provider: "STALWART" | null;
  providerAccountId: string | null;
  address: string;
}

/** How long a recently started provisioning may still be in flight. */
const PROVISIONING_IN_FLIGHT_MS = 2 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
/** How long to wait before looking again when the host is not configured. */
const NOT_CONFIGURED_DELAY_MS = 5 * 60 * 1000;

/** The worker no longer holds the lease: another worker took the task over. */
class LeaseLost extends Error {}

/** A refusal that needs a person, not another attempt. */
class Blocked extends Error {
  readonly code: "NON_EMPTY" | "OWNERSHIP_MISMATCH";
  constructor(code: "NON_EMPTY" | "OWNERSHIP_MISMATCH") {
    super(code);
    this.code = code;
  }
}

/** What a person reads once an address has been erased: a hash, not the address. */
function redactedAddress(address: string): string {
  return `redacted:${createHash("sha256").update(address).digest("hex").slice(0, 16)}`;
}

/**
 * Durable removal of hosted mailboxes from the mail host.
 *
 * Deleting a Zoiko mailbox, a member or a workspace cannot also delete the
 * account on Stalwart in one transaction, so the Zoiko side writes down the
 * work still owed — in the transaction that deletes its own rows — and this
 * service does it afterwards, as often as it takes.
 *
 * Three properties carry the design:
 *
 *  - An account is destroyed only after its ownership is proved. Its
 *    description must carry this mailbox's marker, and its name and domain
 *    must be the mailbox's own. A foreign account is never touched.
 *  - Mail is never assumed absent. An admin delete counts the account's mail
 *    first and refuses on anything but a reliably read zero. If the count
 *    cannot be read, nothing is deleted.
 *  - Every step is safe to repeat. "Already gone" counts as done, work is
 *    checkpointed on the task, and a worker that dies mid-task simply lets its
 *    lease run out.
 *
 * The credential secret is removed only after the account is confirmed gone:
 * while the account exists, the credential is the only record of how it was
 * created.
 */
export class MailboxCleanupService {
  constructor(private provider: MailHostingProvider = stalwartClient) {}

  /** Test seam. */
  setProvider(provider: MailHostingProvider): void {
    this.provider = provider;
  }

  /** Deleting on the host is on, and there is a host to ask. */
  isEnabled(): boolean {
    return env.STALWART_DELETE_ENABLED && this.provider.isConfigured();
  }

  // ─── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Record that hosted mailboxes are being erased, inside the caller's
   * transaction — the one that deletes the member or the workspace — so the
   * rows go together or not at all. Mailboxes that were never hosted are
   * skipped. Returns how many tasks cover the given mailboxes.
   */
  async enqueueForErasure(
    tx: Prisma.TransactionClient,
    mailboxes: ErasedMailbox[],
    reason: "USER_ERASURE" | "TENANT_ERASURE",
    by: { userId?: string | null; requestId?: string | null }
  ): Promise<number> {
    const hosted = mailboxes.filter((mailbox): mailbox is ErasedMailbox & { provider: "STALWART" } => mailbox.provider !== null);
    if (hosted.length === 0) return 0;

    await tx.mailProviderCleanupTask.createMany({
      data: hosted.map((mailbox) => ({
        tenantId: mailbox.tenantId,
        mailboxId: mailbox.id,
        provider: mailbox.provider,
        providerAccountId: mailbox.providerAccountId,
        address: mailbox.address,
        credentialRef: credentialRef(mailbox.id),
        reason,
        requireEmpty: false,
        requestedByUserId: by.userId ?? null,
        requestId: by.requestId ?? null,
      })),
      skipDuplicates: true,
    });

    // An admin delete may already be open for one of these. The erasure is an
    // authorised destruction of the data, so it no longer waits on the
    // account being empty — and a task that was refused or dead-lettered gets
    // another go.
    const ids = hosted.map((mailbox) => mailbox.id);
    const upgrade = { reason, requireEmpty: false };
    await tx.mailProviderCleanupTask.updateMany({
      where: { mailboxId: { in: ids }, requireEmpty: true, status: { in: ["PENDING", "BLOCKED", "FAILED"] } },
      data: { ...upgrade, status: "PENDING", attempts: 0, runAt: new Date(), lockedAt: null, lastErrorCode: null, outcome: null },
    });
    await tx.mailProviderCleanupTask.updateMany({
      where: { mailboxId: { in: ids }, requireEmpty: true, status: "RUNNING" },
      data: upgrade,
    });
    return hosted.length;
  }

  // ─── Admin delete ─────────────────────────────────────────────────────────

  private async loadMailbox(tenantId: string, mailboxId: string) {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, tenantId },
      select: {
        id: true,
        address: true,
        provider: true,
        providerAccountId: true,
        provisioningStatus: true,
        provisioningStartedAt: true,
        deletionRequestedAt: true,
      },
    });
    if (!mailbox) throw new AppError("Mailbox not found", 404, ErrorCodes.NOT_FOUND);
    return mailbox;
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: CleanupContext,
    eventType: string,
    mailboxId: string,
    metadata: Prisma.InputJsonValue
  ) {
    return auditService.record(
      {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorType: "ADMIN",
        eventType,
        targetType: "Mailbox",
        targetId: mailboxId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata,
      },
      tx
    );
  }

  /**
   * Ask for a hosted mailbox to be deleted. Returns null for a mailbox that
   * is not hosted, which the caller deletes as it always has.
   *
   * Nothing is deleted here. The mailbox is marked, a durable task is
   * written, and the worker removes the account and then the row. Each way
   * this can refuse leaves everything exactly as it was.
   */
  async requestDeletion(mailboxId: string, context: CleanupContext) {
    const mailbox = await this.loadMailbox(context.tenantId, mailboxId);
    if (!mailbox.provider) return null;

    if (!this.provider.isConfigured()) {
      throw new AppError("Mailbox hosting is not configured on this deployment", 503, ErrorCodes.MAIL_HOSTING_NOT_CONFIGURED);
    }
    if (!env.STALWART_DELETE_ENABLED) {
      throw new AppError(
        "Deleting hosted mailboxes is not enabled on this deployment",
        503,
        ErrorCodes.MAILBOX_DELETE_DISABLED
      );
    }
    if (mailbox.deletionRequestedAt) return this.view(context.tenantId, mailboxId);

    if (
      mailbox.provisioningStatus === "PROVISIONING" &&
      mailbox.provisioningStartedAt &&
      Date.now() - mailbox.provisioningStartedAt.getTime() < PROVISIONING_IN_FLIGHT_MS
    ) {
      throw new AppError(
        "This mailbox is still being provisioned. Check back in a moment.",
        409,
        ErrorCodes.PROVISIONING_IN_PROGRESS
      );
    }

    const zoikoMessages = await prisma.mailboxMessage.count({ where: { mailboxId, tenantId: context.tenantId } });
    if (zoikoMessages > 0) {
      throw new AppError("Cannot delete mailbox with messages", 409, ErrorCodes.CONFLICT);
    }

    // Mail on the host never reaches Zoiko's tables, so an empty count above
    // proves nothing about it. Ask the host, and treat "could not tell" as a
    // refusal. A mailbox whose account id was never recorded is checked by the
    // worker, which finds the account by name and ownership marker.
    if (mailbox.providerAccountId) {
      let count: number;
      try {
        count = await this.provider.countMessages(mailbox.providerAccountId);
      } catch (error) {
        if (!(error instanceof StalwartError)) throw error;
        logger.warn({ mailboxId, code: error.code }, "Could not verify a hosted mailbox is empty");
        throw new AppError(
          "Could not confirm the mailbox is empty on the mail server, so it was not deleted",
          503,
          ErrorCodes.MAIL_HOSTING_UNAVAILABLE
        );
      }
      if (count > 0) {
        throw new AppError("The mailbox still holds mail on the mail server", 409, ErrorCodes.MAILBOX_NOT_EMPTY);
      }
    }

    await prisma.$transaction(async (tx) => {
      const marked = await tx.mailbox.updateMany({
        where: { id: mailboxId, tenantId: context.tenantId, deletionRequestedAt: null },
        data: { deletionRequestedAt: new Date(), deletionError: null },
      });
      // Two requests at once: the second changes nothing and reports the first.
      if (marked.count === 0) return;

      const fresh = {
        providerAccountId: mailbox.providerAccountId,
        address: mailbox.address,
        reason: "ADMIN_DELETE" as const,
        requireEmpty: true,
        requestedByUserId: context.userId,
        requestId: context.requestId ?? null,
      };
      await tx.mailProviderCleanupTask.upsert({
        where: { mailboxId },
        create: {
          tenantId: context.tenantId,
          mailboxId,
          provider: mailbox.provider!,
          credentialRef: credentialRef(mailboxId),
          ...fresh,
        },
        // A task left over from an earlier, refused attempt starts again.
        update: {
          ...fresh,
          status: "PENDING",
          attempts: 0,
          runAt: new Date(),
          lockedAt: null,
          providerGoneAt: null,
          secretRemovedAt: null,
          lastErrorCode: null,
          outcome: null,
          completedAt: null,
        },
      });
      await this.audit(tx, context, "MAILBOX_DELETION_REQUESTED", mailboxId, {
        address: mailbox.address,
        provider: mailbox.provider!,
      });
    });

    return this.view(context.tenantId, mailboxId);
  }

  /** Put a dead-lettered deletion back in the queue. */
  async retryDeletion(mailboxId: string, context: CleanupContext) {
    const mailbox = await this.loadMailbox(context.tenantId, mailboxId);
    if (!mailbox.provider || !mailbox.deletionRequestedAt) {
      throw new AppError("This mailbox has no deletion to retry", 409, ErrorCodes.CONFLICT, { reason: "NOT_DELETING" });
    }
    if (!this.isEnabled()) {
      throw new AppError(
        "Deleting hosted mailboxes is not enabled on this deployment",
        503,
        ErrorCodes.MAILBOX_DELETE_DISABLED
      );
    }

    const reset = await prisma.$transaction(async (tx) => {
      const moved = await tx.mailProviderCleanupTask.updateMany({
        where: { mailboxId, tenantId: context.tenantId, status: "FAILED" },
        data: { status: "PENDING", attempts: 0, runAt: new Date(), lockedAt: null, lastErrorCode: null },
      });
      if (moved.count === 0) return false;
      await tx.mailbox.updateMany({ where: { id: mailboxId, tenantId: context.tenantId }, data: { deletionError: null } });
      await this.audit(tx, context, "MAILBOX_DELETION_RETRIED", mailboxId, { address: mailbox.address });
      return true;
    });
    if (!reset) {
      throw new AppError("Only a failed deletion can be retried", 409, ErrorCodes.CONFLICT, { reason: "NOT_FAILED" });
    }
    return this.view(context.tenantId, mailboxId);
  }

  private async view(tenantId: string, mailboxId: string) {
    const [mailbox, task] = await Promise.all([
      prisma.mailbox.findFirst({ where: { id: mailboxId, tenantId }, select: { id: true, deletionRequestedAt: true, deletionError: true } }),
      prisma.mailProviderCleanupTask.findFirst({
        where: { mailboxId, tenantId },
        select: { id: true, status: true, attempts: true, lastErrorCode: true, outcome: true },
      }),
    ]);
    return {
      deleted: false as const,
      status: "DELETING" as const,
      mailboxId,
      deletionRequestedAt: mailbox?.deletionRequestedAt ?? null,
      deletionError: mailbox?.deletionError ?? null,
      taskId: task?.id ?? null,
      taskStatus: task?.status ?? null,
      attempts: task?.attempts ?? 0,
      lastErrorCode: task?.lastErrorCode ?? null,
    };
  }

  // ─── The worker ───────────────────────────────────────────────────────────

  /**
   * Take one due task. A task is due when it is PENDING and its time has
   * come, or when it is RUNNING and its lease has run out — which is what a
   * worker that died mid-task looks like. FOR UPDATE SKIP LOCKED keeps two
   * workers off one row.
   */
  private async claim(): Promise<MailProviderCleanupTask | null> {
    const leaseSeconds = env.MAIL_CLEANUP_LEASE_MS / 1000;
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "mail_provider_cleanup_tasks"
      SET "status"='RUNNING', "locked_at"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
          "attempts"="attempts"+1, "updated_at"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      WHERE "id"=(
        SELECT "id" FROM "mail_provider_cleanup_tasks"
        WHERE (
          ("status"='PENDING' AND "run_at"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
          OR ("status"='RUNNING' AND "locked_at"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-(${leaseSeconds}::double precision * INTERVAL '1 second'))
        )
        ORDER BY "run_at"
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      RETURNING "id"`;
    return rows[0] ? prisma.mailProviderCleanupTask.findUnique({ where: { id: rows[0].id } }) : null;
  }

  /** Process one due task. Never throws for a task's own failure. */
  async processNext(): Promise<{ processed: boolean; reason?: "DISABLED"; taskId?: string; status?: string }> {
    // Disabled means waiting, not failing: tasks queued by an erasure stay
    // queued, with their attempts untouched, until deletion is switched on.
    if (!this.isEnabled()) return { processed: false, reason: "DISABLED" };

    return withCrossTenant(async () => {
      const task = await this.claim();
      if (!task) return { processed: false };
      await this.processTask(task);
      const after = await prisma.mailProviderCleanupTask.findUnique({ where: { id: task.id }, select: { status: true } });
      return { processed: true, taskId: task.id, status: after?.status };
    });
  }

  /** Process due tasks until none are left or `limit` is reached. */
  async processDue(limit = 10): Promise<number> {
    let processed = 0;
    while (processed < limit) {
      const result = await this.processNext();
      if (!result.processed) break;
      processed += 1;
    }
    return processed;
  }

  private async processTask(task: MailProviderCleanupTask): Promise<void> {
    try {
      // Attempts are counted at claim, so a task that keeps killing its worker
      // exceeds the limit without ever reaching a handler that could count it.
      if (task.attempts > task.maxAttempts) {
        await this.deadLetter(task, "LEASE_EXHAUSTED");
        return;
      }
      await this.execute(task);
    } catch (error) {
      await this.handleFailure(task, error);
    }
  }

  /** Write to the task only while this worker still holds its lease. */
  private async settle(task: MailProviderCleanupTask, data: Prisma.MailProviderCleanupTaskUpdateManyMutationInput) {
    const moved = await prisma.mailProviderCleanupTask.updateMany({
      where: { id: task.id, status: "RUNNING", lockedAt: task.lockedAt },
      data,
    });
    if (moved.count === 0) throw new LeaseLost();
    return prisma.mailProviderCleanupTask.findUniqueOrThrow({ where: { id: task.id } });
  }

  private async execute(task: MailProviderCleanupTask): Promise<void> {
    let current = task;

    if (!current.providerGoneAt) {
      const outcome = await this.removeAccount(task);
      current = await this.settle(task, { providerGoneAt: new Date(), outcome });
    }

    if (!current.secretRemovedAt) {
      // Only now: the account is confirmed gone. Deleting the credential of an
      // account that still exists would strand it.
      await deleteSecret(task.credentialRef, {
        purpose: "Hosted mailbox cleanup",
        tenantId: task.tenantId,
        requestId: task.requestId ?? undefined,
      });
      current = await this.settle(task, { secretRemovedAt: new Date() });
    }

    await this.finish(current);
  }

  /** Whether this task still has to find the account empty. Read fresh: an erasure can lift it. */
  private async mustBeEmpty(task: MailProviderCleanupTask): Promise<boolean> {
    const fresh = await prisma.mailProviderCleanupTask.findUnique({ where: { id: task.id }, select: { requireEmpty: true } });
    return fresh?.requireEmpty ?? task.requireEmpty;
  }

  /** Prove the account is ours, check it is empty if required, destroy it. */
  private async removeAccount(task: MailProviderCleanupTask): Promise<"DELETED" | "ALREADY_ABSENT"> {
    const [localPart, domainName] = task.address.toLowerCase().split("@") as [string, string];
    const hostDomain = await this.provider.findDomain(domainName);

    let account: HostedAccount | null = null;
    if (task.providerAccountId) account = await this.provider.getAccount(task.providerAccountId);
    else if (hostDomain) account = await this.provider.findAccount(localPart, hostDomain.id);
    if (!account) return "ALREADY_ABSENT";

    // Ownership, in full: this mailbox's marker, its own name, its own domain.
    // Anything less and it is somebody else's account, or one that was
    // renamed, and it is left alone.
    const owned =
      hostDomain !== null &&
      account.domainId === hostDomain.id &&
      account.name.toLowerCase() === localPart &&
      Boolean(account.description?.includes(ownershipMarker(task.mailboxId)));
    if (!owned) throw new Blocked("OWNERSHIP_MISMATCH");

    if (await this.mustBeEmpty(task)) {
      // Throws COUNT_UNAVAILABLE when the answer is not reliable, which fails
      // the attempt — it is never read as zero.
      const count = await this.provider.countMessages(account.id);
      if (count > 0) throw new Blocked("NON_EMPTY");
    }

    return this.provider.deleteAccount(account.id);
  }

  /** The tenant may already be gone, and with it the right to write audit rows for it. */
  private async tenantExists(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    return (await tx.tenant.count({ where: { id: tenantId } })) > 0;
  }

  /**
   * The audit row for work the worker did. Erasure tasks record the mailbox
   * id and not the address: the person asked to be forgotten, and an
   * append-only log is the one place that could not later forget them.
   */
  private async auditWork(
    tx: Prisma.TransactionClient,
    task: MailProviderCleanupTask,
    eventType: string,
    extra: Prisma.InputJsonObject = {}
  ) {
    if (!(await this.tenantExists(tx, task.tenantId))) return;
    const admin = task.reason === "ADMIN_DELETE";
    await auditService.record(
      {
        tenantId: task.tenantId,
        actorUserId: admin ? task.requestedByUserId : null,
        actorType: admin ? "ADMIN" : "SYSTEM",
        eventType,
        targetType: "Mailbox",
        targetId: task.mailboxId,
        requestId: task.requestId,
        metadata: { taskId: task.id, reason: task.reason, ...(admin ? { address: task.address } : {}), ...extra },
      },
      tx
    );
  }

  private async finish(task: MailProviderCleanupTask): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // The Zoiko row goes only now, with the host's confirmation behind it.
      if (task.reason === "ADMIN_DELETE") {
        await tx.mailbox.deleteMany({
          where: { id: task.mailboxId, tenantId: task.tenantId, deletionRequestedAt: { not: null } },
        });
      }
      const done = await tx.mailProviderCleanupTask.updateMany({
        where: { id: task.id, status: "RUNNING", lockedAt: task.lockedAt },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          lockedAt: null,
          lastErrorCode: null,
          ...(task.reason === "ADMIN_DELETE" ? {} : { address: redactedAddress(task.address) }),
        },
      });
      // Lost the lease meanwhile: roll the mailbox deletion back with it.
      if (done.count === 0) throw new LeaseLost();

      if (task.reason === "ADMIN_DELETE" && (await this.tenantExists(tx, task.tenantId))) {
        await this.auditWork(tx, task, "MAILBOX_DELETED", { providerOutcome: task.outcome });
      }
      await this.auditWork(tx, task, "MAILBOX_PROVIDER_CLEANUP_COMPLETED", { providerOutcome: task.outcome });
    });
  }

  private async handleFailure(task: MailProviderCleanupTask, error: unknown): Promise<void> {
    if (error instanceof LeaseLost) {
      logger.warn({ taskId: task.id }, "Mailbox cleanup lost its lease");
      return;
    }
    try {
      if (error instanceof Blocked) {
        await this.block(task, error.code);
        return;
      }

      const code = error instanceof StalwartError ? `STALWART_${error.code}` : "INTERNAL_ERROR";
      const retryable = error instanceof StalwartError ? error.retryable : true;
      if (error instanceof StalwartError) {
        logger.warn({ taskId: task.id, code, retryable }, "Mailbox cleanup attempt failed");
      } else {
        logger.error({ err: error, taskId: task.id }, "Mailbox cleanup failed unexpectedly");
      }

      if (error instanceof StalwartError && error.code === "NOT_CONFIGURED") {
        // Not the task's fault: look again later without using an attempt.
        await this.settle(task, {
          status: "PENDING",
          attempts: Math.max(0, task.attempts - 1),
          runAt: new Date(Date.now() + NOT_CONFIGURED_DELAY_MS),
          lockedAt: null,
          lastErrorCode: code,
        });
        return;
      }

      if (!retryable || task.attempts >= task.maxAttempts) {
        await this.deadLetter(task, code);
        return;
      }

      const backoff = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, task.attempts - 1), BACKOFF_CAP_MS);
      await this.settle(task, {
        status: "PENDING",
        runAt: new Date(Date.now() + backoff * (1 + Math.random() * 0.2)),
        lockedAt: null,
        lastErrorCode: code,
      });
    } catch (inner) {
      if (inner instanceof LeaseLost) return;
      logger.error({ err: inner, taskId: task.id }, "Mailbox cleanup could not record its own failure");
    }
  }

  /** Refused on purpose. A non-empty mailbox is put back; a foreign account stays flagged. */
  private async block(task: MailProviderCleanupTask, code: "NON_EMPTY" | "OWNERSHIP_MISMATCH"): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.mailProviderCleanupTask.updateMany({
        where: { id: task.id, status: "RUNNING", lockedAt: task.lockedAt },
        data: { status: "BLOCKED", outcome: code, lastErrorCode: code, lockedAt: null },
      });
      if (moved.count === 0) throw new LeaseLost();

      await tx.mailbox.updateMany({
        where: { id: task.mailboxId, tenantId: task.tenantId },
        // Mail turned up after the request: the mailbox is not going anywhere.
        data: code === "NON_EMPTY" ? { deletionRequestedAt: null, deletionError: code } : { deletionError: code },
      });
      await this.auditWork(tx, task, "MAILBOX_PROVIDER_CLEANUP_BLOCKED", { code });
    });
  }

  private async deadLetter(task: MailProviderCleanupTask, code: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.mailProviderCleanupTask.updateMany({
        where: { id: task.id, status: "RUNNING", lockedAt: task.lockedAt },
        data: { status: "FAILED", lastErrorCode: code, lockedAt: null },
      });
      if (moved.count === 0) throw new LeaseLost();
      await tx.mailbox.updateMany({ where: { id: task.mailboxId, tenantId: task.tenantId }, data: { deletionError: code } });
      await this.auditWork(tx, task, "MAILBOX_PROVIDER_CLEANUP_FAILED", { code, attempts: task.attempts });
    });
  }

  // ─── Retention ────────────────────────────────────────────────────────────

  /** Remove completed tasks older than the retention window. Returns how many. */
  async purgeCompleted(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - env.MAIL_CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await withCrossTenant(() =>
      prisma.mailProviderCleanupTask.deleteMany({ where: { status: "COMPLETED", completedAt: { lt: cutoff } } })
    );
    return count;
  }
}

export const mailboxCleanupService = new MailboxCleanupService();

export type { MailProviderCleanupReason };
