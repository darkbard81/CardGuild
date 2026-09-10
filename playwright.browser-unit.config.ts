import { defineConfig } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:4183";

/**
 * Unit / Browser: one real component — DOM, PixiJS, the actual UI class — driven with
 * injected state and callbacks.
 *
 * Only Vite runs. No API server, no database, no seeded accounts: these tests never sign in,
 * never call the API and never open a WebSocket, so the only thing they need served is the
 * module graph. That absence is the contract, which is why nothing is reused here — a co-op
 * server left running on this port would silently answer requests a component test is not
 * supposed to make, and `--strictPort` makes Vite fail instead of drifting to another port.
 */
export default defineConfig({
  testDir: "./tests/unit/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    headless: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4183 --strictPort",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
