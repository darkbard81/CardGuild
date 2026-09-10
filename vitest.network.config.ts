import { defineConfig } from "vitest/config";

/**
 * Integration: real SQLite, real HTTP and WebSocket servers, and faults injected into a
 * server started from source.
 *
 * Files run one at a time. These suites bind ports, spawn child processes and open database
 * files, and two of them running at once is a flaky failure that looks like a product bug.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    fileParallelism: false,
  },
});
