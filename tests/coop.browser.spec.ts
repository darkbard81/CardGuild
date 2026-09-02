import { expect, type Browser, type BrowserContext, type Page, test } from "@playwright/test";

interface BrowserPlayer {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly errors: string[];
}

async function createPlayer(
  browser: Browser,
  name: string,
  viewport = { width: 1024, height: 768 },
): Promise<BrowserPlayer> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "session");
  await page.locator("#session-display-name").fill(name);
  return { context, page, errors };
}

async function createHost(player: BrowserPlayer): Promise<string> {
  await player.page.locator("#create-session").click();
  await expect(player.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
  const sessionId = await player.page.locator("#invite-session-id").innerText();
  expect(sessionId).toMatch(/^session_[A-Za-z0-9_-]+$/);
  return sessionId;
}

async function applyThreeCharacterParty(page: Page): Promise<void> {
  await expect(page.locator(".party-character-card")).toHaveCount(3);
  await expect(page.locator(".party-character-art")).toHaveCount(3);
  await expect(page.locator("#party-slot-1")).toHaveValue("hero.aerin");
  await expect(page.locator("#party-slot-2")).toHaveValue("hero.lyra");
  await expect(page.locator("#party-slot-3")).toHaveValue("hero.brom");
  await page.locator("#apply-party").click();
  await expect(page.locator("#session-screen")).toHaveAttribute("data-session-id", /.+/);
  await expect(page.locator(".party-builder")).toHaveAttribute("data-party-prepared", "true");
  await expect(page.locator("#apply-party")).toBeDisabled();
  await expect(page.locator("#apply-party")).toHaveText("Party Applied");
}

async function joinGuest(player: BrowserPlayer, sessionId: string): Promise<void> {
  await player.page.locator("#join-session-id").fill(sessionId);
  await player.page.locator("#join-session").click();
  await expect(player.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "guest");
}

async function expectConvergence(pages: readonly Page[]): Promise<void> {
  await expect.poll(async () => {
    const values = await Promise.all(pages.map(async (page) => ({
      revision: await page.locator("#app").getAttribute("data-session-revision"),
      hash: await page.locator("#app").getAttribute("data-session-hash"),
      stateHash: await page.locator("#app").getAttribute("data-state-hash"),
      screen: await page.locator("#app").getAttribute("data-screen"),
    })));
    const sessionConverged = values.every((value) => value.revision && value.hash) &&
      new Set(values.map((value) => value.revision + ":" + value.hash)).size === 1;
    const combatConverged = !values.every((value) => value.screen === "combat") ||
      (values.every((value) => value.stateHash) && new Set(values.map((value) => value.stateHash)).size === 1);
    return sessionConverged && combatConverged;
  }, { timeout: 20_000 }).toBe(true);
}

async function advanceCurrentBoundary(page: Page): Promise<boolean> {
  const reactionPass = page.locator("#reaction-pass");
  if (await reactionPass.isVisible() && await reactionPass.isEnabled()) {
    await reactionPass.click();
    return true;
  }
  const endTurn = page.locator("#end-turn");
  if (await endTurn.isEnabled()) {
    await endTurn.click();
    return true;
  }
  return false;
}

async function waitForAnyActionable(pages: readonly Page[]): Promise<number> {
  let result = -1;
  await expect.poll(async () => {
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index] as Page;
      const reaction = await page.locator("#reaction-pass").isVisible() &&
        await page.locator("#reaction-pass").isEnabled();
      if (reaction || await page.locator("#end-turn").isEnabled()) {
        result = index;
        return true;
      }
    }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  return result;
}

test("clears a stale v2 stored credential, returns to landing, and stops reconnecting", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.addInitScript(() => {
    sessionStorage.setItem("cardguild.session.v2", JSON.stringify({
      sessionId: "session_stale_browser_credential",
      playerId: "player_stale_browser_credential",
      reconnectToken: "stale-token",
      seat: 1,
    }));
  });
  const page = await context.newPage();
  let connectionAttempts = 0;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname === "/ws") connectionAttempts += 1;
  });
  try {
    await page.goto("/");
    await expect(page.locator("#app")).toHaveAttribute("data-session-error", "SESSION_NOT_FOUND");
    await expect(page.locator("#app")).toHaveAttribute("data-session-status", "closed");
    await expect(page.locator("#create-session")).toBeVisible();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("cardguild.session.v2"))).toBeNull();
    await page.waitForTimeout(900);
    expect(connectionAttempts).toBe(1);
  } finally {
    await context.close();
  }
});

test("shows a non-contiguous party draft as invalid instead of already applied", async ({ browser }) => {
  const host = await createPlayer(browser, "Draft Host");
  try {
    await createHost(host);
    await host.page.locator("#party-slot-3").selectOption("");
    await host.page.locator("#apply-party").click();
    await expect(host.page.locator("#apply-party")).toHaveText("Party Applied");

    await host.page.locator("#party-slot-2").selectOption("");
    await host.page.locator("#party-slot-3").selectOption("hero.lyra");

    await expect(host.page.locator("#apply-party")).toHaveText("Apply Party");
    await expect(host.page.locator("#apply-party")).toBeDisabled();
    await expect(host.page.locator(".party-builder .party-gate.invalid")).toHaveText(
      "Choose unique characters in consecutive slots.",
    );
    expect(host.errors).toEqual([]);
  } finally {
    await host.context.close();
  }
});

test("single host prepares three women heroes and controls every changing combat HUD", async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const host = await createPlayer(browser, "Solo Host");
  try {
    await createHost(host);
    await expect(host.page.locator('.party-character-card[data-actor-definition-id="hero.aerin"]')).toContainText("Aerin");
    await expect(host.page.locator('.party-character-card[data-actor-definition-id="hero.lyra"]')).toContainText("Mobile skirmisher");
    await expect(host.page.locator('.party-character-card[data-actor-definition-id="hero.brom"]')).toContainText("Durable guardian");
    await host.page.setViewportSize({ width: 390, height: 844 });
    expect(await host.page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m5-party-builder-390.png"), fullPage: true });
    await host.page.setViewportSize({ width: 1024, height: 768 });

    await applyThreeCharacterParty(host.page);
    const sessionId = await host.page.locator("#invite-session-id").innerText();
    const orphanResponse = await host.page.request.post(
      "/api/sessions/" + encodeURIComponent(sessionId) + "/join",
      { data: { displayName: "Never Attached" } },
    );
    expect(orphanResponse.ok()).toBe(true);
    const orphanSeat = host.page.locator('.session-seats li[data-seat="2"]');
    await expect(orphanSeat).toHaveAttribute("data-connected", "false");
    await expect(orphanSeat).toContainText("Never Attached");
    await expect(orphanSeat.locator(".session-seat-remove")).toBeVisible();
    await host.page.setViewportSize({ width: 390, height: 844 });
    expect(await host.page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m5-orphan-cleanup-390.png"), fullPage: true });
    const orphanRevision = await host.page.locator("#app").getAttribute("data-session-revision");
    await orphanSeat.locator(".session-seat-remove").click();
    await expect(orphanSeat).toHaveClass(/open/);
    await expect(orphanSeat).toContainText("Open seat");
    await expect(host.page.locator("#app")).not.toHaveAttribute("data-session-revision", orphanRevision ?? "");
    await host.page.setViewportSize({ width: 1024, height: 768 });
    await expect(host.page.locator("#begin-adventure")).toBeEnabled();
    await host.page.locator("#begin-adventure").click();
    await expect(host.page.locator("#app")).toHaveAttribute("data-screen", "adventure");
    await host.page.getByRole("button", { name: "Manage Loadout" }).click();
    await expect(host.page.locator(".loadout-member-tab")).toHaveCount(3);
    await expect(host.page.locator('.loadout-member-tab[data-owned="true"]')).toHaveCount(3);
    await host.page.getByRole("button", { name: "Done" }).click();
    await host.page.getByRole("button", { name: "Enter Encounter" }).click();
    await expect(host.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
    await expect(host.page.locator("#app")).toHaveAttribute(
      "data-controlled-actor-ids",
      "party.hero-1,party.hero-2,party.hero-3",
    );
    await expect.poll(async () => {
      const feet = JSON.parse(
        await host.page.locator("#pixi-canvas").getAttribute("data-actor-feet") ?? "[]",
      ) as Array<{ id: string }>;
      return feet.filter((entry) => entry.id.startsWith("party.hero-")).length;
    }).toBe(3);

    const seen = new Set<string>();
    for (let step = 0; step < 18 && seen.size < 3; step += 1) {
      await waitForAnyActionable([host.page]);
      seen.add((await host.page.locator("#hero-heading").innerText()).trim());
      const revision = await host.page.locator("#app").getAttribute("data-session-revision");
      expect(await advanceCurrentBoundary(host.page)).toBe(true);
      await expect(host.page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
    }
    expect(seen).toEqual(new Set(["Aerin", "Lyra", "Brom"]));
    expect(host.errors).toEqual([]);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m5-single-three-1024.png"), fullPage: true });
  } finally {
    await host.context.close();
  }
});

test("2P guest disconnect transfers the live character to host and reconnect restores it", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const host = await createPlayer(browser, "Host");
  const guest = await createPlayer(browser, "Guest B");
  try {
    const sessionId = await createHost(host);
    await applyThreeCharacterParty(host.page);
    await joinGuest(guest, sessionId);
    await guest.page.locator('.guest-character-choice[data-member-id="party.hero-2"]').click();
    await expect(guest.page.locator('.guest-character-choice[data-claim-state="mine"]')).toHaveAttribute(
      "data-member-id",
      "party.hero-2",
    );
    await expect(guest.page.locator('.guest-character-choice[data-claim-state="mine"]')).toBeDisabled();
    await expect(host.page.locator("#begin-adventure")).toBeEnabled();
    await host.page.locator("#begin-adventure").click();
    await expectConvergence([host.page, guest.page]);
    await host.page.getByRole("button", { name: "Enter Encounter" }).click();
    await Promise.all([host.page, guest.page].map((page) =>
      expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 })));
    await expect(host.page.locator("#app")).toHaveAttribute(
      "data-controlled-actor-ids",
      "party.hero-1,party.hero-3",
    );
    await expect(guest.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-2");

    for (let step = 0; step < 24; step += 1) {
      const guestReaction = await guest.page.locator("#reaction-pass").isVisible() &&
        await guest.page.locator("#reaction-pass").isEnabled();
      if (guestReaction || await guest.page.locator("#end-turn").isEnabled()) break;
      await waitForAnyActionable([host.page]);
      expect(await advanceCurrentBoundary(host.page)).toBe(true);
      await expectConvergence([host.page, guest.page]);
    }
    expect(
      await guest.page.locator("#end-turn").isEnabled() ||
      (await guest.page.locator("#reaction-pass").isVisible() && await guest.page.locator("#reaction-pass").isEnabled()),
    ).toBe(true);

    const gameplayRevision = await host.page.locator("#app").getAttribute("data-session-revision");
    const gameplayHash = await host.page.locator("#app").getAttribute("data-session-hash");
    const controlRevision = Number(await host.page.locator("#app").getAttribute("data-control-revision"));
    await guest.page.goto("about:blank");
    await expect(host.page.locator("#app")).toHaveAttribute(
      "data-controlled-actor-ids",
      "party.hero-1,party.hero-2,party.hero-3",
      { timeout: 20_000 },
    );
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-revision", gameplayRevision ?? "");
    await expect(host.page.locator("#app")).toHaveAttribute("data-session-hash", gameplayHash ?? "");
    await expect.poll(async () => Number(
      await host.page.locator("#app").getAttribute("data-control-revision"),
    )).toBeGreaterThan(controlRevision);
    expect(await advanceCurrentBoundary(host.page)).toBe(true);

    await guest.page.goto("/");
    await expect(guest.page.locator("#app")).toHaveAttribute("data-session-status", "connected", { timeout: 20_000 });
    await expect(guest.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-2");
    await expect(host.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-1,party.hero-3");
    await expectConvergence([host.page, guest.page]);
    expect(host.errors).toEqual([]);
    expect(guest.errors).toEqual([]);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m5-2p-reconnected.png"), fullPage: true });
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});

test("3P guests choose distinct remaining characters and only their effective actor is actionable", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const players = await Promise.all([
    createPlayer(browser, "Host"),
    createPlayer(browser, "Bryn"),
    createPlayer(browser, "Cato", { width: 390, height: 844 }),
  ]);
  const [host, guestB, guestC] = players;
  if (!host || !guestB || !guestC) throw new Error("Three players were not created.");
  const pages = players.map((player) => player.page);
  try {
    const sessionId = await createHost(host);
    await applyThreeCharacterParty(host.page);
    await joinGuest(guestB, sessionId);
    await joinGuest(guestC, sessionId);
    await guestB.page.locator('.guest-character-choice[data-member-id="party.hero-2"]').click();
    await guestC.page.locator('.guest-character-choice[data-member-id="party.hero-3"]').click();
    await expect(host.page.locator("#begin-adventure")).toBeEnabled();
    expect(await guestC.page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await guestC.page.screenshot({ path: testInfo.outputPath("cardguild-m5-guest-picker-390.png"), fullPage: true });
    await guestC.page.setViewportSize({ width: 1024, height: 768 });
    await expectConvergence(pages);

    await host.page.locator("#begin-adventure").click();
    await Promise.all(pages.map((page) => expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure")));
    await guestB.page.getByRole("button", { name: "Manage Loadout" }).click();
    await expect(guestB.page.locator('.loadout-member-tab[data-owned="true"]')).toHaveCount(1);
    await expect(guestB.page.locator('.loadout-member-tab[data-member-id="party.hero-2"]')).toHaveAttribute("data-owned", "true");
    await guestB.page.getByRole("button", { name: "Done" }).click();

    await host.page.getByRole("button", { name: "Enter Encounter" }).click();
    await Promise.all(pages.map((page) =>
      expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 })));
    await expect(host.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-1");
    await expect(guestB.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-2");
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-3");
    await expectConvergence(pages);

    for (let step = 0; step < 6; step += 1) {
      const ownerIndex = await waitForAnyActionable(pages);
      const enabled = await Promise.all(pages.map(async (page) =>
        await page.locator("#end-turn").isEnabled() ||
        (await page.locator("#reaction-pass").isVisible() && await page.locator("#reaction-pass").isEnabled())));
      expect(enabled.filter(Boolean)).toHaveLength(1);
      expect(enabled[ownerIndex]).toBe(true);
      expect(await advanceCurrentBoundary(pages[ownerIndex] as Page)).toBe(true);
      await expectConvergence(pages);
    }

    const guestCHash = await guestC.page.locator("#app").getAttribute("data-session-hash");
    await guestC.page.reload();
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-controlled-actor-ids", "party.hero-3");
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-session-hash", guestCHash ?? "");
    await expectConvergence(pages);
    expect(players.flatMap((player) => player.errors)).toEqual([]);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m5-3p-1024.png"), fullPage: true });
  } finally {
    await Promise.all(players.map((player) => player.context.close()));
  }
});
