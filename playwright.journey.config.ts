import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/journeys", testMatch: "**/*.spec.ts", testIgnore: "**/support/**",
  fullyParallel: false, workers: 1, retries: 0, timeout: 60_000,
  expect: { timeout: 8_000 }, forbidOnly: Boolean(process.env.CI),
  outputDir: "test-results/journey", reporter: [["list"]],
  use: { actionTimeout: 5_000, navigationTimeout: 10_000, browserName: "chromium", viewport: { width: 1024, height: 768 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
});
