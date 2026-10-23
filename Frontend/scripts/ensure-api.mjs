// Runs before `npm run dev` (the "predev" script): makes sure the API the
// frontend talks to is up, and starts it when it is a local one that is not.
//
// Why this exists. The frontend is useless without the API, and nothing else
// starts the API: after a reboot Docker brings Postgres back on its own, the
// usual command starts Postgres and the frontend, and the API — which only
// Backend/scripts/dev-up.ps1 ever started, in a window of its own — is simply
// not there. Every page then fails with "Unable to reach Zoiko Mail". Starting
// the API by hand is no better: Backend/.env points at a database port the dev
// container doesn't use, which only dev-up corrects.
//
// So starting the frontend now starts what it depends on, through dev-up, so
// there is one way the API gets started and it is the one that works.
//
// It never blocks the frontend: if the API still can't be brought up, it says
// why and lets Next start anyway. Skipped for a remote API (a tunnel, staging)
// and when ZOIKO_SKIP_API_CHECK=1.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "..");
const devUp = path.resolve(frontend, "../Backend/scripts/dev-up.ps1");

const say = (text) => console.log(`[ensure-api] ${text}`);

/** NEXT_PUBLIC_API_URL as Next will see it: the environment, then .env files in Next's order. */
function apiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
    const full = path.join(frontend, file);
    if (!existsSync(full)) continue;
    const line = readFileSync(full, "utf8")
      .split(/\r?\n/)
      .find((l) => /^\s*NEXT_PUBLIC_API_URL\s*=/.test(l));
    if (line) return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  }
  return "http://localhost:5000/api/v1"; // lib/config.ts's default
}

/** Any HTTP answer at all means the API is up; only a failed connection means it isn't. */
async function answers(base) {
  try {
    await fetch(`${base}/auth/me`, { signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

function shell() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore", shell: false });
    if (probe.status === 0) return candidate;
  }
  return null;
}

async function main() {
  if (process.env.ZOIKO_SKIP_API_CHECK === "1" || process.env.CI) return;

  const base = apiUrl().replace(/\/+$/, "");
  let host;
  try {
    host = new URL(base).hostname;
  } catch {
    say(`NEXT_PUBLIC_API_URL is not a URL (${base}); not checking the API.`);
    return;
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return; // remote API: not ours to start

  if (await answers(base)) {
    say(`API is up at ${base}`);
    return;
  }

  say(`The API at ${base} is not running.`);
  const ps = process.platform === "win32" ? shell() : null;
  if (!ps || !existsSync(devUp)) {
    say("Start it before signing in: Backend/scripts/dev-up.ps1 (Windows), or run the Backend with `npm run dev` and DATABASE_URL pointing at the dev database.");
    return;
  }

  say("Starting it with Backend/scripts/dev-up.ps1 -NoFrontend (database, schema, API)...");
  spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", devUp, "-NoFrontend"], { stdio: "inherit" });

  // dev-up waits for the port; the API may still be finishing its own start.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await answers(base)) {
      say(`API is up at ${base}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  say("The API still isn't answering. Check its window for the error; the frontend starts anyway.");
}

main().catch((error) => {
  // A broken check must never stop the frontend from starting.
  say(`check skipped: ${error instanceof Error ? error.message : String(error)}`);
});
