import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type { AdventureState } from "../../../src/adventure";
import type { LoadoutUi } from "../../../src/dom/loadout-ui";
import type { PartyMemberLoadout } from "../../../src/loadout";

interface Fixture { ui: LoadoutUi; state: AdventureState; requests: PartyMemberLoadout[] }
declare global { interface Window { loadoutFixture: Fixture } }

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mountComponent(page);
  await page.evaluate(async () => {
    // Exercise the real DOM component with a larger collection and a delayed server.
    const uiPath = "/src/dom/loadout-ui.ts";
    const contentPath = "/src/content/production-content.ts";
    const runtimePath = "/src/adventure/runtime.ts";
    const assetsPath = "/src/presentation/asset-catalog.ts";
    const { LoadoutUi } = await import(uiPath) as typeof import("../../../src/dom/loadout-ui");
    const { PRODUCTION_CONTENT: content } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const { createAdventureSession } = await import(runtimePath) as typeof import("../../../src/adventure/runtime");
    const { createPresentationCatalog } = await import(assetsPath) as typeof import("../../../src/presentation/asset-catalog");
    const actor = content.pack.actorDefinitions["hero.aerin"]!;
    const equipment = { ...content.pack.combatContent.equipment };
    const prototype = equipment[actor.starterLoadout.equipment.weapon!]!;
    for (let index = 0; index < 30; index++) {
      const id = `fixture-${String(index).padStart(2, "0")}`;
      equipment[id] = { ...prototype, id, name: `Test weapon ${index}` };
    }
    const pack = { ...content.pack, combatContent: { ...content.pack.combatContent, equipment } };
    const initial = createAdventureSession({ definition: content.adventure, actorDefinitions: pack.actorDefinitions, combatContent: pack.combatContent }, {
      members: { hero: { id: "hero", seat: 1, actorDefinitionId: actor.id, loadout: actor.starterLoadout } },
    }, 1);
    const state = { ...initial, collection: { ...initial.collection, equipment: Object.fromEntries(Object.keys(equipment).map((id) => [id, 1])) } };
    const requests: PartyMemberLoadout[] = [];
    const ui = new LoadoutUi(pack, createPresentationCatalog(), { onDone: () => undefined, onSetLoadout: (_id, loadout) => { requests.push(loadout); return true; } });
    window.loadoutFixture = { ui, state, requests };
    document.querySelector<HTMLElement>("#app")!.dataset.screen = "loadout";
    ui.render(state, new Set(["hero"]));
  });
});

test("paginates a full grid, remembers pages and resets filters", async ({ page }) => {
  await expect(page.locator(".loadout-items .loadout-tile")).toHaveCount(24);
  await expect(page.locator(".loadout-items .loadout-tile").last()).toBeInViewport();
  await expect(page.locator(".loadout-pagination")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
  const first = await page.locator(".loadout-items .loadout-tile").first().getAttribute("data-option-id");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator(".loadout-pagination")).toContainText("2 /");
  await expect(page.locator(".loadout-items .loadout-tile").first()).not.toHaveAttribute("data-option-id", first!);
  await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
  await page.getByRole("tab", { name: "장비", exact: true }).click();
  await expect(page.locator(".loadout-pagination")).toContainText("2 /");
  await page.getByRole("tab", { name: "신발", exact: true }).click();
  await expect(page.locator(".loadout-pagination")).toContainText("1 / 1");
  await page.getByRole("tab", { name: "신발", exact: true }).press("Home");
  await expect(page.getByRole("tab", { name: "전체", exact: true })).toBeFocused();
});

test("guards pending changes, recovers from rejection and keeps read-only details available", async ({ page }) => {
  const weapon = page.locator('.equipment-slot[data-slot="weapon"]');
  await weapon.click();
  await expect(page.locator("#loadout-screen")).toHaveAttribute("aria-busy", "true");
  await page.locator('.equipment-slot[data-slot="feet"]').dispatchEvent("click");
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.loadoutFixture.ui.reportError("Collection changed. Try again."));
  await expect(page.locator(".loadout-status")).toHaveText("Collection changed. Try again.");
  await expect(weapon).toContainText("Halberd");
  await weapon.click();
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(2);
  await page.evaluate(() => {
    const fixture = window.loadoutFixture;
    fixture.ui.reportError("Read-only");
    fixture.ui.render(fixture.state, new Set());
  });
  await weapon.hover();
  await expect(page.locator("#loadout-detail")).toContainText("Only this character's owner");
  await weapon.dispatchEvent("click");
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(2);
});

test("touch hold and cancelled gestures inspect without submitting", async ({ page }) => {
  const weapon = page.locator('.equipment-slot[data-slot="weapon"]');
  await weapon.dispatchEvent("pointerdown", { pointerType: "touch", button: 0, clientX: 100, clientY: 270 });
  // The hold pins the panel on its own timer, so waiting for the panel is the hold.
  await expect(page.locator("#loadout-detail")).toBeVisible();
  await weapon.dispatchEvent("pointerup", { pointerType: "touch" });
  await weapon.dispatchEvent("click", { detail: 1 });
  await expect(page.locator("#loadout-detail")).toBeVisible();
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(0);
  const bounds = await page.locator("#loadout-detail").boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1024);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  await page.keyboard.press("Escape");
  await weapon.dispatchEvent("pointerdown", { pointerType: "touch", button: 0, clientX: 100, clientY: 270 });
  await weapon.dispatchEvent("pointermove", { pointerType: "touch", clientX: 100, clientY: 320 });
  await weapon.dispatchEvent("pointercancel", { pointerType: "touch" });
  // Kept as real time on purpose: the claim is that the hold timer never fires after a
  // cancel, and only outliving that timer can show it.
  await page.waitForTimeout(500);
  await expect(page.locator("#loadout-detail")).toBeHidden();
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(0);
});

test("gives up a hold when the finger leaves the tile before the hold fires", async ({ page }) => {
  const weapon = page.locator('.equipment-slot[data-slot="weapon"]');
  await weapon.dispatchEvent("pointerdown", { pointerType: "touch", button: 0, clientX: 100, clientY: 270 });
  // A slide of less than the drag tolerance that still crosses the edge is a leave, not a
  // move; the hold must not fire once the pointer is gone.
  await weapon.dispatchEvent("pointermove", { pointerType: "touch", clientX: 104, clientY: 273 });
  await weapon.dispatchEvent("pointerleave", { pointerType: "touch" });
  // Real time on purpose: only outliving the 450ms hold shows it never fires.
  await page.waitForTimeout(600);
  await expect(page.locator("#loadout-detail")).toBeHidden();
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(0);
  // The tile is still a tile: the next hold works as before.
  await weapon.dispatchEvent("pointerdown", { pointerType: "touch", button: 0, clientX: 100, clientY: 270 });
  await expect(page.locator("#loadout-detail")).toBeVisible();
  await weapon.dispatchEvent("pointerup", { pointerType: "touch" });
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(0);
});
