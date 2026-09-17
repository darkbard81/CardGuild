import { expect, test } from "@playwright/test";
import { mountComponent } from "../../support/browser/component-harness";
import type { AdventureState } from "../../../src/adventure";
import type { CharacterAdvancementChoice } from "../../../src/character";
import type { AdventureUi } from "../../../src/dom/adventure-ui";

declare global {
  interface Window {
    growthFixture: { state: AdventureState; ui: AdventureUi; choices: CharacterAdvancementChoice[];
      render(editable?: boolean): void; commit(): void };
  }
}

async function mount(page: import("@playwright/test").Page): Promise<void> {
  await mountComponent(page);
  await page.evaluate(async () => {
    const contentPath = "/src/content/production-content.ts";
    const uiPath = "/src/dom/adventure-ui.ts";
    const runtimePath = "/src/adventure/runtime.ts";
    const { PRODUCTION_CONTENT: content } = await import(contentPath) as typeof import("../../../src/content/production-content");
    const { AdventureUi } = await import(uiPath) as typeof import("../../../src/dom/adventure-ui");
    const { createAdventureSession, dispatchAdventureCommand } = await import(runtimePath) as typeof import("../../../src/adventure/runtime");
    const { pack } = content;
    const context = { definition: content.adventure, actorDefinitions: pack.actorDefinitions, combatContent: pack.combatContent, characterRules: pack.characterRules };
    const actor = pack.actorDefinitions["hero.aerin"]!;
    const id = "party.hero-1";
    const initial = createAdventureSession(context, { members: { [id]: { id, seat: 1, actorDefinitionId: actor.id, loadout: actor.starterLoadout } } }, 1);
    const state: AdventureState = { ...initial, phase: "between-encounters", currentEncounterId: content.adventure.encounterIds[0]!,
      party: { members: { [id]: { ...initial.party.members[id]!, progression: { level: 5, experience: 0, advancements: [] } } } } };
    const choices: CharacterAdvancementChoice[] = [];
    const ui = new AdventureUi(content.adventure, pack, {
      onAdvanceCharacter: (_memberId, choice) => { choices.push(choice); return true; },
      onStart: () => undefined, onContinue: () => undefined, onChooseReward: () => undefined,
      onOpenLoadout: () => undefined, onRetry: () => undefined,
    });
    const render = (editable = true): void => ui.render(window.growthFixture.state, { isHost: true,
      editableMemberIds: new Set(editable ? [id] : []) });
    window.growthFixture = { state, ui, choices, render, commit: () => {
      const result = dispatchAdventureCommand(window.growthFixture.state, { type: "advance-character", memberId: id, choice: choices.at(-1)! }, context);
      if (!result.accepted) throw new Error(result.error);
      window.growthFixture.state = result.state; render();
    } };
    document.querySelector<HTMLElement>("#app")!.dataset.screen = "adventure";
    render();
  });
}

test("requires explicit earliest choices, waits for COMMIT and permits retry without discarding the draft", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 }); await mount(page);
  const panel = page.locator(".character-advancement");
  const submit = panel.getByRole("button", { name: "성장 확정" });
  await expect(page.getByRole("button", { name: "Enter Encounter", exact: true })).toBeDisabled();
  await expect(submit).toBeDisabled();
  await panel.getByRole("combobox").selectOption("athletics");
  await expect(panel.getByRole("status")).toContainText("trained → expert");
  await submit.click();
  await expect(panel.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  expect(await page.evaluate(() => window.growthFixture.state.party.members["party.hero-1"]!.progression.advancements)).toEqual([]);
  await page.evaluate(() => window.growthFixture.ui.reportError("저장 실패 · 다시 시도하세요"));
  await expect(panel.getByRole("status")).toContainText("저장 실패");
  await expect(panel.getByRole("combobox")).toHaveValue("athletics");
  await submit.click();
  expect(await page.evaluate(() => window.growthFixture.choices)).toHaveLength(2);
  await page.evaluate(() => window.growthFixture.commit());
  await expect(panel).toHaveAttribute("data-advancement-level", "5");
  await expect(panel.locator('option[value="athletics"]')).toHaveAttribute("disabled", "");
  await panel.getByRole("combobox").selectOption("medicine");
  for (const attribute of ["str", "dex", "con"]) await panel.locator(`input[value="${attribute}"]`).check();
  await expect(submit).toBeDisabled();
  await panel.locator('input[value="wis"]').check();
  await expect(panel.locator('input[value="cha"]')).toBeDisabled();
  await submit.click(); await page.evaluate(() => window.growthFixture.commit());
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enter Encounter", exact: true })).toBeEnabled();
});

test("shows pending ownership, phase restrictions and partial boosts on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mount(page);
  await page.evaluate(() => window.growthFixture.render(false));
  await expect(page.locator(".character-advancement")).toContainText("조종하는 플레이어");
  await expect(page.locator(".character-advancement select")).toHaveCount(0);
  await page.evaluate(() => {
    const f = window.growthFixture; const id = "party.hero-1";
    f.state = { ...f.state, party: { members: { [id]: { ...f.state.party.members[id]!, progression: {
      level: 10, experience: 0, advancements: [
        { level: 3, skillIncrease: "athletics" },
        { level: 5, skillIncrease: "medicine", attributeBoosts: ["str", "dex", "con", "wis"] },
        { level: 7, skillIncrease: "athletics" }, { level: 9, skillIncrease: "medicine" },
      ],
    } } } } }; f.render();
  });
  const panel = page.locator(".character-advancement");
  await expect(panel).toHaveAttribute("data-advancement-level", "10");
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  for (const attribute of ["str", "dex", "con", "wis"]) await panel.locator(`input[value="${attribute}"]`).check();
  await expect(panel.getByRole("status")).toContainText("STR: 4 → 4 (partial");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole("button", { name: "성장 확정" }).click();
  await page.evaluate(() => window.growthFixture.commit());
  await expect(panel).toHaveCount(0);
});
