import type { Project } from "@playwright/test";

/**
 * The Browser Unit project, shared by the dedicated config and the default bundle.
 *
 * These tests mount one real component — DOM, PixiJS, the actual UI class — and drive it
 * with injected state and callbacks. They never sign in, never call the API and never open a
 * WebSocket, so the only thing they need served is the module graph. Both configs must
 * define this project identically or "it passes on its own" and "it passes in the bundle"
 * would stop meaning the same thing.
 */
export function browserUnitProject(baseURL: string): Project {
  return {
    name: "unit-browser",
    testDir: "./tests/unit/browser",
    testMatch: "**/*.spec.ts",
    use: {
      baseURL,
      browserName: "chromium",
      headless: true,
      actionTimeout: 30_000,
      navigationTimeout: 60_000,
    },
  };
}
