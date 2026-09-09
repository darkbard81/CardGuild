import { expect, test } from "@playwright/test";
import type { AdventureState } from "../src/adventure";
import type { AdventureUi } from "../src/dom/adventure-ui";
import type { LoadoutUi } from "../src/dom/loadout-ui";

declare global {
  interface Window {
    progressionFixture: { state: AdventureState; adventureUi: AdventureUi; loadoutUi: LoadoutUi; requests: number };
  }
}

test("shows authoritative starting progression through the real Host flow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await page.locator("#session-display-name").fill("Progression Host");
  await page.locator("#create-session").click();
  await page.locator("#apply-party").click();
  await page.locator("#begin-adventure").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
  await expect(page.locator("#adventure-party li")).toHaveCount(3);
  for (const row of await page.locator("#adventure-party li").all()) {
    await expect(row).toContainText("Lv. 1 · EXP 0 / 1000");
    await expect(row).toBeInViewport();
  }
  await expect(page.getByRole("button", { name: "Enter Encounter", exact: true })).toBeInViewport();
  await expect(page.locator("#adventure-collection")).toBeInViewport();
  await expect(page.locator("#adventure-progress li").last()).toBeInViewport();
  const mapBounds = await page.locator(".adventure-map-card").boundingBox();
  expect(mapBounds!.y).toBeGreaterThanOrEqual(0);
  expect(mapBounds!.y + mapBounds!.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: testInfo.outputPath("m9-1-adventure-1024.png") });
  await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 1 · EXP 0 / 1000");
  await expect(page.locator(".loadout-pagination")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("m9-1-loadout-1024.png") });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.locator("#adventure-party li")).toHaveCount(3);
  await expect(page.locator("#adventure-party li").first()).toContainText("Lv. 1 · EXP 0 / 1000");
});

test("renders runtime Level/EXP in both views, including previews and read-only characters", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await page.evaluate(async () => {
    const adventurePath = "/src/dom/adventure-ui.ts";
    const loadoutPath = "/src/dom/loadout-ui.ts";
    const runtimePath = "/src/adventure/runtime.ts";
    const contentPath = "/src/content/production-content.ts";
    const catalogPath = "/src/presentation/asset-catalog.ts";
    const { AdventureUi } = await import(adventurePath) as typeof import("../src/dom/adventure-ui");
    const { LoadoutUi } = await import(loadoutPath) as typeof import("../src/dom/loadout-ui");
    const { createAdventureSession } = await import(runtimePath) as typeof import("../src/adventure/runtime");
    const { PRODUCTION_CONTENT: content } = await import(contentPath) as typeof import("../src/content/production-content");
    const { createPresentationCatalog } = await import(catalogPath) as typeof import("../src/presentation/asset-catalog");
    const pack = content.pack;
    const initial = createAdventureSession({ definition: content.adventure, actorDefinitions: pack.actorDefinitions, combatContent: pack.combatContent }, {
      members: Object.fromEntries(["hero.aerin", "hero.lyra", "hero.brom"].map((id, index) => {
        const memberId = `party.hero-${index + 1}`;
        return [memberId, { id: memberId, seat: (index + 1) as 1 | 2 | 3, actorDefinitionId: id, loadout: pack.actorDefinitions[id]!.starterLoadout }];
      })),
    }, 1);
    const state: AdventureState = { ...initial, party: { members: Object.fromEntries(Object.entries(initial.party.members)
      .map(([id, member], index) => [id, { ...member, progression: { level: index + 2, experience: 375 + index } }])) } };
    const catalog = createPresentationCatalog();
    const app = document.querySelector<HTMLElement>("#app")!;
    const loadoutUi = new LoadoutUi(pack, catalog, {
      onDone: () => { loadoutUi.setVisible(false); app.dataset.screen = "adventure"; },
      onSetLoadout: () => { window.progressionFixture.requests++; return true; },
    });
    const adventureUi = new AdventureUi(content.adventure, pack, {
      onStart: () => undefined, onContinue: () => undefined, onChooseReward: () => undefined, onRetry: () => undefined,
      onOpenLoadout: () => {
        app.dataset.screen = "loadout";
        loadoutUi.render(window.progressionFixture.state, new Set(["party.hero-1"]));
      },
    }, catalog);
    window.progressionFixture = { state, adventureUi, loadoutUi, requests: 0 };
    app.dataset.screen = "adventure";
    adventureUi.render(state);
  });
  await expect(page.locator('#adventure-party [data-member-id="party.hero-1"]')).toContainText("Lv. 2 · EXP 375 / 1000");
  await expect(page.locator('#adventure-party [data-member-id="party.hero-2"]')).toContainText("Lv. 3 · EXP 376 / 1000");
  await page.getByRole("button", { name: "Manage Loadout", exact: true }).click();
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 2 · EXP 375 / 1000");
  await page.locator('.equipment-slot[data-slot="armor"]').hover();
  await expect(page.locator("#loadout-detail")).toContainText("19 → 16");
  await expect(page.locator("#loadout-detail")).toContainText("34 → 34");
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "덱·능력치", exact: true }).click();
  await expect(page.locator(".deck-panel .loadout-stat").filter({ has: page.getByText("HP", { exact: true }) })).toContainText("34");
  await page.getByRole("tab", { name: "Lyra", exact: true }).click();
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 3 · EXP 376 / 1000");
  await expect(page.locator(".loadout-panel-label")).toContainText("Read-only");
  await expect(page.locator('.equipment-slot[data-slot="weapon"]')).toBeDisabled();
  await page.locator('.equipment-slot[data-slot="weapon"]').hover();
  await expect(page.locator("#loadout-detail")).toContainText("Only this character's owner");
  await page.locator('.equipment-slot[data-slot="weapon"]').dispatchEvent("click");
  expect(await page.evaluate(() => window.progressionFixture.requests)).toBe(0);
  await page.evaluate(() => {
    const fixture = window.progressionFixture;
    const id = "party.hero-2";
    fixture.state = { ...fixture.state, party: { members: { ...fixture.state.party.members,
      [id]: { ...fixture.state.party.members[id]!, progression: { level: 3, experience: 999 } },
    } } };
    fixture.loadoutUi.render(fixture.state, new Set(["party.hero-1"]));
    fixture.adventureUi.render(fixture.state);
  });
  await expect(page.locator("#loadout-screen .character-progression")).toHaveText("Lv. 3 · EXP 999 / 1000");
  await page.screenshot({ path: testInfo.outputPath("m9-1-runtime-levels-1024.png") });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('#adventure-party [data-member-id="party.hero-2"]')).toContainText("Lv. 3 · EXP 999 / 1000");
  for (const phase of ["between-encounters", "reward", "complete", "failed"] as const) {
    await page.evaluate(phase => {
      const fixture = window.progressionFixture;
      fixture.adventureUi.render({ ...fixture.state, phase });
    }, phase);
    await expect(page.locator("#adventure-party")).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#adventure-party li").first()).toContainText("Lv. 2 · EXP 375 / 1000");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("m9-1-progression-mobile.png"), fullPage: true });
});
