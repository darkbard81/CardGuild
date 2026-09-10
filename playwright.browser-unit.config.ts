import { defineConfig } from "@playwright/test";

import { browserUnitProject } from "./playwright.browser-unit.project";

const BASE_URL = "http://127.0.0.1:4183";

/**
 * Browser Unit on its own, with nothing behind it.
 *
 * Only Vite runs: no API server, no database, no seeded accounts. That is the point — if a
 * component test needs any of those, it is not a component test. Its own port keeps it from
 * colliding with a co-op server someone left running.
 */
export default defineConfig({
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  projects: [browserUnitProject(BASE_URL)],
  webServer: {
    // `npm run dev` also checks content and rebuilds assets; the prepared output is already
    // on disk and this suite only needs the modules served.
    command: "npx vite --host 127.0.0.1 --port 4183",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
