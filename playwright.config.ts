import { defineConfig } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4173";

/**
 * E2E: the real app, opened and played the way a person would.
 *
 * This config collects `tests/e2e` and nothing else. Browser Unit has its own config with
 * its own server, because the two layers disagree about what must be running — one needs the
 * whole development bundle, the other must prove it needs none of it. Collecting both here
 * would run every component test twice and let a Browser Unit test quietly start passing
 * because a server it should not know about was up.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
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
    command: "npm run dev",
    url: BASE_URL,
    // Locally, reusing the server someone already has running saves a minute per run. On CI
    // there is nothing to reuse, and accepting a stranger on that port would mean testing
    // something other than this checkout.
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
