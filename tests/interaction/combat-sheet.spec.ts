import { expect, test } from "@playwright/test";
import { controlledSession } from "../support/browser-backend";
import { combatCheckpoint, reactionCheckpoint, HERO } from "../support/session";

test("U-SHEET full screen ally details, locked enemy, shared knowledge and live snapshot", async ({ page }, testInfo) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  const objectiveBounds = await page.locator(".objective-card").boundingBox();
  const roundBounds = await page.locator(".initiative-card").boundingBox();
  const sidebarBounds = await page.getByRole("complementary", { name: "전투 정보" }).boundingBox();
  const logBounds = await page.locator(".ui-combat-log").boundingBox();
  expect(objectiveBounds!.y).toBe(roundBounds!.y);
  expect(objectiveBounds!.x + objectiveBounds!.width).toBeLessThanOrEqual(roundBounds!.x);
  expect(sidebarBounds!.x).toBeGreaterThan(512);
  expect(logBounds!.x).toBeGreaterThanOrEqual(sidebarBounds!.x);
  await page.screenshot({ path: testInfo.outputPath("combat-hud.png") });
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  await expect(sheet).toBeVisible();
  const rect = await sheet.boundingBox();
  expect(rect).toMatchObject({ x: 0, y: 0, width: 1024, height: 768 });
  await expect(sheet.getByRole("tab", { name: "ACTION", exact: true })).toHaveCount(0);
  await expect(sheet.getByLabel("상세 대상").locator("option")).toHaveCount(1);
  const overview = sheet.getByRole("region", { name: "기본 정보와 방어" });
  const workspace = sheet.getByRole("region", { name: "장비와 카드" });
  await expect(overview).toContainText("AC");
  await expect(workspace).toContainText("Halberd");
  await expect(sheet.getByRole("complementary", { name: "스킬과 지각" })).toContainText("Thievery");
  const defense = await sheet.locator(".ui-character-detail__defense").boundingBox();
  const workspaceBounds = await workspace.boundingBox();
  expect(defense!.y + defense!.height).toBeLessThanOrEqual(workspaceBounds!.y);
  await expect(sheet.locator("[data-trait-id=fighter]")).toHaveText("Fighter");
  await page.screenshot({ path: testInfo.outputPath("character-sheet.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: /상세 잠김/ }).click();
  await expect(sheet).toHaveCount(0);
  expect(backend.requests).toHaveLength(0);
  const combat = backend.state.combat!;
  const enemy = Object.values(combat.actors).find(actor => actor.team === "enemies")!;
  backend.publish({ ...backend.state, combat: { ...combat, knowledge: [{ actorId: HERO, targetId: enemy.id, success: true }] } });
  await page.getByRole("button", { name: `${enemy.name} 상세`, exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("상세 대상")).toHaveValue(enemy.id);
  backend.publish({ ...backend.state, combat: { ...backend.state.combat!, actors: { ...combat.actors, [enemy.id]: { ...enemy, hp: 3 } } } });
  await expect(sheet).toContainText(`HP 3 / ${enemy.maxHp}`);
  expect(backend.requests).toHaveLength(0);
});


test("U-KNOWLEDGE Ring commits one recall request and unlocks detail only on the server snapshot", async ({ page }, testInfo) => {
  const initial = combatCheckpoint();
  const actor = initial.combat!.actors[HERO]!;
  if (actor.statProfile.kind !== "character") throw new Error("Expected Character fixture");
  const backend = await controlledSession(page, { ...initial, combat: { ...initial.combat!, actors: { ...initial.combat!.actors,
    [HERO]: { ...actor, statProfile: { kind: "character", stats: { ...actor.statProfile.stats, attributes: { ...actor.statProfile.stats.attributes, dex: 80 } } } },
  } } });
  await expect(page.getByRole("button", { name: "End Turn", exact: true })).toBeEnabled();
  await page.mouse.click(499, 504);
  const recall = page.getByRole("menuitem", { name: /Recall Knowledge.*stealth/ });
  await expect(recall).toBeVisible();
  await page.getByRole("button", { name: "행동 상세 보기", exact: true }).click();
  await recall.click();
  await page.locator("#action-preview-summary").click();
  await expect(page.locator("#selected-detail")).toContainText("stealth");
  await page.screenshot({ path: testInfo.outputPath("combat-action.png") });
  await page.locator("#action-preview-summary").click();
  await page.getByRole("button", { name: "상세 모드 · 실행으로 전환", exact: true }).click();
  await recall.click();
  await expect.poll(() => backend.requests.length).toBe(1);
  expect(backend.requests[0]!.intent).toMatchObject({ type: "use-action", action: { kind: "basic", id: "recall-knowledge" }, target: { kind: "actor", actorId: "goblin-lackey" } });
  await expect(page.getByRole("button", { name: /상세 잠김/ })).toBeVisible();
  const candidate = backend.candidate();
  backend.ack(true, candidate.revision);
  await expect(page.getByRole("button", { name: /상세 잠김/ })).toBeVisible();
  backend.publish(candidate, [{ type: "KNOWLEDGE_RECALLED", actorId: HERO, targetId: "goblin-lackey", success: true }]);
  await expect(page.locator("#combat-log")).toContainText("Goblin Lackey 상세를 파티에 공개했습니다.");
  await page.getByRole("button", { name: "Goblin Lackey 상세", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "캐릭터 상세", exact: true })).toBeVisible();
  expect(backend.requests).toHaveLength(1);
});

test("U-SHEET preserves a selected card and yields to an owned Reaction", async ({ page }) => {
  const backend = await controlledSession(page, combatCheckpoint());
  await page.getByRole("button", { name: "손패 펼치기", exact: true }).click();
  const card = page.getByRole("button", { name: /Vicious Swing/ });
  await card.click();
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  backend.publish(reactionCheckpoint());
  await expect(page.getByRole("dialog", { name: "캐릭터 상세", exact: true })).toHaveCount(0);
  await expect(page.locator("#reaction-modal")).toBeVisible();
  expect(backend.requests).toHaveLength(0);
});

test("U-EFFECTS condition hierarchy, stat colors and tap explanations track live effects", async ({ page }, testInfo) => {
  const initial = combatCheckpoint();
  const hero = initial.combat!.actors[HERO]!;
  const backend = await controlledSession(page, { ...initial, combat: { ...initial.combat!, actors: { ...initial.combat!.actors,
    [HERO]: { ...hero, conditions: [{ id: "grabbed", sourceId: "enemy" }, { id: "prone", sourceId: "trip" }] },
  } } });
  await page.getByRole("button", { name: "캐릭터 상세", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "캐릭터 상세", exact: true });
  const grabbed = sheet.locator(".ui-character-detail__condition").filter({ hasText: "Grabbed" });
  await expect(grabbed.getByRole("listitem")).toHaveText(["Immobilized · 이동 제한", "Off-guard · AC −2"]);
  const ac = sheet.locator(".ui-character-detail__ac");
  await expect(ac.getByRole("button")).toHaveAttribute("data-change", "decrease");
  await expect(ac.getByRole("button")).toContainText("15");
  await ac.getByRole("button").click();
  await expect(sheet.getByRole("status")).toContainText("17 → 15 (-2)");
  await page.screenshot({ path: testInfo.outputPath("condition-effects.png") });
  const publish = (conditions: typeof hero.conditions) => backend.publish({ ...backend.state, combat: { ...backend.state.combat!, actors: { ...backend.state.combat!.actors, [HERO]: { ...hero, conditions } } } });
  publish([{ id: "warded", sourceId: "spell" }]);
  await expect(ac.getByRole("button")).toHaveAttribute("data-change", "increase");
  await expect(ac.getByRole("button")).toContainText("18");
  await expect(grabbed).toHaveCount(0);
  await expect(sheet.locator(".ui-condition-chip")).toHaveAttribute("data-tone", "beneficial");
  publish([{ id: "covered", sourceId: "cover" }, { id: "prone", sourceId: "trip" }]);
  await expect(ac.getByRole("button")).toHaveCount(0);
  await expect(ac).toContainText("17");
  publish([]);
  await expect(sheet.locator(".ui-character-detail__conditions")).toContainText("상태 이상 없음");
  expect(backend.requests).toHaveLength(0);
});

test("U-HUD-EFFECTS compact conditions and saves are read-only, live and gated by knowledge", async ({ page }, testInfo) => {
  const backend = await controlledSession(page, combatCheckpoint());
  const summary = page.getByRole("region", { name: "현재 행동자 상태와 내성" });
  await expect(summary).toBeVisible();
  await expect(summary.locator(".ui-combat-actor-summary__conditions")).toBeHidden();
  await expect(summary.locator(".ui-save-tile__value")).toHaveText(["+6", "+7", "+5"]);
  const hero = backend.state.combat!.actors[HERO]!;
  backend.publish({ ...backend.state, combat: { ...backend.state.combat!, actors: { ...backend.state.combat!.actors,
    [HERO]: { ...hero, conditions: [{ id: "grabbed", sourceId: "enemy" }, { id: "frightened", value: 1, sourceId: "fear" }] },
  } } });
  await expect(summary.locator(".ui-combat-actor-summary__conditions button")).toHaveText(["Grabbed", "Frightened 1"]);
  await expect(summary.getByRole("button", { name: "Grabbed", exact: true })).toHaveAttribute("data-tone", "harmful");
  await expect(summary.getByRole("button", { name: /^Fortitude/ })).toHaveAttribute("data-change", "decrease");
  await expect(summary.getByRole("button", { name: /^Fortitude/ }).locator(".ui-save-tile__value")).toContainText("+5");
  await page.screenshot({ path: testInfo.outputPath("combat-hud-effects.png") });
  await summary.getByRole("button", { name: "Grabbed", exact: true }).click();
  await expect(summary.getByRole("status")).toContainText("Immobilized · 이동 제한 · Off-guard · AC −2");
  await summary.getByRole("button", { name: /^Fortitude/ }).click();
  await expect(summary.getByRole("status")).toContainText("6 → 5 (-1)");
  await expect(summary.getByRole("status")).toContainText("Frightened 1");
  await summary.getByRole("button", { name: "설명 닫기" }).click();
  await expect(summary.getByRole("status")).toBeHidden();
  const combat = backend.state.combat!;
  const enemy = Object.values(combat.actors).find(actor => actor.team === "enemies")!;
  backend.publish({ ...backend.state, combat: { ...combat, turn: { ...combat.turn, activeActorId: enemy.id } } });
  await expect(summary).toBeHidden();
  backend.publish({ ...backend.state, combat: { ...backend.state.combat!, knowledge: [{ actorId: HERO, targetId: enemy.id, success: true }] } });
  await expect(summary).toBeVisible();
  expect(backend.requests).toHaveLength(0);
});
