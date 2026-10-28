import { defineConfig } from "vitest/config";

/**
 * Config for `npm run test:stalwart-real` alone: the real Stalwart container
 * test needs Docker, not Postgres, so it skips the main config's database
 * migration (globalSetup) and per-test transaction (tests/setup.ts).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/stalwart.real.test.ts"],
    setupFiles: ["./tests/stalwart-real.setup.ts"],
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
