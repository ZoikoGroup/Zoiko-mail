import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma } from "./config/prisma.js";
import { logger } from "./config/logger.js";
import { mailService } from "./modules/mail/mail.service.js";
import { jobService } from "./modules/job/job.service.js";
import { operationalMetrics } from "./config/operationalMetrics.js";
import { connectorService } from "./modules/connector/connector.service.js";
import { providerMailService } from "./modules/provider-mail/provider-mail.service.js";
import { gmailConnector } from "./modules/connector/gmail/gmail.connector.js";
import { microsoftConnector } from "./modules/connector/m365/m365.connector.js";

const app = createApp();
const PORT = env.PORT;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, "Zoiko Mail API listening");
});

let schedulerRunning = false;
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
        const result = await gmailConnector.syncHistory(account.id, account.tenantId);
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
        const result = await microsoftConnector.syncInbox(account.id, account.tenantId);
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
  clearInterval(jobWorker);
  clearInterval(providerEventWorker);
  clearInterval(providerSync);
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
