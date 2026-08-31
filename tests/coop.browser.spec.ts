import { expect, type Browser, type BrowserContext, type Page, test } from "@playwright/test";

type Corner = { readonly x: number; readonly y: number };

function projectCorners(
  corners: readonly [Corner, Corner, Corner, Corner],
  gridX: number,
  gridY: number,
): Corner {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const topWidth = topRight.x - topLeft.x;
  const bottomWidth = bottomRight.x - bottomLeft.x;
  const ratio = topWidth / bottomWidth;
  const u = gridX / 3;
  const v = gridY / 3;
  const denominator = 1 + (ratio - 1) * v;
  return {
    x: (topWidth * u + (ratio * bottomLeft.x - topLeft.x) * v + topLeft.x) / denominator,
    y: ((ratio * bottomRight.y - topLeft.y) * v + topLeft.y) / denominator,
  };
}

async function boardPoint(page: Page, gridX: number, gridY: number): Promise<Corner> {
  const published = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  const corners = JSON.parse(published ?? "[]") as Corner[];
  if (corners.length !== 4) throw new Error("The board has not published its corners.");
  return projectCorners(corners as [Corner, Corner, Corner, Corner], gridX, gridY);
}

async function createPlayer(browser: Browser, name: string): Promise<{
  readonly context: BrowserContext;
  readonly page: Page;
  readonly errors: string[];
}> {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
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

async function expectConvergence(pages: readonly Page[]): Promise<void> {
  await expect.poll(async () => {
    const values = await Promise.all(pages.map(async (page) => ({
      revision: await page.locator("#app").getAttribute("data-session-revision"),
      hash: await page.locator("#app").getAttribute("data-session-hash"),
      stateHash: await page.locator("#app").getAttribute("data-state-hash"),
      screen: await page.locator("#app").getAttribute("data-screen"),
    })));
    const sessionConverged = values.every((value) => value.revision && value.hash) &&
      new Set(values.map((value) => `${value.revision}:${value.hash}`)).size === 1;
    const combatConverged = !values.every((value) => value.screen === "combat") ||
      (values.every((value) => value.stateHash) && new Set(values.map((value) => value.stateHash)).size === 1);
    return sessionConverged && combatConverged;
  }, { timeout: 20_000 }).toBe(true);
}

test("host invites three isolated browser clients, enforces ownership, converges, and reconnects", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const players = await Promise.all([
    createPlayer(browser, "Host"),
    createPlayer(browser, "Bryn"),
    createPlayer(browser, "Cato"),
  ]);
  const [host, guestB, guestC] = players;
  if (!host || !guestB || !guestC) throw new Error("Three browser players were not created.");
  const pages = players.map((player) => player.page);

  try {
    await guestC.page.setViewportSize({ width: 390, height: 844 });
    expect(await guestC.page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await guestC.page.screenshot({ path: testInfo.outputPath("cardguild-m4-session-mobile.png"), fullPage: true });
    await guestC.page.setViewportSize({ width: 1024, height: 768 });

    await host.page.locator("#create-session").click();
    await expect(host.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
    const sessionId = await host.page.locator("#invite-session-id").innerText();
    expect(sessionId).toMatch(/^session_[A-Za-z0-9_-]+$/);

    for (const guest of [guestB, guestC]) {
      await guest.page.locator("#join-session-id").fill(sessionId);
      await guest.page.locator("#join-session").click();
      await expect(guest.page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "guest");
    }
    await Promise.all(pages.map((page) => expect(page.locator(".session-seats .occupied")).toHaveCount(3)));
    await expect(guestB.page.locator("#begin-adventure")).toBeDisabled();
    await expect(guestC.page.locator("#begin-adventure")).toBeDisabled();
    await expect(host.page.locator("#begin-adventure")).toBeEnabled();
    await expectConvergence(pages);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m4-host-lobby-1024.png"), fullPage: true });

    const storedCredential = await host.page.evaluate(() => sessionStorage.getItem("cardguild.session.v1"));
    expect(storedCredential).toContain("reconnectToken");
    const reconnectToken = (JSON.parse(storedCredential ?? "{}") as { reconnectToken?: string }).reconnectToken;
    expect(reconnectToken).toBeTruthy();
    expect(host.page.url()).not.toContain(reconnectToken as string);

    await host.page.locator("#begin-adventure").click();
    await Promise.all(pages.map(async (page) => {
      await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
      await expect(page.locator("#app")).toHaveAttribute("data-adventure-phase", "between-encounters");
    }));
    await expect(guestB.page.getByRole("button", { name: "Waiting for Host" })).toBeDisabled();
    await expectConvergence(pages);

    await guestB.page.getByRole("button", { name: "Manage Loadout" }).click();
    await expect(guestB.page.locator(".loadout-member-tab")).toHaveCount(3);
    await expect(guestB.page.locator('.loadout-member-tab[data-owned="true"]')).toHaveAttribute("aria-selected", "true");
    await expect(guestB.page.locator('.equipped-panel[data-editable="true"]')).toBeVisible();
    await guestB.page.locator('.loadout-member-tab[data-owned="false"]').first().click();
    await expect(guestB.page.locator('.equipped-panel[data-editable="false"]')).toBeVisible();
    await expect(guestB.page.locator(".equipment-slot").first()).toBeDisabled();
    await expect(guestB.page.getByRole("button", { name: "+ Add Card" })).toBeDisabled();
    await guestB.page.getByRole("button", { name: "Done" }).click();

    await host.page.getByRole("button", { name: "Enter Encounter" }).click();
    await Promise.all(pages.map(async (page) => {
      await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
      await expect(page.locator("#pixi-status")).toHaveText("2.5D board ready");
      await expect(page.locator("#initiative-list li")).toHaveCount(4);
      await expect(page.locator("#hand-count")).toHaveText("6");
      expect(await page.locator("#hand-cards .tactical-card").count()).toBeGreaterThanOrEqual(6);
    }));
    await expectConvergence(pages);

    let reactionOwner: Page | null = null;
    for (let step = 0; step < 12 && !reactionOwner; step += 1) {
      const reactionAccess = await Promise.all(pages.map(async (page) =>
        await page.locator("#reaction-modal").isVisible() && await page.locator("#reaction-pass").isEnabled()));
      const reactionIndex = reactionAccess.findIndex(Boolean);
      if (reactionIndex >= 0) {
        reactionOwner = pages[reactionIndex] as Page;
        break;
      }
      const endTurnAccess = await Promise.all(pages.map((page) => page.locator("#end-turn").isEnabled()));
      const ownerIndex = endTurnAccess.findIndex(Boolean);
      if (ownerIndex < 0) throw new Error("Server did not stop at a human turn or reaction boundary.");
      const ownerPage = pages[ownerIndex] as Page;
      const revision = await ownerPage.locator("#app").getAttribute("data-session-revision");
      await ownerPage.locator("#end-turn").click();
      await expect(ownerPage.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
      await expectConvergence(pages);
    }
    expect(reactionOwner, "A server-authored reaction boundary should reach its human owner.").not.toBeNull();
    await Promise.all(pages.map((page) => expect(page.locator("#reaction-modal")).toBeVisible()));
    expect(await Promise.all(pages.map((page) => page.locator("#reaction-pass").isEnabled())))
      .toEqual(pages.map((page) => page === reactionOwner));
    const reactionRevision = await (reactionOwner as Page).locator("#app").getAttribute("data-session-revision");
    await (reactionOwner as Page).locator("#reaction-pass").click();
    await expect((reactionOwner as Page).locator("#app"))
      .not.toHaveAttribute("data-session-revision", reactionRevision ?? "");
    await expectConvergence(pages);

    // Drain the remaining original candidates in their server-defined order.
    for (let candidate = 0; candidate < 8; candidate += 1) {
      const access = await Promise.all(pages.map(async (page) =>
        await page.locator("#reaction-modal").isVisible() && await page.locator("#reaction-pass").isEnabled()));
      const ownerIndex = access.findIndex(Boolean);
      if (ownerIndex < 0) break;
      const ownerPage = pages[ownerIndex] as Page;
      const revision = await ownerPage.locator("#app").getAttribute("data-session-revision");
      await ownerPage.locator("#reaction-pass").click();
      await expect(ownerPage.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
      await expectConvergence(pages);
    }

    await expect.poll(async () => Promise.all(pages.map((page) => page.locator("#end-turn").isEnabled())))
      .toContain(true);
    const enabled = await Promise.all(pages.map((page) => page.locator("#end-turn").isEnabled()));
    expect(enabled.filter(Boolean)).toHaveLength(1);
    const activePage = pages[enabled.findIndex(Boolean)] as Page;
    expect(await activePage.locator("#hand-cards .tactical-card:not([disabled])").count())
      .toBeGreaterThan(0);
    const beforeHash = await activePage.locator("#app").getAttribute("data-session-hash");
    let destination: { readonly x: number; readonly y: number } | null = null;
    for (const candidate of [
      { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 2 },
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 },
      { x: 2, y: 0 }, { x: 2, y: 2 },
    ]) {
      await activePage.locator("#pixi-canvas").click({
        position: await boardPoint(activePage, candidate.x + 0.5, candidate.y + 0.5),
      });
      const movement = activePage.locator(
        '#ring-root .ring-option[data-action-id="step"], #ring-root .ring-option[data-action-id="fly"]',
      );
      if (await movement.first().isVisible()) {
        destination = candidate;
        await movement.first().click();
        break;
      }
      await activePage.keyboard.press("Escape");
    }
    if (!destination) throw new Error("No target-first movement action was available for the active owner.");
    await expect(activePage.locator("#board-prompt")).toContainText("바라볼 방향");
    await activePage.locator("#pixi-canvas").click({
      position: await boardPoint(activePage, destination.x + 0.5, destination.y + 0.7),
    });
    await expect(activePage.locator("#hero-stats")).toContainText("south");
    await expect(activePage.locator("#app")).not.toHaveAttribute("data-session-hash", beforeHash ?? "");
    await expectConvergence(pages);

    const reconnectMemberId = await guestC.page.locator("#app").getAttribute("data-viewer-member-id");
    const convergedHash = await host.page.locator("#app").getAttribute("data-session-hash");
    await guestC.page.reload();
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-viewer-member-id", reconnectMemberId ?? "");
    await expect(guestC.page.locator("#app")).toHaveAttribute("data-session-hash", convergedHash ?? "");
    await expectConvergence(pages);

    const overflow = await host.page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }));
    expect(overflow.horizontal).toBeLessThanOrEqual(0);
    expect(overflow.vertical).toBeLessThanOrEqual(0);
    expect(players.flatMap((player) => player.errors)).toEqual([]);
    await host.page.screenshot({ path: testInfo.outputPath("cardguild-m4-three-client-1024.png"), fullPage: true });
  } finally {
    await Promise.all(players.map((player) => player.context.close()));
  }
});
