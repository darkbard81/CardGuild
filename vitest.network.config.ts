import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/network/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    fileParallelism: false,
  },
});
