import { defineConfig } from "@playwright/test";

/**
 * Server-restart recovery against the deployment build.
 *
 * Kept apart from `playwright.config.ts` for two reasons. It runs the built client served
 * by the real `dist-server/main.js` rather than the dev server, so the artefact under test
 * is the one a deployment ships. And every test here owns its own port, its own temporary
 * database and its own process that it stops and restarts, which cannot be shared with a
 * suite that reuses one long-lived dev server.
 */
export default defineConfig({
  // Checked before Chromium starts: this suite runs the deployment build and never makes it.
  globalSetup: "./tests/support/recovery/require-deployment.ts",
  testDir: "./tests/recovery",
  testMatch: "**/*.recovery.ts",
  // Restarts are process-level events; overlapping them would make failures unreadable.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: "list",
  timeout: 180_000,
  use: {
    browserName: "chromium",
    headless: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
});
