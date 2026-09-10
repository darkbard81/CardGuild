import { defineConfig } from "@playwright/test";

/**
 * Screen captures for UI/UX review. Kept apart from playwright.config.ts so no layer of
 * `npm test` can rewrite review material as a side effect of running.
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
    command: "npm run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
