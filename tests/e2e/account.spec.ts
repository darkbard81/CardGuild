import { expect, test } from "@playwright/test";

import { DEV_HOST_A, DEV_HOST_B, openApp, signInAsHost } from "../support/browser/host-login";

test("keeps hosting behind a sign-in while a guest still needs nothing", async ({ page }) => {
  await openApp(page);

  // The guest entry is the landing itself: a session ID and a name, no account.
  await expect(page.locator("#join-session-id")).toBeVisible();
  await expect(page.locator("#session-display-name")).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "anonymous");

  await page.locator("#host-login").click();
  await expect(page.locator("#account-username")).toBeVisible();
  await page.locator("#account-username").fill(DEV_HOST_A.username);
  await page.locator("#account-password").fill("not the password");
  await page.locator("#account-login").click();

  await expect(page.locator("#session-status")).toContainText("incorrect");
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "anonymous");
  await expect(page.locator("#new-campaign")).toHaveCount(0);
});

test("opens a campaign the account owns and starts its live session", async ({ page }) => {
  await signInAsHost(page);
  const name = `Owned ${Date.now()}`;
  await page.locator("#new-campaign-name").fill(name);
  await page.locator("#campaign-display-name").fill("Campaign Host");
  await page.locator("#new-campaign").click();

  await expect(page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
  await expect(page.locator("#invite-session-id")).toContainText(/^session_[A-Za-z0-9_-]+$/);

  // Coming back to the account shows the campaign it just created.
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "resumed");
  await page.evaluate(() => sessionStorage.removeItem("cardguild.session.v2"));
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  await expect(page.locator(`#campaign-list li:has-text("${name}")`)).toHaveCount(1);
});

test("never shows one account's campaign to another, and signing out returns to the guest landing", async ({ browser }) => {
  const first = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const second = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    const owner = await first.newPage();
    await signInAsHost(owner, DEV_HOST_A);
    const name = `Private ${Date.now()}`;
    await owner.locator("#new-campaign-name").fill(name);
    await owner.locator("#campaign-display-name").fill("Owner");
    await owner.locator("#new-campaign").click();
    await expect(owner.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");

    const stranger = await second.newPage();
    await signInAsHost(stranger, DEV_HOST_B);
    // The other account's campaign is not merely locked; it is not listed at all.
    await expect(stranger.locator(`#campaign-list li:has-text("${name}")`)).toHaveCount(0);

    await stranger.locator("#account-logout").click();
    await expect(stranger.locator("#app")).toHaveAttribute("data-auth", "anonymous");
    await expect(stranger.locator("#host-login")).toBeVisible();
    await expect(stranger.locator("#new-campaign")).toHaveCount(0);
  } finally {
    await first.close();
    await second.close();
  }
});

test("offers no way to continue a campaign that has no saved progress yet", async ({ page }) => {
  await signInAsHost(page);
  const name = `Fresh ${Date.now()}`;
  await page.locator("#new-campaign-name").fill(name);
  await page.locator("#campaign-display-name").fill("Owner");
  await page.locator("#new-campaign").click();
  await expect(page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");

  await page.evaluate(() => sessionStorage.removeItem("cardguild.session.v2"));
  await page.reload();
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  // M9-2 stores no gameplay snapshot, so Continue stays unavailable until M9-3.
  await expect(page.locator(`#campaign-list li:has-text("${name}") button`)).toBeDisabled();
});

test("creates an account from the landing page and lets it host straight away", async ({ page, browser }) => {
  // The development database outlives a run, and a username can only be taken once, so the
  // name carries the run with it — the same reason campaign names do.
  const username = `signup-${String(Date.now())}-${Math.random().toString(36).slice(2, 6)}`;
  const password = "a long enough password";
  await openApp(page);
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "anonymous");
  await page.locator("#host-register").click();
  await expect(page.locator("#register-submit")).toBeVisible();

  // A mistyped confirmation is caught here, before it can become a real attempt.
  await page.locator("#register-username").fill(username);
  await page.locator("#register-password").fill(password);
  await page.locator("#register-password-confirm").fill("a long enough passward");
  await page.locator("#register-submit").click();
  await expect(page.locator("#session-status")).toContainText("비밀번호가 서로 다릅니다");
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "anonymous");

  // The server's own refusals reach the same line.
  await page.locator("#register-password").fill("short");
  await page.locator("#register-password-confirm").fill("short");
  await page.locator("#register-submit").click();
  await expect(page.locator("#session-status")).toContainText("8 characters");

  await page.locator("#register-password").fill(password);
  await page.locator("#register-password-confirm").fill(password);
  await page.locator("#register-submit").click();

  // Signing up signs you in, so the next screen is the campaign list, not the login form.
  await expect(page.locator("#app")).toHaveAttribute("data-auth", "authenticated");
  await expect(page.locator("#new-campaign")).toBeVisible();

  // The same username cannot be taken twice, and the refusal says so on a fresh page that
  // has no session of its own.
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    const impostor = await context.newPage();
    await openApp(impostor);
    await impostor.locator("#host-register").click();
    await impostor.locator("#register-username").fill(username);
    await impostor.locator("#register-password").fill("a different password");
    await impostor.locator("#register-password-confirm").fill("a different password");
    await impostor.locator("#register-submit").click();
    await expect(impostor.locator("#session-status")).toContainText("already taken");
    await expect(impostor.locator("#app")).toHaveAttribute("data-auth", "anonymous");
  } finally {
    await context.close();
  }
});
