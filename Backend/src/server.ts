import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma } from "./config/prisma.js";
import { logger } from "./config/logger.js";
import { mailService } from "./modules/mail/mail.service.js";
import { jobService } from "./modules/job/job.service.js";
import { operationalMetrics } from "./config/operationalMetrics.js";
import { connectorService } from "./modules/connector/connector.service.js";
import { providerMailService } from "./modules/provider-mail/provider-mail.service.js";
import { lifecycleService } from "./modules/lifecycle/lifecycle.service.js";
import { purgeExpiredIdempotencyRecords } from "./common/middleware/idempotency.js";
import { gmailConnector } from "./modules/connector/gmail/gmail.connector.js";
import { microsoftConnector } from "./modules/connector/m365/m365.connector.js";
import { withCrossTenant, withTenant } from "./config/tenantScope.js";
import { assistantService } from "./modules/assistant/assistant.service.js";
import { runDueDomainSyncs } from "./modules/domain/domain.sync.js";
import { mailboxCleanupService } from "./modules/mail/mailbox-cleanup.service.js";
import { taskService } from "./modules/task/task.service.js";
import { notificationService } from "./modules/notification/notification.service.js";

const app = createApp();
const PORT = env.PORT;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Zoiko Mail API listening");
});

let schedulerRunning = false;
import { sseManager } from "./common/sse/sse.manager.js";

// Heartbeat ping every 30s to keep SSE connections alive
const sseHeartbeat = setInterval(() => sseManager.ping(), 30_000);
sseHeartbeat.unref();

const scheduler = setInterval(() => {
  if (schedulerRunning) return;
  schedulerRunning = true;
  void mailService.processDueScheduled()
    .then((result) => {
      operationalMetrics.scheduledRun(result.failed === 0);
      if (result.sent > 0 || result.failed > 0) logger.info(result, "Scheduled mail processing completed");
    })
    .catch((error: unknown) => {
      operationalMetrics.scheduledRun(false);
      logger.error({ error }, "Scheduled mail processing failed");
    })
    .finally(() => {
      schedulerRunning = false;
    });
}, env.MAIL_SCHEDULER_INTERVAL_MS);
scheduler.unref();

let snoozeWorkerRunning = false;
const snoozeWorker = setInterval(() => {
  if (snoozeWorkerRunning) return;
  snoozeWorkerRunning = true;
  void mailService.processDueSnoozes()
    .then((result) => {
      if (result.woken > 0) logger.info(result, "Snoozed mail wake-up completed");
    })
    .catch((error: unknown) => {
      logger.error({ error }, "Snoozed mail wake-up failed");
    })
    .finally(() => {
      snoozeWorkerRunning = false;
    });
}, env.SNOOZE_WAKE_INTERVAL_MS);
snoozeWorker.unref();

let reminderWorkerRunning = false;
const reminderWorker = setInterval(() => {
  if (reminderWorkerRunning) return;
  reminderWorkerRunning = true;
  void taskService.processDueReminders()
    .then((result) => {
      if (result.sent > 0) logger.info(result, "Task reminders sent");
    })
    .catch((error: unknown) => {
      logger.error({ error }, "Task reminder sweep failed");
    })
    .finally(() => {
      reminderWorkerRunning = false;
    });
}, env.TASK_REMINDER_INTERVAL_MS);
reminderWorker.unref();

// Daily digests: checked every ten minutes, queued once per local day.
let dailyDigestRunning = false;
const dailyDigestWorker = setInterval(() => {
  if (dailyDigestRunning) return;
  dailyDigestRunning = true;
  void notificationService.processDailyDigests()
    .then((result) => {
      if (result.queued > 0) logger.info(result, "Daily digests queued");
    })
    .catch((error: unknown) => {
      logger.error({ error }, "Daily digest sweep failed");
    })
    .finally(() => {
      dailyDigestRunning = false;
    });
}, 10 * 60 * 1000);
dailyDigestWorker.unref();

let jobWorkerRunning = false;
const jobWorker = setInterval(() => {
  if (jobWorkerRunning) return;
  jobWorkerRunning = true;
  void jobService.processNext()
    .then((result) => {
      operationalMetrics.jobRun(!("error" in result));
      if (result.processed) logger.info(result, "Background job processing completed");
    })
    .catch((error: unknown) => {
      operationalMetrics.jobRun(false);
      logger.error({ error }, "Background job processing failed");
    })
    .finally(() => {
      jobWorkerRunning = false;
    });
}, env.JOB_WORKER_INTERVAL_MS);
jobWorker.unref();

let providerEventWorkerRunning = false;
const providerEventWorker = setInterval(() => {
  if (providerEventWorkerRunning) return;
  providerEventWorkerRunning = true;
  void connectorService.processNextEvent()
    .then((result) => {
      operationalMetrics.providerEventRun(!("status" in result) || result.status !== "DEAD_LETTER");
      if (result.processed) logger.info(result, "Provider event processing completed");
    })
    .catch((error: unknown) => {
      operationalMetrics.providerEventRun(false);
      logger.error({ error }, "Provider event processing failed");
    })
    .finally(() => {
      providerEventWorkerRunning = false;
    });
}, env.PROVIDER_EVENT_WORKER_INTERVAL_MS);
providerEventWorker.unref();

let providerSyncRunning = false;
const providerSync = setInterval(() => {
  if (!env.MAIL_PROVIDER_ENABLED || providerSyncRunning) return;
  providerSyncRunning = true;
  void providerMailService.enqueueSync()
    .catch((error: unknown) => logger.error({ error }, "IMAP sync scheduling failed"))
    .finally(() => {
      providerSyncRunning = false;
    });
}, env.MAIL_PROVIDER_SYNC_INTERVAL_MS);
providerSync.unref();

if (env.MAIL_PROVIDER_ENABLED) {
  void providerMailService.enqueueSync()
    .catch((error: unknown) => logger.error({ error }, "Initial IMAP sync scheduling failed"));
}

/**
 * Compliance housekeeping.
 *
 * Two duties that are both about time passing: AC-012 wants a deletion past
 * its 30-day deadline to be visible as a breach rather than merely late, and
 * API §7 records stop being replayable after 24 hours and should not
 * accumulate forever.
 *
 * The sweep only records the breach; it deliberately does not execute the
 * deletion. A tenant erase requires a typed confirmation by design, and
 * having a timer perform the one action nobody confirmed would be the worst
 * possible reading of an SLA.
 */
let complianceSweepRunning = false;
const complianceSweep = setInterval(() => {
  if (complianceSweepRunning) return;
  complianceSweepRunning = true;
  void Promise.all([
    lifecycleService.sweepOverdue(),
    purgeExpiredIdempotencyRecords(),
    mailboxCleanupService.purgeCompleted(),
    // Files uploaded to the assistant and never sent, in every workspace.
    withCrossTenant(() => assistantService.purgeExpired()),
  ])
    .then(([sla, purged, purgedCleanup, purgedUploads]) => {
      if (sla.breached > 0 || purged > 0 || purgedCleanup > 0 || purgedUploads > 0) {
        logger.info(
          { ...sla, purgedIdempotencyRecords: purged, purgedCleanupTasks: purgedCleanup, purgedAssistantUploads: purgedUploads },
          "Compliance sweep completed"
        );
      }
    })
    .catch((error: unknown) => logger.error({ error }, "Compliance sweep failed"))
    .finally(() => {
      complianceSweepRunning = false;
    });
}, env.COMPLIANCE_SWEEP_INTERVAL_MS);
complianceSweep.unref();

// ─── Hosted mailbox cleanup ─────────────────────────────────────────────────
//
// Removes the accounts that deleted mailboxes, erased members and erased
// workspaces still have on the mail host. Does nothing at all while
// STALWART_DELETE_ENABLED is off: queued tasks wait, and no attempts are used.

let mailboxCleanupRunning = false;
const mailboxCleanup = setInterval(() => {
  if (mailboxCleanupRunning) return;
  mailboxCleanupRunning = true;
  void mailboxCleanupService.processDue()
    .then((processed) => {
      if (processed > 0) logger.info({ processed }, "Hosted mailbox cleanup completed");
    })
    .catch((error: unknown) => logger.error({ error }, "Hosted mailbox cleanup failed"))
    .finally(() => {
      mailboxCleanupRunning = false;
    });
}, env.MAIL_CLEANUP_INTERVAL_MS);
mailboxCleanup.unref();

// ─── Custom-domain DNS synchronization ──────────────────────────────────────
//
// Reconciles, publishes and verifies every domain whose next check is due,
// then reschedules it: minutes apart while an owner is publishing records,
// hours apart once the domain is healthy. This is what turns "add the records
// and press re-check" into records that verify themselves, and what notices
// when a record someone deleted breaks a domain that was working.

let domainSyncRunning = false;
const domainSync = setInterval(() => {
  if (domainSyncRunning) return;
  domainSyncRunning = true;
  void runDueDomainSyncs()
    .then((result) => {
      if (result.claimed > 0) logger.info(result, "Domain DNS synchronization completed");
    })
    .catch((error: unknown) => logger.error({ error }, "Domain DNS synchronization sweep failed"))
    .finally(() => {
      domainSyncRunning = false;
    });
}, env.DNS_SYNC_INTERVAL_MS);
domainSync.unref();

// ─── Gmail watch renewal (ZM-BE-005) ────────────────────────────────────────

let gmailWatchRenewRunning = false;
if (env.GMAIL_PUBSUB_TOPIC) {
  const gmailWatchRenew = setInterval(() => {
    if (gmailWatchRenewRunning) return;
    gmailWatchRenewRunning = true;
    void gmailConnector.renewExpiringWatches()
      .then((count) => {
        if (count > 0) logger.info({ renewed: count }, "Gmail watch renewal completed");
      })
      .catch((error: unknown) => {
        logger.error({ error }, "Gmail watch renewal failed");
      })
      .finally(() => {
        gmailWatchRenewRunning = false;
      });
  }, Math.max(env.GMAIL_SYNC_INTERVAL_MS / 2, 60_000));
  gmailWatchRenew.unref();
}

// ─── Gmail catch-up sync (ZM-BE-005) ────────────────────────────────────────

let gmailCatchUpRunning = false;
const gmailCatchUp = setInterval(() => {
  if (gmailCatchUpRunning) return;
  gmailCatchUpRunning = true;
  void (async () => {
    const { prisma } = await import("./config/prisma.js");
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: "GMAIL",
        status: { in: ["ACTIVE", "DEGRADED"] },
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: new Date(Date.now() - env.GMAIL_SYNC_INTERVAL_MS) } },
        ],
      },
      select: { id: true, tenantId: true },
      take: 20,
    });
    for (const account of accounts) {
      try {
        const result = await withTenant(account.tenantId, () =>
          gmailConnector.syncHistory(account.id, account.tenantId)
        );
        if (result.imported > 0) {
          logger.info({ accountId: account.id, ...result }, "Gmail catch-up sync imported messages");
        }
      } catch (error) {
        logger.warn({ accountId: account.id, error }, "Gmail catch-up sync failed");
      }
    }
  })()
    .catch((error: unknown) => {
      logger.error({ error }, "Gmail catch-up sweep failed");
    })
    .finally(() => {
      gmailCatchUpRunning = false;
    });
}, env.GMAIL_SYNC_INTERVAL_MS);
gmailCatchUp.unref();

// ─── Microsoft 365 subscription renewal + catch-up sync (ZM-BE-006) ─────────

let microsoftRenewRunning = false;
const microsoftRenew = setInterval(() => {
  if (microsoftRenewRunning) return;
  microsoftRenewRunning = true;
  void microsoftConnector.renewSubscriptions()
    .then((count) => {
      if (count > 0) logger.info({ renewed: count }, "Microsoft subscription renewal completed");
    })
    .catch((error: unknown) => {
      logger.error({ error }, "Microsoft subscription renewal failed");
    })
    .finally(() => {
      microsoftRenewRunning = false;
    });
}, Math.max(env.MICROSOFT_SYNC_INTERVAL_MS / 2, 60_000));
microsoftRenew.unref();

let microsoftCatchUpRunning = false;
const microsoftCatchUp = setInterval(() => {
  if (microsoftCatchUpRunning) return;
  microsoftCatchUpRunning = true;
  void (async () => {
    const { prisma } = await import("./config/prisma.js");
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        provider: "MICROSOFT_365",
        status: { in: ["ACTIVE", "DEGRADED"] },
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: new Date(Date.now() - env.MICROSOFT_SYNC_INTERVAL_MS) } },
        ],
      },
      select: { id: true, tenantId: true },
      take: 20,
    });
    for (const account of accounts) {
      try {
        const result = await withTenant(account.tenantId, () =>
          microsoftConnector.syncInbox(account.id, account.tenantId)
        );
        if (result.imported > 0) {
          logger.info({ accountId: account.id, ...result }, "Microsoft catch-up sync imported messages");
        }
      } catch (error) {
        logger.warn({ accountId: account.id, error }, "Microsoft catch-up sync failed");
      }
    }
  })()
    .catch((error: unknown) => {
      logger.error({ error }, "Microsoft catch-up sweep failed");
    })
    .finally(() => {
      microsoftCatchUpRunning = false;
    });
}, env.MICROSOFT_SYNC_INTERVAL_MS);
microsoftCatchUp.unref();

server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Graceful shutdown started");
  clearInterval(scheduler);
  clearInterval(snoozeWorker);
  clearInterval(reminderWorker);
  clearInterval(dailyDigestWorker);
  clearInterval(jobWorker);
  clearInterval(providerEventWorker);
  clearInterval(complianceSweep);
  clearInterval(providerSync);
  clearInterval(domainSync);
  clearInterval(gmailCatchUp);
  clearInterval(microsoftRenew);
  clearInterval(microsoftCatchUp);

  server.close(async () => {
    await disconnectPrisma();
    logger.info("Server and database connections closed");
    process.exit(0);
  });

  setTimeout(() => {
    logger.fatal("Forced shutdown after timeout");
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

// A process that dies should say why. Without these, a crash left nothing but
// a closed port: the API was simply gone, and the web app could only report
// "isn't running".
server.on("error", (error: NodeJS.ErrnoException) => {
  logger.fatal(
    { err: error, port: PORT },
    error.code === "EADDRINUSE" ? `Port ${PORT} is already in use; another API is running` : "HTTP server failed"
  );
  process.exit(1);
});

// A promise rejected with nobody listening is a bug in one code path, not a
// broken process: log it loudly and keep serving everyone else. (Node's
// default would end the process — and every other request with it.)
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

// An exception nothing caught leaves the process in an unknown state, so it
// still exits — after saying why — and the supervisor (the container's
// restart policy, or scripts/dev-api.mjs locally) starts a clean one.
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception; exiting");
  process.exit(1);
});    