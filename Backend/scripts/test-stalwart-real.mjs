// Runs tests/stalwart.real.test.ts against a real Stalwart v0.16.25 in Docker.
// Needs Docker only: its own vitest config skips the database setup.
// A launcher rather than an inline `VAR=1 vitest`, so it works in PowerShell too.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vitest", "run", "--config", "vitest.stalwart-real.config.ts", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, STALWART_REAL_TEST: "1" },
});
process.exit(result.status ?? 1);
