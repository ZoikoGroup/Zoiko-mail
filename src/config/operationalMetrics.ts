interface WorkerSnapshot {
  lastRunAt: string | null;
  successes: number;
  failures: number;
}

class OperationalMetrics {
  private readonly startedAt = Date.now();
  private requests = 0;
  private activeRequests = 0;
  private requestErrors = 0;
  private durationMsTotal = 0;
  private durationMsMax = 0;
  private readonly statusClasses = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  private readonly scheduledMail: WorkerSnapshot = { lastRunAt: null, successes: 0, failures: 0 };
  private readonly backgroundJobs: WorkerSnapshot = { lastRunAt: null, successes: 0, failures: 0 };

  requestStarted() {
    this.requests += 1;
    this.activeRequests += 1;
  }

  requestFinished(statusCode: number, durationMs: number) {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.durationMsTotal += durationMs;
    this.durationMsMax = Math.max(this.durationMsMax, durationMs);
    if (statusCode >= 500) this.requestErrors += 1;
    const key = `${Math.min(Math.floor(statusCode / 100), 5)}xx` as keyof typeof this.statusClasses;
    if (key in this.statusClasses) this.statusClasses[key] += 1;
  }

  scheduledRun(success: boolean) {
    this.scheduledMail.lastRunAt = new Date().toISOString();
    this.scheduledMail[success ? "successes" : "failures"] += 1;
  }

  jobRun(success: boolean) {
    this.backgroundJobs.lastRunAt = new Date().toISOString();
    this.backgroundJobs[success ? "successes" : "failures"] += 1;
  }

  render(extra: { pendingJobs: number; dueScheduledMail: number }) {
    const memory = process.memoryUsage();
    const average = this.requests > 0 ? this.durationMsTotal / this.requests : 0;
    const lines = [
      "# HELP zoiko_uptime_seconds Process uptime in seconds.",
      "# TYPE zoiko_uptime_seconds gauge",
      `zoiko_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      "# HELP zoiko_http_requests_total HTTP requests received.",
      "# TYPE zoiko_http_requests_total counter",
      `zoiko_http_requests_total ${this.requests}`,
      `zoiko_http_active_requests ${this.activeRequests}`,
      `zoiko_http_request_errors_total ${this.requestErrors}`,
      `zoiko_http_request_duration_ms_average ${average.toFixed(3)}`,
      `zoiko_http_request_duration_ms_max ${this.durationMsMax.toFixed(3)}`,
      ...Object.entries(this.statusClasses).map(([statusClass, count]) =>
        `zoiko_http_responses_total{status_class="${statusClass}"} ${count}`),
      `zoiko_process_resident_memory_bytes ${memory.rss}`,
      `zoiko_process_heap_used_bytes ${memory.heapUsed}`,
      `zoiko_background_jobs_pending ${extra.pendingJobs}`,
      `zoiko_scheduled_mail_due ${extra.dueScheduledMail}`,
      `zoiko_scheduler_runs_total{outcome="success"} ${this.scheduledMail.successes}`,
      `zoiko_scheduler_runs_total{outcome="failure"} ${this.scheduledMail.failures}`,
      `zoiko_job_worker_runs_total{outcome="success"} ${this.backgroundJobs.successes}`,
      `zoiko_job_worker_runs_total{outcome="failure"} ${this.backgroundJobs.failures}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

export const operationalMetrics = new OperationalMetrics();
