// Runs the API for local development and keeps it running.
//
//   node scripts/dev-api.mjs        (what dev-up.ps1 starts, in its own window)
//
// `tsx watch` reloads the API when a file changes, but when the API itself
// dies it just waits for the next edit — the port closes, the window scrolls,
// and the web app can only say "isn't running". That is how the API kept
// disappearing mid-afternoon with no trace of why.
//
// This keeps tsx watch (so edits still reload) and adds what it lacks:
//   - everything the API prints also goes to Backend/.dev-api.log, so a crash
//     can be read afterwards (the log is git-ignored and trimmed at 5 MB);
//   - /api/health is checked every 10s, and an API that stops answering for
//     30s is restarted, with a backoff so a broken edit doesn't spin.
//
// DATABASE_URL and PORT come from the environment (dev-up sets them).

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logFile = path.join(backend, ".dev-api.log");
const port = Number(process.env.PORT ?? 5000);
const health = `http://127.0.0.1:${port}/api/health`;

const CHECK_EVERY_MS = 10_000;
const DOWN_CHECKS_BEFORE_RESTART = 3; // 30s without an answer
const FIRST_START_GRACE_MS = 120_000; // a cold start compiles a lot

function log(line) {
  const stamped = `[dev-api ${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  write(`${stamped}\n`);
}

function write(text) {
  try {
    if (existsSync(logFile) && statSync(logFile).size > 5 * 1024 * 1024) {
      renameSync(logFile, `${logFile}.1`); // keep one previous log
    }
    appendFileSync(logFile, text);
  } catch {
    // Logging must never be what stops the API.
  }
}

async function answers() {
  try {
    const res = await fetch(health, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

let child = null;
let startedAt = 0;
let everAnswered = false;
let downChecks = 0;
let restarts = 0;
let stopping = false;

function start() {
  startedAt = Date.now();
  everAnswered = false;
  downChecks = 0;
  log(`starting the API (tsx watch src/server.ts) on port ${port}`);
  const tsx = path.join(backend, "node_modules", "tsx", "dist", "cli.mjs");
  child = spawn(process.execPath, [tsx, "watch", "src/server.ts"], {
    cwd: backend,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    write(chunk);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    log(`the API watcher exited (code ${code ?? "-"}, signal ${signal ?? "-"})`);
    child = null;
    scheduleRestart();
  });
}

/** Ends the watcher and the API under it (Windows needs the whole tree). */
function stop() {
  if (!child) return;
  const pid = child.pid;
  child.removeAllListeners("exit");
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  child = null;
}

let restartTimer = null;
function scheduleRestart() {
  if (restartTimer || stopping) return;
  restarts += 1;
  // 2s, 4s, 8s … capped at 60s; reset once the API has stayed up.
  const delay = Math.min(2000 * 2 ** Math.min(restarts - 1, 5), 60_000);
  log(`restarting in ${Math.round(delay / 1000)}s (restart #${restarts})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    start();
  }, delay);
}

setInterval(async () => {
  if (!child || restartTimer) return;
  if (await answers()) {
    if (!everAnswered) log("the API is answering");
    everAnswered = true;
    downChecks = 0;
    if (Date.now() - startedAt > 5 * 60_000) restarts = 0;
    return;
  }
  // tsx is still running but nothing answers: the API under it died (and tsx
  // is waiting for an edit) or is wedged. Give a cold start its grace first.
  if (!everAnswered && Date.now() - startedAt < FIRST_START_GRACE_MS) return;
  downChecks += 1;
  if (downChecks >= DOWN_CHECKS_BEFORE_RESTART) {
    log(`no answer from ${health} for ${(downChecks * CHECK_EVERY_MS) / 1000}s; the API has stopped — see the lines above for why`);
    stop();
    scheduleRestart();
  }
}, CHECK_EVERY_MS);

for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, () => {
    stopping = true;
    log("stopping (Ctrl+C)");
    stop();
    process.exit(0);
  });
}

start();
