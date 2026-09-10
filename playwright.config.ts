import { defineConfig } from "@playwright/test";

import { browserUnitProject } from "./playwright.browser-unit.project";

const BASE_URL = "http://127.0.0.1:4173";

/**
 * The two browser layers, as separate projects.
 *
 * `unit-browser` mounts one component and injects its state; `e2e` opens the real app and
 * plays it the way a person would. They are run together by `test:smoke` but selectable
 * apart, because a component regression and a user-flow regression are answered by
 * different work.
 */
export default defineConfig({
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  use: {
    // Both default to 0 — no timeout — so a click on a control that never becomes enabled
    // waits out the whole test timeout and is then reported against whatever the cleanup
    // was doing, with no clue where it stopped. A bound turns that into a fast failure that
    // names the locator. Navigation gets more room because the first page load makes the
    // dev server compile the app on demand.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    browserUnitProject(BASE_URL),
    {
      name: "e2e",
      testDir: "./tests/e2e",
      testMatch: "**/*.spec.ts",
      use: {
        baseURL: BASE_URL,
        browserName: "chromium",
        headless: true,
      },
    },
  ],
  webServer: {
    command: "CARDGUILD_ADVENTURE_SEED=1 npm run dev:coop",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
