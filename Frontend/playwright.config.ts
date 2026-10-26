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
  // With E2E_BASE_URL set, the run is pointed at a server somebody already started
  // (for example on port 3100, so it never fights the dev server on 3000). Never
  // start another one in that case: on a cold start the readiness check can give
  // up early, and the fallback below would then try to take port 3000.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
