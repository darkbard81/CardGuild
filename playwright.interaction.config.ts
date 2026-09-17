import { defineConfig } from "@playwright/test";

const port = Number(process.env.CARDGUILD_INTERACTION_PORT ?? 4191);
export default defineConfig({
  testDir: "./tests/interaction", testMatch: "**/*.spec.ts", testIgnore: "**/support/**",
  fullyParallel: false, workers: 1, retries: 0, timeout: 20_000,
  expect: { timeout: 5_000 }, forbidOnly: Boolean(process.env.CI),
  outputDir: "test-results/interaction", reporter: [["list"]],
  use: { actionTimeout: 5_000, baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", viewport: { width: 1024, height: 768 },
    trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
