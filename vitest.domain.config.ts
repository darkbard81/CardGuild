import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/domain/**/*.test.ts"],
    exclude: ["node_modules/**"],
    environment: "node",
    passWithNoTests: false,
    retry: 0, maxWorkers: 4,
    testTimeout: 5_000,
  },
});
