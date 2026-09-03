import { defineConfig } from "@playwright/test";

/**
 * Screen captures for UI/UX review. Kept apart from playwright.config.ts so
 * `npm run test:smoke` stays a test run and never rewrites review material.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.capture.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    deviceScaleFactor: 2,
  },
  webServer: {
    command: "CARDGUILD_ADVENTURE_SEED=1 npm run dev:coop",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
