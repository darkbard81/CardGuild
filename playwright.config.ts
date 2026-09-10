import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    // Both default to 0 — no timeout — so a click on a control that never becomes enabled
    // waits out the whole test timeout and is then reported against whatever the cleanup
    // was doing, with no clue where it stopped. A bound turns that into a fast failure that
    // names the locator. Navigation gets more room because the first page load makes the
    // dev server compile the app on demand.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command: "CARDGUILD_ADVENTURE_SEED=1 npm run dev:coop",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
