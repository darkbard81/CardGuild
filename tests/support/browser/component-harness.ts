import { expect, type Page } from "@playwright/test";

/**
 * Put one component on the page, with nothing else running.
 *
 * The app shell is real HTML served by Vite, but `main.ts` — which signs in, calls the API
 * and opens a WebSocket — is replaced before it ever executes. That is what makes these
 * component tests: they need the module graph and a DOM, not a server. Loading the app
 * first and adding a component on top of it, which is what these tests used to do, made
 * every one of them depend on an API that had nothing to do with what they check.
 *
 * The stylesheet is loaded here rather than left to the entry module because `main.ts` is
 * also where the real app imports it. Without it a component renders unstyled, and a test
 * about what fits on a 1024x768 screen would be measuring a page that has no layout at all.
 */
export async function mountComponent(page: Page, entryModule = "/tests/fixtures/component-shell.ts"): Promise<void> {
  await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import "/src/style.css";\nimport ${JSON.stringify(entryModule)};`,
  }));
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
}
