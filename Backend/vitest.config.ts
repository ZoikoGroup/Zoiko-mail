import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: "./tests/global-setup.ts",
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
