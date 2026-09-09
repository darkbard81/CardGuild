import { expect, type Browser, type BrowserContext, type Page, test } from "@playwright/test";
import { DEV_HOST_A, openApp, signInAsHost } from "./host-login";

interface Player {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly errors: string[];
}

async function newPlayer(browser: Browser, viewport = { width: 1024, height: 768 }): Promise<Player> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { context, page, errors };
}

/** The dev database outlives a run, so every campaign gets a name only this test uses. */
function uniqueName(prefix: string): string {
  return `${prefix} ${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createCampaign(page: Page, name: string, displayName: string): Promise<void> {
  await signInAsHost(page, DEV_HOST_A);
  await page.locator("#new-campaign-name").fill(name);
  await page.locator("#campaign-display-name").fill(displayName);
  await page.locator("#new-campaign").click();
  await expect(page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
}

async function playIntoCombat(page: Page): Promise<string> {
  await page.locator("#apply-party").click();
  await expect(page.locator(".party-builder")).toHaveAttribute("data-party-prepared", "true");
  await expect(page.locator("#begin-adventure")).toBeEnabled();
  await page.locator("#begin-adventure").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  await page.getByRole("button", { name: "Enter Encounter" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
  const hash = await page.locator("#app").getAttribute("data-session-hash");
  expect(hash).toBeTruthy();
  return hash ?? "";
}

async function continueCampaign(page: Page, name: string): Promise<void> {
  const row = page.locator("#campaign-list li").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  const resume = row.getByRole("button", { name: "Continue" });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(page.locator("#app")).toHaveAttribute("data-lifecycle", "resume-lobby", { timeout: 20_000 });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("continues a saved campaign into a resume lobby and plays exactly on from it", async ({ browser }) => {
  test.setTimeout(90_000);
  const original = await newPlayer(browser);
  const returning = await newPlayer(browser);
  const name = uniqueName("Resume Solo");
  try {
    await createCampaign(original.page, name, "Resume Host");
    const savedHash = await playIntoCombat(original.page);

    // A new browser has no session credential: the campaign list is the only way back in.
    await signInAsHost(returning.page, DEV_HOST_A);
    await continueCampaign(returning.page, name);

    // The restored campaign shows its saved party, not a party editor, and never the battle.
    await expect(returning.page.locator("#app")).toHaveAttribute("data-screen", "session");
    await expect(returning.page.locator("#session-screen")).toHaveAttribute("data-lobby-kind", "resume");
    await expect(returning.page.locator(".party-builder")).toHaveAttribute("data-party-fixed", "true");
    await expect(returning.page.locator("#apply-party")).toHaveCount(0);
    await expect(returning.page.locator("#begin-adventure")).toHaveCount(0);
    // The battle HUD stays behind the session screen: no combat input exists before Resume.
    await expect(returning.page.locator("#end-turn")).toBeHidden();
    await expect(returning.page.locator(".guest-character-choice")).toHaveCount(3);
    await expect(returning.page.locator('[data-party-slot="1"]')).toContainText("Aerin");
    await expect(returning.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    // The resumed session is a new room with a new invite id.
    const originalSessionId = await original.page.locator("#app").getAttribute("data-session-id");
    await expect(returning.page.locator("#app")).not.toHaveAttribute("data-session-id", originalSessionId ?? "");

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await returning.page.setViewportSize(viewport);
      await expect(returning.page.locator("#resume-adventure")).toBeVisible();
      await expectNoHorizontalScroll(returning.page);
    }
    await returning.page.setViewportSize({ width: 1024, height: 768 });

    await returning.page.locator("#resume-adventure").click();
    await expect(returning.page.locator("#app")).toHaveAttribute("data-lifecycle", "active");
    await expect(returning.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
    // Resume itself is not a gameplay transition, so the restored hash survives it.
    await expect(returning.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    await expect(returning.page.locator("#app")).toHaveAttribute(
      "data-controlled-actor-ids",
      "party.hero-1,party.hero-2,party.hero-3",
    );

    expect(original.errors).toEqual([]);
    expect(returning.errors).toEqual([]);
  } finally {
    await original.context.close();
    await returning.context.close();
  }
});

test("retires the previous browser session and clears only its own credential", async ({ browser }) => {
  test.setTimeout(90_000);
  const original = await newPlayer(browser);
  const returning = await newPlayer(browser);
  const name = uniqueName("Resume Retire");
  try {
    await createCampaign(original.page, name, "Retiring Host");
    await playIntoCombat(original.page);

    await signInAsHost(returning.page, DEV_HOST_A);
    await continueCampaign(returning.page, name);

    // The old tab is told its session is gone, stops reconnecting, and drops its credential.
    await expect(original.page.locator("#app")).toHaveAttribute("data-session-error", "SESSION_RETIRED", {
      timeout: 20_000,
    });
    await expect(original.page.locator("#app")).toHaveAttribute("data-session-status", "closed");
    await expect.poll(() =>
      original.page.evaluate(() => sessionStorage.getItem("cardguild.session.v2"))).toBeNull();
    // A signed-in host lands back on their campaigns rather than the guest landing.
    await expect(original.page.locator("#new-campaign")).toBeVisible();

    // The tab that continued is unaffected and still holds its own fresh credential.
    await expect(returning.page.locator("#app")).toHaveAttribute("data-lifecycle", "resume-lobby");
    expect(await returning.page.evaluate(() => sessionStorage.getItem("cardguild.session.v2"))).not.toBeNull();
  } finally {
    await original.context.close();
    await returning.context.close();
  }
});

test("lets a guest rejoin a resumed campaign, reclaim a character, and resume with the host", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await newPlayer(browser);
  const returning = await newPlayer(browser);
  const guest = await newPlayer(browser);
  const name = uniqueName("Resume Duo");
  try {
    await createCampaign(host.page, name, "Duo Host");
    const savedHash = await playIntoCombat(host.page);

    await signInAsHost(returning.page, DEV_HOST_A);
    await continueCampaign(returning.page, name);
    const inviteId = await returning.page.locator("#invite-session-id").innerText();

    await openApp(guest.page);
    await guest.page.locator("#session-display-name").fill("Returning Guest");
    await guest.page.locator("#join-session-id").fill(inviteId);
    await guest.page.locator("#join-session").click();
    await expect(guest.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "guest");
    await expect(guest.page.locator("#app")).toHaveAttribute("data-lifecycle", "resume-lobby");
    // The saved party is what a returning guest chooses from; slot 1 stays the host's.
    await expect(guest.page.locator('.guest-character-choice[data-claim-state="host"]')).toHaveCount(1);
    await guest.page.locator('.guest-character-choice[data-member-id="party.hero-2"]').click();
    await expect(guest.page.locator('.guest-character-choice[data-claim-state="mine"]')).toHaveAttribute(
      "data-member-id",
      "party.hero-2",
    );
    // Reclaiming a saved character is control, not gameplay.
    await expect(guest.page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    await expect(guest.page.locator("#resume-adventure")).toBeDisabled();

    await returning.page.locator("#resume-adventure").click();
    for (const page of [returning.page, guest.page]) {
      await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
      await expect(page.locator("#app")).toHaveAttribute("data-session-hash", savedHash);
    }
    await expect(returning.page.locator("#app")).toHaveAttribute(
      "data-controlled-actor-ids",
      "party.hero-1,party.hero-3",
    );
    await expect(guest.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-2");

    // A guest who drops out hands their saved character straight back to the host.
    await guest.context.close();
    await expect(returning.page.locator("#app")).toHaveAttribute(
      "data-controlled-actor-ids",
      "party.hero-1,party.hero-2,party.hero-3",
      { timeout: 20_000 },
    );
    expect(returning.errors).toEqual([]);
  } finally {
    await host.context.close();
    await returning.context.close();
    if (!guest.page.isClosed()) await guest.context.close();
  }
});
