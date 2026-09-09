import { expect, type Page } from "@playwright/test";

/**
 * The fixed accounts `tools/dev-coop.ts` seeds before the dev server starts. Hosting needs
 * an account since M9-2, and there is no signup route, so every host-side browser test
 * comes through here. The second account exists so ownership isolation can be shown.
 */
export const DEV_HOST_A = { username: "dev-host-a", password: "dev-password-a" };
export const DEV_HOST_B = { username: "dev-host-b", password: "dev-password-b" };

/** Opens the app and waits until it has decided whether anyone is signed in. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#app")).not.toHaveAttribute("data-auth", "unknown");
}

/** Signs a host in and leaves the page on their campaign list. */
export async function signInAsHost(page: Page, account = DEV_HOST_A): Promise<void> {
  await openApp(page);
  if (await page.locator("#account-logout").count()) await page.locator("#account-logout").click();
  await page.locator("#host-login").click();
  await page.locator("#account-username").fill(account.username);
  await page.locator("#account-password").fill(account.password);
  await page.locator("#account-login").click();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  await expect(page.locator("#new-campaign")).toBeVisible();
}

/**
 * Signs in and opens a fresh campaign, which is also how a host starts a live session.
 * The campaign name is unique per call because the dev database outlives a single run.
 */
export async function createCampaignAsHost(
  page: Page,
  displayName: string,
  account = DEV_HOST_A,
): Promise<void> {
  await signInAsHost(page, account);
  await page.locator("#new-campaign-name").fill(`${displayName} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await page.locator("#campaign-display-name").fill(displayName);
  await page.locator("#new-campaign").click();
}
