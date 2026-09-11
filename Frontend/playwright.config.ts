import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the sign-in and workspace-routing flows.
 *
 * These exist because the failures in this area leave no server trace: a
 * sign-in that returns 200 and then dead-ends in the client produces no
 * further API calls, so the backend logs show a clean success while the user
 * sits on the login form. The only way to see it is to drive a browser.
 *
 * Reuses an already-running dev server rather than starting its own, so a run
 * never fights the dev server someone has open.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // Generous, because the dev server compiles routes on demand: the first
  // visit to a page can take many seconds and has nothing to do with the
  // behaviour under test. A tighter budget just produces false failures on
  // whichever route happens to be cold.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
