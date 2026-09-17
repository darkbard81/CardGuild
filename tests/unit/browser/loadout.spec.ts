import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type { AdventureState } from "../../../src/adventure";
import type { LoadoutUi } from "../../../src/dom/loadout-ui";
import type { PartyMemberLoadout } from "../../../src/loadout";

interface Fixture { ui: LoadoutUi; state: AdventureState; requests: PartyMemberLoadout[]; settle?: (accepted: boolean) => void }
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
    const initial = createAdventureSession({ definition: content.adventure, actorDefinitions: pack.actorDefinitions, characterRules: pack.characterRules, combatContent: pack.combatContent }, {
      members: { hero: { id: "hero", seat: 1, actorDefinitionId: actor.id, loadout: actor.starterLoadout } },
    }, 1);
    const state = { ...initial, collection: { ...initial.collection, equipment: Object.fromEntries(Object.keys(equipment).map((id) => [id, 1])) } };
    const requests: PartyMemberLoadout[] = [];
    const ui = new LoadoutUi(pack, createPresentationCatalog(), { onDone: () => undefined, onSetLoadout: (_id, loadout, settle) => { requests.push(loadout); window.loadoutFixture.settle = settle; return true; } });
    window.loadoutFixture = { ui, state, requests };
    document.querySelector<HTMLElement>("#app")!.dataset.screen = "loadout";
    ui.render(state, new Set(["hero"]));
  });
});

test("shows a locked owned card and equipment grant, then unlocks both at the current level", async ({ page }) => {
  await page.evaluate(() => {
    const fixture = window.loadoutFixture;
    fixture.state = { ...fixture.state, collection: { ...fixture.state.collection, cards: { ...fixture.state.collection.cards, "card.combat-grab": 1 } } };
    fixture.ui.render(fixture.state, new Set(["hero"]));
  });
  await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
  const card = page.locator('[data-option-id="card.combat-grab"]');
  await expect(card).toHaveAttribute("aria-pressed", "false");
  await card.hover();
  await expect(page.locator("#loadout-detail")).toContainText("요구 레벨 2 · 현재 레벨 1");
  await card.dispatchEvent("click");
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toHaveLength(0);
  await page.evaluate(() => {
    const fixture = window.loadoutFixture;
    const member = fixture.state.party.members.hero!;
    fixture.state = { ...fixture.state, party: { members: { hero: { ...member, progression: { ...member.progression, level: 2 } } } } };
    fixture.ui.render(fixture.state, new Set(["hero"]));
  });
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await card.hover();
  await expect(page.locator(".loadout-comparison")).toContainText("요구 레벨 2 · 현재 레벨 2");
  await card.click();
  await page.locator(".loadout-apply").click();
  expect(await page.evaluate(() => window.loadoutFixture.requests[0]?.preparedCards)).toContain("card.combat-grab");
});

test("explains the level of a Card granted by reward equipment", async ({ page }) => {
  await page.getByRole("tab", { name: "주손", exact: true }).click();
  const equipment = page.locator('[data-option-id="dueling-rapier"]');
  await expect(equipment).toHaveAttribute("aria-pressed", "false");
  await equipment.hover();
  await expect(page.locator("#loadout-detail")).toContainText("Dueling Parry");
  await expect(page.locator("#loadout-detail")).toContainText("요구 레벨 2 · 현재 레벨 1");
});

test("paginates a full grid, remembers pages and resets filters", async ({ page }) => {
  await expect(page.locator(".loadout-items .loadout-tile")).toHaveCount(4);
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
  await page.getByRole("tab", { name: "악세서리", exact: true }).click();
  await expect(page.locator(".loadout-pagination")).toContainText("1 / 2");
  await page.getByRole("tab", { name: "악세서리", exact: true }).press("Home");
  await expect(page.getByRole("tab", { name: "전체", exact: true })).toBeFocused();
});

test("paginates complete portrait cards without changing equipment pagination", async ({ page }, testInfo) => {
  await page.evaluate(async () => {
    const contentPath = "/src/content/production-content.ts";
    const { PRODUCTION_CONTENT } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const fixture = window.loadoutFixture;
    fixture.state = { ...fixture.state, collection: { ...fixture.state.collection,
      cards: Object.fromEntries(Object.keys(PRODUCTION_CONTENT.pack.combatContent.cards).map((id) => [id, 1])),
    } };
    fixture.ui.render(fixture.state, new Set(["hero"]));
  });
  await page.getByRole("tab", { name: "준비 카드", exact: true }).click();
  await expect(page.locator(".loadout-card-items .loadout-card-tile")).toHaveCount(4);
  await expect(page.locator(".loadout-pagination")).toContainText("1 / 8");
  for (let index = 0; index < 8; index++) {
    for (const card of await page.locator(".loadout-card-items .card-face").all()) {
      const size = await card.boundingBox();
      expect(size!.width / size!.height).toBeCloseTo(2 / 3, 2);
    }
    await expect(page.locator(".loadout-pagination")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBe(0);
    if (index < 7) await page.getByRole("button", { name: "다음", exact: true }).click();
  }
  await expect(page.locator('[data-option-id="card.vicious-swing"] .card-face')).toHaveAttribute("data-image-state", "ready");
  await page.screenshot({ path: testInfo.outputPath("loadout-cards.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("loadout-cards-mobile.png"), fullPage: true });
});

test("guards pending changes, recovers from rejection and keeps read-only details available", async ({ page }) => {
  const weapon = page.locator('.equipment-slot[data-slot="weapon"]');
  await weapon.click();
  await page.locator(".loadout-apply").click();
  await expect(page.locator("#loadout-screen")).toHaveAttribute("aria-busy", "true");
  await page.locator('.equipment-slot[data-slot="feet"]').dispatchEvent("click");
  expect(await page.evaluate(() => window.loadoutFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.loadoutFixture.ui.reportError("Collection changed. Try again."));
  await expect(page.locator(".loadout-status")).toHaveText("Collection changed. Try again.");
  await expect(weapon).toContainText("Halberd");
  await weapon.click();
  await page.locator(".loadout-apply").click();
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

test("select, cancel, and drag never mutate before explicit confirmation", async ({ page }) => {
  const slot = page.locator('.equipment-slot[data-slot="feet"]');
  await slot.click();
  await expect(page.locator(".loadout-apply")).toHaveText("해제");
  await expect(page.locator(".loadout-apply")).toBeInViewport();
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toEqual([]);
  await page.locator(".loadout-cancel").click();
  await expect(slot).toContainText("Boots of Fly");
  const handle = slot.locator("..").getByRole("button", { name: "Boots of Fly 끌어서 이동" });
  const from = (await handle.boundingBox())!;
  const to = (await page.locator(".loadout-return").boundingBox())!;
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.mouse.move(from.x + 20, from.y + 20); await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 8 });
  await expect(page.locator(".loadout-drag-ghost")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".loadout-drag-ghost")).toHaveCount(0);
  await page.mouse.up();
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toEqual([]);
  await page.mouse.move(from.x + 20, from.y + 20); await page.mouse.down();
  await page.mouse.move(to.x + 20, to.y + 20, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(".loadout-apply")).toHaveText("해제");
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toEqual([]);
  await page.locator(".loadout-apply").click();
  expect(await page.evaluate(() => window.loadoutFixture.requests[0]?.equipment.feet)).toBeUndefined();
  await expect(page.locator(".loadout-done")).toBeDisabled();
});

test("a matching snapshot alone is not a save acknowledgement", async ({ page }) => {
  const slot = page.locator('.equipment-slot[data-slot="weapon"]');
  await slot.click(); await page.locator(".loadout-apply").click();
  await page.evaluate(() => {
    const f = window.loadoutFixture; const hero = f.state.party.members.hero!;
    f.state = { ...f.state, party: { members: { hero: { ...hero, loadout: f.requests[0]! } } } };
    f.ui.render(f.state, new Set(["hero"]));
  });
  await expect(page.locator("#loadout-screen")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".loadout-status")).not.toContainText("저장됨");
  await page.evaluate(() => window.loadoutFixture.ui.setConnectionStatus("reconnecting"));
  await expect(page.locator(".loadout-status")).toContainText("결과를 확인");
  await page.evaluate(() => window.loadoutFixture.settle?.(true));
  await expect(page.locator(".loadout-status")).toContainText("저장됨");
  await expect(page.locator(".loadout-done")).toBeEnabled();
});

test("shared character detail supports tabs, Escape, focus return and fixed creatures", async ({ page }) => {
  const open = page.getByRole("button", { name: "캐릭터 상세" });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("최대 HP");
  await expect(dialog).toContainText("STR");
  await dialog.getByRole("tab", { name: "CORE" }).press("ArrowRight");
  await expect(dialog.getByRole("tab", { name: "SKILLS" })).toBeFocused();
  await expect(dialog).toContainText("athletics");
  await page.keyboard.press("Escape"); await expect(open).toBeFocused();
  await page.evaluate(async () => {
    const path = "/src/dom/character-detail-ui.ts";
    const contentPath = "/src/content/production-content.ts";
    const catalogPath = "/src/presentation/asset-catalog.ts";
    const { CharacterDetailUi, preparationDetailActor } = await import(path) as typeof import("../../../src/dom/character-detail-ui");
    const { PRODUCTION_CONTENT } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const { createPresentationCatalog } = await import(catalogPath) as typeof import("../../../src/presentation/asset-catalog");
    const definition = Object.values(PRODUCTION_CONTENT.pack.actorDefinitions).find(actor => actor.statProfile.kind === "creature")!;
    const actor = preparationDetailActor(definition, PRODUCTION_CONTENT.pack);
    new CharacterDetailUi(PRODUCTION_CONTENT.pack, createPresentationCatalog()).open({ ...actor, hp: 1 });
  });
  await expect(dialog).toContainText("HP 1 /");
  await expect(dialog).not.toContainText("Class DC");
  await expect(dialog).not.toContainText("EXP");
  await expect(dialog.getByText("STR", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("touch drag cancellation and incompatible drop leave equipment unchanged", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  const slot = page.locator('.equipment-slot[data-slot="feet"]');
  const handle = slot.locator("..").getByRole("button", { name: "Boots of Fly 끌어서 이동" });
  const start = (await handle.boundingBox())!;
  const end = (await page.locator(".loadout-return").boundingBox())!;
  const touch = (x: number, y: number) => [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(start.x + 20, start.y + 20) });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(end.x + 20, end.y + 20) });
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(page.locator(".loadout-drag-ghost")).toHaveCount(0);
  await expect(page.locator(".loadout-apply")).toHaveCount(0);
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toEqual([]);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(start.x + 20, start.y + 20) });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(end.x + 20, end.y + 20) });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator(".loadout-apply")).toHaveText("해제");
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toEqual([]);
  await page.locator(".loadout-cancel").click();
  // A worn accessory cannot be dropped into the weapon slot.
  const wrong = (await page.locator('.equipment-slot[data-slot="weapon"]').boundingBox())!;
  await page.mouse.move(start.x + 20, start.y + 20); await page.mouse.down();
  await page.mouse.move(wrong.x + 10, wrong.y + 10, { steps: 5 }); await page.mouse.up();
  await expect(page.locator(".loadout-status")).toContainText("이 위치에는 놓을 수 없습니다");
  await expect(slot).toContainText("Boots of Fly");
  expect(await page.evaluate(() => window.loadoutFixture.requests)).toEqual([]);
  await session.detach();
});

test("reward review opens the requested tab and can return to the full collection", async ({ page }) => {
  await page.evaluate(() => {
    const f = window.loadoutFixture;
    f.ui.navigate({ memberId: "hero", tab: "cards", rewardIds: ["card.vicious-swing"] });
    f.ui.render(f.state, new Set(["hero"]));
  });
  await expect(page.getByRole("tab", { name: "준비 카드", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".collection-panel .loadout-option")).toHaveCount(1);
  await expect(page.locator(".collection-panel .loadout-option")).toHaveAttribute("data-option-id", "card.vicious-swing");
  await page.getByRole("button", { name: "보상 필터 해제", exact: true }).click();
  await expect(page.locator(".collection-panel .loadout-option")).toHaveCount(2);
});
