import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectPrisma } from "./config/prisma.js";
import { logger } from "./config/logger.js";
import { mailService } from "./modules/mail/mail.service.js";
import { jobService } from "./modules/job/job.service.js";
import { operationalMetrics } from "./config/operationalMetrics.js";

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

server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Graceful shutdown started");
  clearInterval(scheduler);
  clearInterval(jobWorker);

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
