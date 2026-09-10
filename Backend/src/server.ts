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
  void Promise.all([lifecycleService.sweepOverdue(), purgeExpiredIdempotencyRecords()])
    .then(([sla, purged]) => {
      if (sla.breached > 0 || purged > 0) {
        logger.info({ ...sla, purgedIdempotencyRecords: purged }, "Compliance sweep completed");
      }
    })
    .catch((error: unknown) => logger.error({ error }, "Compliance sweep failed"))
    .finally(() => {
      complianceSweepRunning = false;
    });
}, env.COMPLIANCE_SWEEP_INTERVAL_MS);
complianceSweep.unref();

server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Graceful shutdown started");
  clearInterval(scheduler);
  clearInterval(jobWorker);
  clearInterval(providerEventWorker);
  clearInterval(complianceSweep);
  clearInterval(providerSync);

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
